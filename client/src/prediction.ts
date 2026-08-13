import { Sim } from "../../shared/src/sim";
import { DOUBLE_JUMP_TICKS } from "../../shared/src/character";
import { MODEL_FOOTPRINTS } from "../../shared/src/modelFootprints";
import { MODEL_SCALES } from "../../shared/src/constants";
import type { CharSnap, InputState } from "../../shared/src/protocol";

// If the server falls this many inputs behind (bad connection), skip the
// replay and just adopt its state — replaying hundreds of steps stalls a frame.
const MAX_REPLAY = 30;

/**
 * Local-character prediction with REWIND + REPLAY reconciliation: a private
 * Rapier world with the static city, our own character, and mirrors of the
 * knockable props, stepped immediately from local inputs so controls feel
 * instant.
 *
 * Every snapshot carries the last input seq the server had applied. We reset
 * the car to the server's authoritative state and re-apply every input the
 * server hasn't seen yet. Because both worlds run identical deterministic
 * code, the replayed pose lands where the server WILL be once those inputs
 * arrive — corrections become invisible instead of the old soft-blend, which
 * yanked the car backwards ~15% of the latency gap 20 times a second (the
 * "push and pull" while driving).
 *
 * Props live here too (synced from snapshots, resimulated locally) so that
 * (a) our car collides with them with zero latency and (b) they can be
 * RENDERED from this world: drawing props from the ~100 ms interpolation
 * buffer while the own car renders from instant prediction makes every pushed
 * prop visually lag INSIDE the car (the "passing through objects" glitch).
 */
export class LocalPrediction {
  private sim: Sim;
  private spawned = false;
  private pending: InputState[] = [];
  // Render-only correction offset: the sim adopts every correction fully, but
  // the DISPLAYED pose absorbs the error over ~0.15 s instead of stepping.
  // Timer drift between the two 60 Hz clocks makes the server's input queue
  // breathe, so replays land a tick short/long of the shown pose (~0.5 m at
  // speed) — without this decay that reads as a 20 Hz micro push-and-pull.
  // FULL 3D: on the cube planet the jump axis can be ANY world axis, so a
  // 2D x/z offset (the city-era design) let jump/landing replay divergence
  // snap the view vertically — read as camera shake on every hop. Big
  // corrections (>2.5 m) still snap, so a folded offset can't hide a real
  // teleport or bury the view underground for long. Yaw gets the same
  // treatment (offYaw) — un-smoothed heading corrections read as camera
  // shake at DIST behind.
  private off: [number, number, number] = [0, 0, 0];
  private offYaw = 0;
  // Pose BEFORE the latest sim step, for fixed-timestep render interpolation:
  // physics steps on a 60 Hz timer while rendering runs on rAF, so a frame
  // sees 0..2 steps — drawing the raw pose beats rhythmically ("takak takak"
  // at speed). Rendering lerp(prev, curr, alpha) is continuous.
  private prevP: [number, number, number] | null = null;
  private prevQ: [number, number, number, number] = [0, 0, 0, 1];

  private constructor(sim: Sim) {
    this.sim = sim;
  }

  /** Mirror an authoritative block edit into the prediction world. */
  applyBlock(x: number, y: number, z: number, b: number): void {
    this.sim.applyBlock(x, y, z, b);
  }

  /** Replace the whole voxel state (welcome / reconnect RLE). */
  syncVoxels(rle: string): void {
    this.sim.syncVoxels(rle);
  }

  static async create(): Promise<LocalPrediction> {
    const sim = await Sim.create();
    // Mirror the knockable props (same ids/masses as server/src/game.ts).
    sim.map.props.forEach((p, i) => {
      const f = MODEL_FOOTPRINTS[`${p.pack}/${p.model}`];
      const s = MODEL_SCALES[p.pack];
      sim.addProp(`prop-${i}`, { x: f.hx * s, y: f.hy * s, z: f.hz * s }, p.x, p.z, 25);
    });
    return new LocalPrediction(sim);
  }

  // Recent jump inputs by seq — lets correct() reconstruct the sim's jump
  // edge-detection state (prevJump + double-jump window) at the rewind point.
  private jumpHist = new Map<number, boolean>();

  /** One fixed 60 Hz tick with the current input. */
  step(input: InputState): void {
    if (!this.spawned) return;
    this.pending.push({ ...input });
    this.jumpHist.set(input.seq, input.jump);
    if (this.jumpHist.size > 256) {
      for (const k of this.jumpHist.keys()) {
        if (this.jumpHist.size <= 128) break;
        this.jumpHist.delete(k);
      }
    }
    if (this.pending.length > MAX_REPLAY * 4) this.pending.splice(0, this.pending.length - MAX_REPLAY * 4);
    const s = this.sim.getState("me");
    this.prevP = s.p;
    this.prevQ = s.q;
    this.sim.setInput("me", input);
    this.sim.step();
    // ~0.85 s exponential decay at 60 Hz. Keep it SLOW: releasing a folded
    // 0.5 m correction at 10%/tick perturbs displayed speed by ~3 m/s — one
    // felt "bump" per network shear (rhythmic takak-takak on a real
    // connection). At 2%/tick even a 1 m fold releases under ~1.2 m/s.
    this.off[0] *= 0.98;
    this.off[1] *= 0.98;
    this.off[2] *= 0.98;
    this.offYaw *= 0.98;
  }

  /** Rendered pose; `alpha` in [0,1] interpolates from the pre-step pose. */
  getTransform(alpha = 1): { p: [number, number, number]; q: [number, number, number, number] } | null {
    if (!this.spawned) return null;
    let { p, q } = this.sim.getState("me");
    if (this.prevP && alpha < 1) {
      const pp = this.prevP;
      p = [pp[0] + (p[0] - pp[0]) * alpha, pp[1] + (p[1] - pp[1]) * alpha, pp[2] + (p[2] - pp[2]) * alpha];
      q = nlerp(this.prevQ, q, alpha);
    }
    return {
      p: [p[0] + this.off[0], p[1] + this.off[1], p[2] + this.off[2]],
      q: rotateYaw(q, this.offYaw),
    };
  }

  /** Static-world ray for camera collision (uses the mirror city). */
  cameraBlock(from: [number, number, number], dir: [number, number, number], dist: number): number | null {
    return this.sim.castRayStatic(from, dir, dist);
  }

  getVelocity(): [number, number, number] {
    if (!this.spawned) return [0, 0, 0];
    return this.sim.getState("me").v;
  }

  getGrounded(): boolean {
    return this.spawned ? this.sim.getState("me").grounded : false;
  }

  getFly(): boolean {
    return this.spawned ? this.sim.getFly("me") : false;
  }

  /** Rendered pose of a mirrored prop. */
  getProp(id: string): { p: [number, number, number]; q: [number, number, number, number] } {
    return this.sim.getPropState(id);
  }

  /** Adopt authoritative prop states from a snapshot (before correct()). */
  syncProps(chars: CharSnap[]): void {
    for (const c of chars) {
      if (c.id.startsWith("prop-")) this.sim.setPropState(c.id, c.p, c.q, c.v);
    }
  }

  /** Reconcile with the authoritative state from a server snapshot. */
  correct(
    p: [number, number, number],
    q: [number, number, number, number],
    v: [number, number, number],
    lastSeq: number,
    fly = false,
  ): void {
    if (!this.spawned) {
      this.sim.addChar("me", p[0], p[2], 0);
      this.sim.setState("me", p, q, v);
      this.spawned = true;
      return;
    }
    // drop everything the server has already applied
    while (this.pending.length && this.pending[0].seq <= lastSeq) this.pending.shift();
    const beforeState = this.sim.getState("me");
    const before = beforeState.p;
    const beforeYaw = yawOf(beforeState.q);
    this.sim.setState("me", p, q, v);
    // flight is part of the rewound state: replayed double-jump edges then
    // re-derive the same toggles the server will make
    this.sim.setFly("me", fly);
    // Rebuild the jump edge-detection state AS OF lastSeq by running the
    // sim's exact little state machine over recent jump inputs — otherwise
    // the replay re-sees (or misses) a jump edge and diverges a full jump
    // height from the server on every hop.
    {
      let prev = false;
      let win = 0;
      for (let s = lastSeq - 40; s <= lastSeq; s++) {
        const j = this.jumpHist.get(s) ?? false;
        const edge = j && !prev;
        prev = j;
        if (win > 0) win--;
        if (edge) win = win > 0 ? 0 : DOUBLE_JUMP_TICKS;
      }
      this.sim.setEdgeState("me", prev, win);
    }
    if (this.pending.length > MAX_REPLAY) {
      // Way behind: skip the replay (stepping hundreds of ticks stalls a
      // frame) but STILL fold the display step below — the old early-return
      // here hard-snapped the view every time the server queue breathed past
      // the cap, which read as camera shake on jumps under load.
      this.pending.length = 0;
      this.dbgBail++;
    } else {
      for (const input of this.pending) {
        this.sim.setInput("me", input);
        this.sim.step();
      }
    }
    const afterState = this.sim.getState("me");
    const after = afterState.p;
    const err = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    // Keep the displayed pose continuous: fold the correction step into the
    // decaying render offset. Only a single HUGE correction (teleport,
    // respawn, collision misprediction) snaps — hiding those would lie about
    // where you are. Never zero the accumulated offset just because it grew
    // (a burst of shears at top speed reaches any cap): rescale it softly.
    if (err > 2.5) {
      this.off = [0, 0, 0];
      this.offYaw = 0;
      this.dbgSnap++;
    } else {
      this.off[0] += before[0] - after[0];
      this.off[1] += before[1] - after[1];
      this.off[2] += before[2] - after[2];
      const mag = Math.hypot(this.off[0], this.off[1], this.off[2]);
      if (mag > 3) {
        this.off[0] *= 3 / mag;
        this.off[1] *= 3 / mag;
        this.off[2] *= 3 / mag;
      }
      this.offYaw = Math.max(-0.6, Math.min(0.6, this.offYaw + wrapPi(beforeYaw - yawOf(afterState.q))));
    }
    // Shift the interpolation anchor onto the corrected timeline so the
    // prev->curr render velocity stays coherent across the correction.
    if (this.prevP) {
      this.prevP[0] += after[0] - before[0];
      this.prevP[1] += after[1] - before[1];
      this.prevP[2] += after[2] - before[2];
    }
    this.trackError(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]));
  }

  // Debug counters for the two "display may step" paths (read via __pred).
  private dbgBail = 0;
  private dbgSnap = 0;
  getDebug(): { off: number[]; pending: number; bails: number; snaps: number } {
    return { off: [...this.off], pending: this.pending.length, bails: this.dbgBail, snaps: this.dbgSnap };
  }

  // Correction-error telemetry: how far the rewind+replay landed from the pose
  // we were already showing. Perfect reconciliation = 0; read via __predErr.
  private errCount = 0;
  private errSum = 0;
  private errMax = 0;
  private errBig = 0; // corrections > 0.2 m
  private trackError(d: number): void {
    this.errCount++;
    this.errSum += d;
    if (d > this.errMax) this.errMax = d;
    if (d > 0.2) this.errBig++;
    (globalThis as unknown as { __predErr?: unknown }).__predErr = {
      count: this.errCount,
      avg: this.errSum / this.errCount,
      max: this.errMax,
      big: this.errBig,
    };
  }

  /** Forget the character (e.g. after a knockout) so the next snapshot respawns it. */
  reset(): void {
    if (this.spawned) this.sim.removeChar("me");
    this.spawned = false;
    this.pending = [];
    this.off = [0, 0, 0];
    this.offYaw = 0;
    this.prevP = null;
  }
}

/** Normalized lerp between quaternions (fine for sub-tick angles). */
function nlerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const x = a[0] + (b[0] * s - a[0]) * t;
  const y = a[1] + (b[1] * s - a[1]) * t;
  const z = a[2] + (b[2] * s - a[2]) * t;
  const w = a[3] + (b[3] * s - a[3]) * t;
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

function yawOf(q: [number, number, number, number]): number {
  return Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Pre-rotate quaternion q by `yaw` around world Y. */
function rotateYaw(
  q: [number, number, number, number],
  yaw: number,
): [number, number, number, number] {
  if (yaw === 0) return q;
  const hy = yaw / 2;
  const ry = Math.sin(hy);
  const rw = Math.cos(hy);
  const [x, y, z, w] = q;
  // (0, ry, 0, rw) * (x, y, z, w)
  return [rw * x + ry * z, rw * y + ry * w, rw * z - ry * x, rw * w - ry * y];
}
