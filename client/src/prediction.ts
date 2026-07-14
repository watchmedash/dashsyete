import { Sim } from "../../shared/src/sim";
import type { InputState } from "../../shared/src/protocol";

// If the server falls this many inputs behind (bad connection), skip the
// replay and just adopt its state — replaying hundreds of steps stalls a frame.
const MAX_REPLAY = 30;

/**
 * Local-car prediction with REWIND + REPLAY reconciliation: a private Rapier
 * world with the static city and only our own car, stepped immediately from
 * local inputs so controls feel instant.
 *
 * Every snapshot carries the last input seq the server had applied. We reset
 * the car to the server's authoritative state and re-apply every input the
 * server hasn't seen yet. Because both worlds run identical deterministic
 * code, the replayed pose lands where the server WILL be once those inputs
 * arrive — corrections become invisible instead of the old soft-blend, which
 * yanked the car backwards ~15% of the latency gap 20 times a second (the
 * "push and pull" while driving).
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
  private off: [number, number, number] = [0, 0, 0];

  private constructor(sim: Sim) {
    this.sim = sim;
  }

  static async create(): Promise<LocalPrediction> {
    return new LocalPrediction(await Sim.create());
  }

  /** One fixed 60 Hz tick with the current input. */
  step(input: InputState): void {
    if (!this.spawned) return;
    this.pending.push({ ...input });
    if (this.pending.length > MAX_REPLAY * 4) this.pending.splice(0, this.pending.length - MAX_REPLAY * 4);
    this.sim.setInput("me", input);
    this.sim.step();
    // ~0.15 s exponential decay at 60 Hz
    this.off[0] *= 0.9;
    this.off[1] *= 0.9;
    this.off[2] *= 0.9;
  }

  getTransform(): { p: [number, number, number]; q: [number, number, number, number] } | null {
    if (!this.spawned) return null;
    const { p, q } = this.sim.getState("me");
    return { p: [p[0] + this.off[0], p[1] + this.off[1], p[2] + this.off[2]], q };
  }

  getVelocity(): [number, number, number] {
    if (!this.spawned) return [0, 0, 0];
    return this.sim.getState("me").v;
  }

  /** Reconcile with the authoritative state from a server snapshot. */
  correct(
    p: [number, number, number],
    q: [number, number, number, number],
    v: [number, number, number],
    lastSeq: number,
  ): void {
    if (!this.spawned) {
      this.sim.addCar("me", p[0], p[2], 0);
      this.sim.setState("me", p, q, v);
      this.spawned = true;
      return;
    }
    // drop everything the server has already applied
    while (this.pending.length && this.pending[0].seq <= lastSeq) this.pending.shift();
    const before = this.sim.getState("me").p;
    this.sim.setState("me", p, q, v);
    if (this.pending.length > MAX_REPLAY) {
      this.pending.length = 0;
      return;
    }
    for (const input of this.pending) {
      this.sim.setInput("me", input);
      this.sim.step();
    }
    const after = this.sim.getState("me").p;
    // Keep the displayed pose continuous: fold the correction step into the
    // decaying render offset. Big errors (real mispredictions — collisions,
    // teleports) snap instead: hiding those would lie about where you are.
    this.off[0] += before[0] - after[0];
    this.off[1] += before[1] - after[1];
    this.off[2] += before[2] - after[2];
    if (Math.hypot(this.off[0], this.off[1], this.off[2]) > 2) this.off = [0, 0, 0];
    this.trackError(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]));
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

  /** Forget the car (e.g. after a knockout) so the next snapshot respawns it. */
  reset(): void {
    if (this.spawned) this.sim.removeCar("me");
    this.spawned = false;
    this.pending = [];
    this.off = [0, 0, 0];
  }
}
