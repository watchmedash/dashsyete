import RAPIER from "@dimforge/rapier3d-compat";
import { buildCityMap, parkedCarCollider, type CityMap } from "./cityMap";
import { BIOMES, buildSkyWorld, faceIndexOfUp } from "./skyMap";
import { CHUNK, VoxelWorld } from "./voxel";
import { basis, dirFromYawPitch, dot as vdot, faceUp, quatFace, quatUpYaw, yawFromDir, PLANET_R, UP_Y, type V3 } from "./gravity";
import { TICK_DT } from "./constants";
import type { InputState } from "./protocol";
import {
  ACCEL, AIR_CONTROL, CHAR_CENTER_Y, CHAR_HALF_HEIGHT, CHAR_RADIUS, DECEL, DOUBLE_JUMP_TICKS,
  FLY_ACCEL, FLY_BOOST, FLY_MAX_ALT, FLY_SPEED, FLY_VERT, GRAVITY, JUMP_VEL, MAX_SLOPE,
  SNAP_DIST, SPRINT_SPEED, STEP_OFFSET, TERMINAL_VY, WALK_SPEED,
} from "./character";

export interface SimChar {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  input: InputState;
  /** Velocity is integrated manually — kinematic bodies have none of their own. */
  v: { x: number; y: number; z: number };
  grounded: boolean;
  yaw: number;
  /** Consecutive ticks the controller reported heavily blocked movement. */
  blockedTicks: number;
  /** The face this character stands on (always +Y off the planet). */
  up: V3;
  /** Voxel worlds: hop 1-block steps automatically next tick. */
  autoJump: boolean;
  /** Creative-style flight (fly-enabled biomes, toggled by double-jump). */
  fly: boolean;
  /** Previous tick's jump input (double-jump edge detection). */
  prevJump: boolean;
  /** Ticks left in the double-jump window after a first jump press. */
  dblWin: number;
  /** Last landing's impact speed (m/s), consumed by the server for fall damage. */
  impact: number;
}

const IDLE: InputState = { seq: 0, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false, swap: false };

/**
 * Shared deterministic simulation: one kinematic character controller per
 * player over the static city, plus knockable dynamic props and kinematic
 * movers (train, ship). Run authoritatively on the server and mirrored in the
 * client prediction world — identical inputs must produce identical states.
 */
export class Sim {
  readonly map: CityMap;
  /** The voxel terrain (v5 sky-island mode); null on box-collider maps. */
  vox: VoxelWorld | null = null;
  /** Cube-planet mode: gravity pulls toward the nearest face (gravity.ts). */
  planet = false;
  private world: RAPIER.World;
  private chars = new Map<string, SimChar>();
  private controller: RAPIER.KinematicCharacterController;

  private constructor(map: CityMap) {
    this.map = map;
    // Gravity only affects dynamic props — characters integrate their own.
    this.world = new RAPIER.World({ x: 0, y: -16, z: 0 });

    // One ground slab per landmass; the sea has no floor.
    for (const g of map.grounds) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation((g.x0 + g.x1) / 2, -1, (g.z0 + g.z1) / 2),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((g.x1 - g.x0) / 2, 1, (g.z1 - g.z0) / 2),
        body,
      );
    }

    // Static city colliders (buildings, walls, arena bounds) + parked cars
    for (const c of [...map.colliders, ...map.parkedCars.map(parkedCarCollider)]) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz), body);
    }

    // One shared character controller (it holds no per-character state).
    this.controller = this.world.createCharacterController(0.05);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    // Autostep is enabled per-call, NOT here: with autostep always on, the
    // controller spuriously returns ~zero movement on open flat ground at
    // deterministic positions (a hitch/stall at speed). We compute movement
    // with autostep off and only re-run with it on when the plain pass was
    // actually blocked (a real curb/step). See step().
    this.controller.enableSnapToGround(SNAP_DIST);
    this.controller.setMaxSlopeClimbAngle(MAX_SLOPE);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);

    // Voxel sky-island terrain: seeded, deterministic — server and client
    // prediction build the same base world; live edits arrive as deltas.
    // COLLIDERS ARE STREAMED: only chunks near a character get Rapier
    // bodies (see refreshVoxelColliders) — a full R=112 planet is ~14k
    // static colliders and world.step() blows the 60 Hz budget (~40 ms).
    if (map.vox) {
      this.vox = buildSkyWorld(map.vox.seed).world;
      this.planet = !!map.vox.planet;
    }
  }

  static async create(): Promise<Sim> {
    await RAPIER.init();
    return new Sim(buildCityMap());
  }

  /** Apply an authoritative block edit; rebuild the collider only if that
   * chunk is currently streamed in (data always updates). */
  applyBlock(x: number, y: number, z: number, b: number): void {
    if (!this.vox) return;
    const key = this.vox.set(x, y, z, b);
    if (this.streamed.has(key)) this.setVoxelChunk(key, this.vox.chunkCuboids(key));
  }

  /** Replace the whole voxel state (reconnect / welcome RLE). */
  syncVoxels(rle: string): void {
    if (!this.map.vox) return;
    this.vox = VoxelWorld.deserialize(rle);
    // refresh only the streamed-in colliders; the rest rebuilds on approach
    for (const k of this.streamed) this.setVoxelChunk(k, this.vox.chunkCuboids(k));
  }

  // ---- Voxel collider STREAMING: Rapier bodies exist only around
  // characters (radius STREAM_R chunks, chebyshev, 3D). The full world data
  // stays in `vox` for raycasts/build targeting; distant terrain simply has
  // no physics until someone gets close.
  private streamed = new Set<string>();
  private lastStreamKey = "";
  private static readonly STREAM_R = 3;

  private refreshVoxelColliders(): void {
    if (!this.vox) return;
    const centers: string[] = [];
    for (const char of this.chars.values()) {
      const p = char.body.translation();
      centers.push(
        `${Math.floor(p.x / CHUNK)},${Math.floor(p.y / CHUNK)},${Math.floor(p.z / CHUNK)}`,
      );
    }
    const sig = centers.sort().join(";");
    if (sig === this.lastStreamKey) return; // nobody crossed a chunk boundary
    this.lastStreamKey = sig;
    const R = Sim.STREAM_R;
    const wanted = new Set<string>();
    for (const c of centers) {
      const [cx, cy, cz] = c.split(",").map(Number);
      for (let dx = -R; dx <= R; dx++)
        for (let dy = -R; dy <= R; dy++)
          for (let dz = -R; dz <= R; dz++) wanted.add(`${cx + dx},${cy + dy},${cz + dz}`);
    }
    for (const k of wanted) {
      if (!this.streamed.has(k) && this.vox.chunks.has(k)) {
        this.setVoxelChunk(k, this.vox.chunkCuboids(k));
        this.streamed.add(k);
      }
    }
    for (const k of [...this.streamed]) {
      if (!wanted.has(k)) {
        this.setVoxelChunk(k, []);
        this.streamed.delete(k);
      }
    }
  }

  addChar(id: string, x: number, z: number, yaw: number, groundY = 0): SimChar {
    // (x, groundY, z) is the FOOT position; the capsule center rises along
    // the local face up (always +Y off the planet).
    const up = faceUp([x, groundY, z], null, this.planet);
    const cx = x + up[0] * (CHAR_CENTER_Y + 0.1);
    const cy = groundY + up[1] * (CHAR_CENTER_Y + 0.1);
    const cz = z + up[2] * (CHAR_CENTER_Y + 0.1);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, cy, cz),
    );
    const fq = quatFace(up);
    body.setRotation({ x: fq[0], y: fq[1], z: fq[2], w: fq[3] }, false);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CHAR_HALF_HEIGHT, CHAR_RADIUS),
      body,
    );
    const char: SimChar = { id, body, collider, input: { ...IDLE, yaw }, v: { x: 0, y: 0, z: 0 }, grounded: false, yaw, blockedTicks: 0, up, autoJump: false, fly: false, prevJump: false, dblWin: 0, impact: 0 };
    this.chars.set(id, char);
    this.lastStreamKey = ""; // stream colliders in around the new character
    return char;
  }

  removeChar(id: string): void {
    const char = this.chars.get(id);
    if (!char) return;
    this.world.removeRigidBody(char.body);
    this.chars.delete(id);
    this.lastStreamKey = "";
  }

  hasChar(id: string): boolean {
    return this.chars.has(id);
  }

  /** The face up for a character (always +Y off the planet). */
  getUp(id: string): V3 {
    return this.chars.get(id)?.up ?? UP_Y;
  }

  charIds(): string[] {
    return [...this.chars.keys()];
  }

  setInput(id: string, input: InputState): void {
    const char = this.chars.get(id);
    if (char) char.input = input;
  }

  teleport(id: string, x: number, z: number, yaw: number, groundY = 0): void {
    const char = this.chars.get(id);
    if (!char) return;
    const up = faceUp([x, groundY, z], null, this.planet);
    char.up = up;
    const fq = quatFace(up);
    char.body.setRotation({ x: fq[0], y: fq[1], z: fq[2], w: fq[3] }, false);
    char.body.setTranslation(
      {
        x: x + up[0] * (CHAR_CENTER_Y + 0.1),
        y: groundY + up[1] * (CHAR_CENTER_Y + 0.1),
        z: z + up[2] * (CHAR_CENTER_Y + 0.1),
      },
      false,
    );
    char.v = { x: 0, y: 0, z: 0 };
    char.yaw = yaw;
    char.input = { ...IDLE, yaw };
    char.fly = false;
    char.prevJump = false;
    char.dblWin = 0;
    char.impact = 0;
    this.lastStreamKey = ""; // teleport = new neighborhood, restream
  }

  /** Take-and-clear the last landing impact speed (server fall damage). */
  consumeImpact(id: string): number {
    const char = this.chars.get(id);
    if (!char) return 0;
    const i = char.impact;
    char.impact = 0;
    return i;
  }

  getFly(id: string): boolean {
    return this.chars.get(id)?.fly ?? false;
  }

  /** Adopt authoritative fly state (prediction rewind). */
  setFly(id: string, fly: boolean): void {
    const char = this.chars.get(id);
    if (char) char.fly = fly;
  }

  /** Advance one fixed 60 Hz tick. All movement math runs in the character's
   * FACE FRAME (tangents t1/t2 + up): on flat maps up is +Y and this is the
   * original flat-world math; on the cube planet up follows the face. */
  step(): void {
    this.refreshVoxelColliders();
    for (const char of this.chars.values()) {
      const { input } = char;
      char.yaw = input.yaw;
      const pNow = char.body.translation();

      // Face transition: crossing a cube edge rotates gravity 90°. NEVER
      // flip while RISING relative to the current face: jumping right at an
      // edge used to transition at the apex ambiguity, turning the jump
      // momentum into a return trajectory (you landed back on the takeoff
      // spot). Falling (or walking off) still transitions immediately.
      if (this.planet) {
        const rising = char.v.x * char.up[0] + char.v.y * char.up[1] + char.v.z * char.up[2] > 1;
        const nu = rising ? char.up : faceUp([pNow.x, pNow.y, pNow.z], char.up, true);
        if (nu[0] !== char.up[0] || nu[1] !== char.up[1] || nu[2] !== char.up[2]) {
          char.up = nu;
          const fq = quatFace(nu);
          char.body.setRotation({ x: fq[0], y: fq[1], z: fq[2], w: fq[3] }, false);
        }
      }
      const up = char.up;
      const { t1, t2 } = basis(up);
      this.controller.setUp({ x: up[0], y: up[1], z: up[2] });
      // Per-face BIOME conditions: trudging snow, soft sand, the low-gravity
      // moon face... (multipliers default to 1 off the planet)
      const bio = this.planet ? BIOMES[faceIndexOfUp(up)] : null;
      const speedMul = bio?.speed ?? 1;
      const gravMul = bio?.gravity ?? 1;
      const jumpMul = bio?.jump ?? 1;

      // FLIGHT (fly-enabled biomes): double-jump toggles creative-style
      // flight; touching the ground (or leaving the biome) drops you out.
      const jumpEdge = input.jump && !char.prevJump;
      char.prevJump = input.jump;
      if (char.dblWin > 0) char.dblWin--;
      if (bio?.fly) {
        if (jumpEdge) {
          if (char.dblWin > 0) {
            char.fly = !char.fly;
            char.dblWin = 0;
          } else {
            char.dblWin = DOUBLE_JUMP_TICKS;
          }
        }
      } else {
        char.fly = false;
      }

      // Camera-relative move rotated by yaw, expressed on the face tangents.
      let mx = input.moveX;
      let mz = input.moveZ;
      const mlen = Math.hypot(mx, mz);
      if (mlen > 1) {
        mx /= mlen;
        mz /= mlen;
      }
      const sin = Math.sin(input.yaw);
      const cos = Math.cos(input.yaw);
      const fwd: V3 = [t1[0] * sin + t2[0] * cos, t1[1] * sin + t2[1] * cos, t1[2] * sin + t2[2] * cos];
      const right: V3 = [t1[0] * cos - t2[0] * sin, t1[1] * cos - t2[1] * sin, t1[2] * cos - t2[2] * sin];
      // FLYING: movement follows the CAMERA (pitch included) so climbs and
      // dives are one smooth motion; sprint BOOSTS speed; jump adds lift.
      let T: V3;
      let flyUpTarget = 0;
      if (char.fly) {
        const vd = dirFromYawPitch(input.yaw, input.aimPitch, up);
        const spd = input.sprint ? FLY_BOOST : FLY_SPEED;
        const lift = input.jump ? FLY_VERT : 0;
        const t3: V3 = [
          (right[0] * mx + vd[0] * mz) * spd + up[0] * lift,
          (right[1] * mx + vd[1] * mz) * spd + up[1] * lift,
          (right[2] * mx + vd[2] * mz) * spd + up[2] * lift,
        ];
        flyUpTarget = vdot(t3, up);
        T = [t3[0] - up[0] * flyUpTarget, t3[1] - up[1] * flyUpTarget, t3[2] - up[2] * flyUpTarget];
      } else {
        const targetSpeed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * speedMul;
        T = [
          (right[0] * mx + fwd[0] * mz) * targetSpeed,
          (right[1] * mx + fwd[1] * mz) * targetSpeed,
          (right[2] * mx + fwd[2] * mz) * targetSpeed,
        ];
      }

      // Split velocity into tangential + up components.
      const vArr: V3 = [char.v.x, char.v.y, char.v.z];
      let vUp = vdot(vArr, up);
      const vTan: V3 = [vArr[0] - up[0] * vUp, vArr[1] - up[1] * vUp, vArr[2] - up[2] * vUp];

      // Accelerate tangential velocity toward the target; harder decel than
      // accel, reduced control while airborne so jumps carry momentum.
      const hasInput = Math.hypot(mx, mz) > 0.01;
      let rate = hasInput ? ACCEL : DECEL;
      if (!char.grounded && !char.fly) rate *= AIR_CONTROL;
      const maxDelta = rate * TICK_DT;
      const dvec: V3 = [T[0] - vTan[0], T[1] - vTan[1], T[2] - vTan[2]];
      const dlen = Math.hypot(dvec[0], dvec[1], dvec[2]);
      if (dlen <= maxDelta) {
        vTan[0] = T[0];
        vTan[1] = T[1];
        vTan[2] = T[2];
      } else {
        vTan[0] += (dvec[0] / dlen) * maxDelta;
        vTan[1] += (dvec[1] / dlen) * maxDelta;
        vTan[2] += (dvec[2] / dlen) * maxDelta;
      }

      // "Vertical": manual gravity along the face up + grounded jump.
      // Voxel worlds also AUTO-JUMP single-block steps (flagged last tick).
      // While FLYING there is no gravity: vUp eases toward the camera-driven
      // target (FLY_ACCEL) so flight never snaps.
      if (char.fly) {
        const d = flyUpTarget - vUp;
        const step = FLY_ACCEL * TICK_DT;
        vUp += Math.abs(d) <= step ? d : Math.sign(d) * step;
      } else if (char.grounded && (input.jump || char.autoJump)) vUp = JUMP_VEL * jumpMul;
      else vUp = Math.max(-TERMINAL_VY, vUp - GRAVITY * gravMul * TICK_DT);
      char.autoJump = false;

      // FLIGHT BOUNDS: a ceiling above the face plane, and the face's own
      // width — you cannot fly around the edge to another face.
      if (char.fly && this.planet) {
        const alt = vdot([pNow.x, pNow.y, pNow.z], up) - PLANET_R;
        if (alt > FLY_MAX_ALT && vUp > 0) vUp = 0;
        const pArr: V3 = [pNow.x, pNow.y, pNow.z];
        const lim = PLANET_R - 1.5;
        for (let i = 0; i < 3; i++) {
          if (up[i] !== 0) continue;
          if (pArr[i] > lim && vTan[i] > 0) vTan[i] = 0;
          if (pArr[i] < -lim && vTan[i] < 0) vTan[i] = 0;
        }
      }

      char.v.x = vTan[0] + up[0] * vUp;
      char.v.y = vTan[1] + up[1] * vUp;
      char.v.z = vTan[2] + up[2] * vUp;

      const desired = { x: char.v.x * TICK_DT, y: char.v.y * TICK_DT, z: char.v.z * TICK_DT };
      const desiredUpAmt = vUp * TICK_DT;
      const desTan: V3 = [
        desired.x - up[0] * desiredUpAmt,
        desired.y - up[1] * desiredUpAmt,
        desired.z - up[2] * desiredUpAmt,
      ];
      const desiredH = Math.hypot(desTan[0], desTan[1], desTan[2]);
      const tanOf = (m: { x: number; y: number; z: number }): V3 => {
        const a = m.x * up[0] + m.y * up[1] + m.z * up[2];
        return [m.x - up[0] * a, m.y - up[1] * a, m.z - up[2] * a];
      };
      const exclude = (c: RAPIER.Collider) => c.parent()?.handle !== char.body.handle;
      this.controller.computeColliderMovement(char.collider, desired, undefined, undefined, exclude);
      let mv = this.controller.computedMovement();
      // Blocked tangentially while grounded? Retry with autostep for steps.
      let mvTan = tanOf(mv);
      if (char.grounded && desiredH > 1e-4 && Math.hypot(...mvTan) < desiredH * 0.5) {
        this.controller.enableAutostep(STEP_OFFSET, 0.1, true);
        this.controller.computeColliderMovement(char.collider, desired, undefined, undefined, exclude);
        this.controller.disableAutostep();
        const stepped = this.controller.computedMovement();
        if (Math.hypot(...tanOf(stepped)) > Math.hypot(...mvTan)) {
          mv = stepped;
          mvTan = tanOf(mv);
        }
      }
      const p = pNow;
      // GHOST-WALL OVERRIDE: when the controller claims "blocked" on provably
      // open ground (chest + shin rays clear, no character ahead), walk the
      // desired distance anyway. (See the long war in the git history.)
      if (char.grounded && desiredH > 1e-4 && Math.hypot(...mvTan) < desiredH * 0.5) {
        const dir: V3 = [desTan[0] / desiredH, desTan[1] / desiredH, desTan[2] / desiredH];
        const reach = CHAR_RADIUS + desiredH + 0.25;
        const shin: V3 = [p.x - up[0] * 0.8, p.y - up[1] * 0.8, p.z - up[2] * 0.8];
        const probe =
          this.castRayStatic([p.x, p.y, p.z], dir, reach) ??
          this.castRayStatic(shin, dir, reach);
        const charAhead = [...this.chars.values()].some((o) => {
          if (o === char) return false;
          const op = o.body.translation();
          const rel: V3 = [op.x - p.x, op.y - p.y, op.z - p.z];
          const along = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2];
          const relTan = tanOf({ x: rel[0], y: rel[1], z: rel[2] });
          return along > 0 && along < 1.2 && Math.hypot(...relTan) < 1.2;
        });
        if (probe === null && !charAhead) mvTan = desTan;
        // AUTO-JUMP (voxel worlds): blocked at shin height but CLEAR at chest
        // height = a single 1 m block ahead — hop it like Minecraft does.
        if (this.vox && probe !== null) {
          const chest: V3 = [p.x + up[0] * 0.45, p.y + up[1] * 0.45, p.z + up[2] * 0.45];
          if (this.castRayStatic(chest, dir, reach) === null) char.autoJump = true;
        }
      }
      const mvUpAmt = mv.x * up[0] + mv.y * up[1] + mv.z * up[2];
      // At idle, apply only up-axis motion: the controller emits micrometre
      // recovery slides that otherwise accumulate into visible creep.
      const ax = desiredH > 1e-4 ? mvTan[0] : 0;
      const ay = desiredH > 1e-4 ? mvTan[1] : 0;
      const az = desiredH > 1e-4 ? mvTan[2] : 0;
      char.body.setNextKinematicTranslation({
        x: p.x + ax + up[0] * mvUpAmt,
        y: p.y + ay + up[1] * mvUpAmt,
        z: p.z + az + up[2] * mvUpAmt,
      });
      const wasGrounded = char.grounded;
      char.grounded = this.controller.computedGrounded();
      // FALL DAMAGE bookkeeping: record the impact speed on landing (the
      // downward velocity we carried INTO the collision). Server consumes it.
      if (!wasGrounded && char.grounded && vUp < 0) char.impact = Math.max(char.impact, -vUp);
      // touching down ends flight (Minecraft-style)
      if (char.fly && char.grounded) char.fly = false;

      // Adopt the collision-resolved velocity (see the original comments:
      // idle suppression + 2-consecutive-blocked-ticks rule).
      const blockedHard = desiredH > 1e-4 && Math.hypot(...mvTan) < desiredH * 0.8;
      char.blockedTicks = blockedHard ? char.blockedTicks + 1 : 0;
      let newTan: V3 = vTan;
      if (desiredH <= 1e-4) newTan = [0, 0, 0];
      else if (!blockedHard || char.blockedTicks >= 2)
        newTan = [mvTan[0] / TICK_DT, mvTan[1] / TICK_DT, mvTan[2] / TICK_DT];
      let newUp = vUp;
      if (char.grounded && vUp < 0) newUp = 0;
      else if (Math.abs(mvUpAmt) < Math.abs(desiredUpAmt) * 0.5 && vUp > 0) newUp = 0; // head bonk
      char.v.x = newTan[0] + up[0] * newUp;
      char.v.y = newTan[1] + up[1] * newUp;
      char.v.z = newTan[2] + up[2] * newUp;
    }

    this.world.timestep = TICK_DT;
    this.world.step();
  }

  getState(id: string): {
    p: [number, number, number];
    q: [number, number, number, number];
    v: [number, number, number];
    grounded: boolean;
  } {
    const char = this.chars.get(id)!;
    const p = char.body.translation();
    const q = this.planet ? quatUpYaw(char.up, char.yaw) : null;
    const qy = q ? null : yawQuat(char.yaw);
    return {
      p: [p.x, p.y, p.z],
      q: q ?? [qy!.x, qy!.y, qy!.z, qy!.w],
      v: [char.v.x, char.v.y, char.v.z],
      grounded: char.grounded,
    };
  }

  /** Hard-set a character's state (server snapshots -> prediction rewind). */
  setState(
    id: string,
    p: [number, number, number],
    q: [number, number, number, number],
    v: [number, number, number],
  ): void {
    const char = this.chars.get(id);
    if (!char) return;
    char.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, false);
    char.v = { x: v[0], y: v[1], z: v[2] };
    if (this.planet) {
      // face + yaw both recover from the authoritative state
      const nu = faceUp(p, char.up, true);
      if (nu !== char.up) {
        char.up = nu;
        const fq = quatFace(nu);
        char.body.setRotation({ x: fq[0], y: fq[1], z: fq[2], w: fq[3] }, false);
      }
      // rotate local +Z by q to get the world forward, project onto the face
      const fx = 2 * (q[0] * q[2] + q[3] * q[1]);
      const fy = 2 * (q[1] * q[2] - q[3] * q[0]);
      const fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
      char.yaw = yawFromDir([fx, fy, fz], char.up);
    } else {
      char.yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
    }
  }

  /** Cast a ray against the static world only (dart-vs-building checks).
   * Returns hit distance along the ray, or null. `dir` must be normalized. */
  castRayStatic(
    origin: [number, number, number],
    dir: [number, number, number],
    maxLen: number,
  ): number | null {
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: dir[0], y: dir[1], z: dir[2] },
    );
    const hit = this.world.castRay(ray, maxLen, true, undefined, undefined, undefined, undefined, (c) => {
      const parent = c.parent();
      return parent ? parent.isFixed() : true;
    });
    return hit ? hit.timeOfImpact : null;
  }

  /** Like castRayStatic but also returns the surface normal (grenade bounces). */
  castRayStaticN(
    origin: [number, number, number],
    dir: [number, number, number],
    maxLen: number,
  ): { toi: number; normal: [number, number, number] } | null {
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: dir[0], y: dir[1], z: dir[2] },
    );
    const hit = this.world.castRayAndGetNormal(ray, maxLen, true, undefined, undefined, undefined, undefined, (c) => {
      const parent = c.parent();
      return parent ? parent.isFixed() : true;
    });
    return hit ? { toi: hit.timeOfImpact, normal: [hit.normal.x, hit.normal.y, hit.normal.z] } : null;
  }

  private kinematics = new Map<string, RAPIER.RigidBody>();
  private propBodies = new Map<string, RAPIER.RigidBody>();

  /** Adds a light knockable prop (crate, hay bale, pumpkin...). */
  addProp(id: string, half: { x: number; y: number; z: number }, x: number, z: number, massKg: number): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, half.y + 0.5, z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(massKg), body);
    this.propBodies.set(id, body);
  }

  removeProp(id: string): void {
    const body = this.propBodies.get(id);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.propBodies.delete(id);
  }

  propIds(): string[] {
    return [...this.propBodies.keys()];
  }

  getPropState(id: string): { p: [number, number, number]; q: [number, number, number, number]; v: [number, number, number] } {
    const body = this.propBodies.get(id)!;
    const p = body.translation();
    const q = body.rotation();
    const v = body.linvel();
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z] };
  }

  /** Adopt an authoritative prop pose+velocity (client prediction mirror).
   * wake=false: syncing a resting prop must not keep it permanently awake. */
  setPropState(id: string, p: [number, number, number], q: [number, number, number, number], v: [number, number, number]): void {
    const body = this.propBodies.get(id);
    if (!body) return;
    body.setTranslation({ x: p[0], y: p[1], z: p[2] }, false);
    body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, false);
    body.setLinvel({ x: v[0], y: v[1], z: v[2] }, false);
  }

  /** Adds a fixed box collider (test platforms, extra statics). */
  addStaticBox(half: { x: number; y: number; z: number }, x: number, y: number, z: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), body);
  }

  // ---- Voxel terrain (v5 sky islands): one fixed body per chunk, rebuilt
  // whole on any edit — greedy-merged cuboids keep collider counts tiny.
  private voxelBodies = new Map<string, RAPIER.RigidBody>();

  setVoxelChunk(key: string, cuboids: { x: number; y: number; z: number; hx: number; hy: number; hz: number }[]): void {
    const old = this.voxelBodies.get(key);
    if (old) {
      this.world.removeRigidBody(old);
      this.voxelBodies.delete(key);
    }
    if (cuboids.length === 0) return;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const b of cuboids) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z),
        body,
      );
    }
    this.voxelBodies.set(key, body);
  }

  loadVoxelWorld(w: { chunks: Map<string, unknown>; chunkCuboids(k: string): { x: number; y: number; z: number; hx: number; hy: number; hz: number }[] }): void {
    for (const k of w.chunks.keys()) this.setVoxelChunk(k, w.chunkCuboids(k));
  }

  /** Adds a kinematic box body (train, ship) that blocks characters but never deals damage. */
  addKinematicBox(id: string, half: { x: number; y: number; z: number }): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), body);
    this.kinematics.set(id, body);
  }

  moveKinematic(id: string, x: number, y: number, z: number, rotY: number): void {
    const body = this.kinematics.get(id);
    if (!body) return;
    body.setNextKinematicTranslation({ x, y, z });
    body.setNextKinematicRotation(yawQuat(rotY));
  }
}

function yawQuat(rotY: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) };
}
