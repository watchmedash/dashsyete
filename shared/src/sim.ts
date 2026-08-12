import RAPIER from "@dimforge/rapier3d-compat";
import { buildCityMap, parkedCarCollider, type CityMap } from "./cityMap";
import { buildSkyWorld } from "./skyMap";
import { VoxelWorld } from "./voxel";
import { TICK_DT } from "./constants";
import type { InputState } from "./protocol";
import {
  ACCEL, AIR_CONTROL, CHAR_CENTER_Y, CHAR_HALF_HEIGHT, CHAR_RADIUS, DECEL, GRAVITY, JUMP_VEL,
  MAX_SLOPE, SNAP_DIST, SPRINT_SPEED, STEP_OFFSET, TERMINAL_VY, WALK_SPEED,
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
    if (map.vox) {
      this.vox = buildSkyWorld(map.vox.seed).world;
      this.loadVoxelWorld(this.vox);
    }
  }

  static async create(): Promise<Sim> {
    await RAPIER.init();
    return new Sim(buildCityMap());
  }

  /** Apply an authoritative block edit and rebuild the touched chunk. */
  applyBlock(x: number, y: number, z: number, b: number): void {
    if (!this.vox) return;
    const key = this.vox.set(x, y, z, b);
    this.setVoxelChunk(key, this.vox.chunkCuboids(key));
  }

  /** Replace the whole voxel state (reconnect / welcome RLE). */
  syncVoxels(rle: string): void {
    if (!this.map.vox) return;
    const incoming = VoxelWorld.deserialize(rle);
    const keys = new Set([...(this.vox?.chunks.keys() ?? []), ...incoming.chunks.keys()]);
    this.vox = incoming;
    for (const k of keys) this.setVoxelChunk(k, incoming.chunkCuboids(k));
  }

  addChar(id: string, x: number, z: number, yaw: number, groundY = 0): SimChar {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, groundY + CHAR_CENTER_Y + 0.1, z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CHAR_HALF_HEIGHT, CHAR_RADIUS),
      body,
    );
    const char: SimChar = { id, body, collider, input: { ...IDLE, yaw }, v: { x: 0, y: 0, z: 0 }, grounded: false, yaw, blockedTicks: 0 };
    this.chars.set(id, char);
    return char;
  }

  removeChar(id: string): void {
    const char = this.chars.get(id);
    if (!char) return;
    this.world.removeRigidBody(char.body);
    this.chars.delete(id);
  }

  hasChar(id: string): boolean {
    return this.chars.has(id);
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
    char.body.setTranslation({ x, y: groundY + CHAR_CENTER_Y + 0.1, z }, false);
    char.v = { x: 0, y: 0, z: 0 };
    char.yaw = yaw;
    char.input = { ...IDLE, yaw };
  }

  /** Advance one fixed 60 Hz tick. */
  step(): void {
    for (const char of this.chars.values()) {
      const { input } = char;
      char.yaw = input.yaw;

      // Camera-relative move: rotate (moveX, moveZ) by yaw. Positive yaw
      // rotates +z toward +x, matching the camera convention.
      let mx = input.moveX;
      let mz = input.moveZ;
      const mlen = Math.hypot(mx, mz);
      if (mlen > 1) {
        mx /= mlen;
        mz /= mlen;
      }
      const sin = Math.sin(input.yaw);
      const cos = Math.cos(input.yaw);
      const wx = mx * cos + mz * sin;
      const wz = mz * cos - mx * sin;
      const targetSpeed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      const tx = wx * targetSpeed;
      const tz = wz * targetSpeed;

      // Accelerate horizontal velocity toward the target; harder decel than
      // accel so releasing input stops you fast, reduced control while
      // airborne so jumps carry momentum.
      const hasInput = Math.hypot(mx, mz) > 0.01;
      let rate = hasInput ? ACCEL : DECEL;
      if (!char.grounded) rate *= AIR_CONTROL;
      const maxDelta = rate * TICK_DT;
      const dx = tx - char.v.x;
      const dz = tz - char.v.z;
      const dlen = Math.hypot(dx, dz);
      if (dlen <= maxDelta) {
        char.v.x = tx;
        char.v.z = tz;
      } else {
        char.v.x += (dx / dlen) * maxDelta;
        char.v.z += (dz / dlen) * maxDelta;
      }

      // Vertical: manual gravity integration + grounded jump.
      if (char.grounded && input.jump) char.v.y = JUMP_VEL;
      else char.v.y = Math.max(-TERMINAL_VY, char.v.y - GRAVITY * TICK_DT);

      const desired = { x: char.v.x * TICK_DT, y: char.v.y * TICK_DT, z: char.v.z * TICK_DT };
      const exclude = (c: RAPIER.Collider) => c.parent()?.handle !== char.body.handle;
      this.controller.computeColliderMovement(char.collider, desired, undefined, undefined, exclude);
      let mv = this.controller.computedMovement();
      // Blocked horizontally while grounded? Retry with autostep for curbs.
      const desiredH = Math.hypot(desired.x, desired.z);
      if (char.grounded && desiredH > 1e-4 && Math.hypot(mv.x, mv.z) < desiredH * 0.5) {
        this.controller.enableAutostep(STEP_OFFSET, 0.1, true);
        this.controller.computeColliderMovement(char.collider, desired, undefined, undefined, exclude);
        this.controller.disableAutostep();
        const stepped = this.controller.computedMovement();
        if (Math.hypot(stepped.x, stepped.z) > Math.hypot(mv.x, mv.z)) mv = stepped;
      }
      const p = char.body.translation();
      // GHOST-WALL OVERRIDE: the controller sometimes reports total blockage
      // for MANY consecutive ticks on open flat ground (deterministic spots,
      // reproduced on the empty dock deck). When it claims "blocked" but a
      // static raycast at chest height proves nothing is there, distrust the
      // controller and walk the desired distance anyway.
      let mvx = mv.x;
      let mvz = mv.z;
      if (char.grounded && desiredH > 1e-4 && Math.hypot(mv.x, mv.z) < desiredH * 0.5) {
        const dirX = desired.x / desiredH;
        const dirZ = desired.z / desiredH;
        const reach = CHAR_RADIUS + desiredH + 0.25;
        // chest AND shin rays: any obstacle — including curb-height statics
        // that are autostep's job — vetoes the override. Only a path that is
        // provably empty at both heights gets forced.
        const probe =
          this.castRayStatic([p.x, p.y, p.z], [dirX, 0, dirZ], reach) ??
          this.castRayStatic([p.x, p.y - 0.8, p.z], [dirX, 0, dirZ], reach);
        const charAhead = [...this.chars.values()].some((o) => {
          if (o === char) return false;
          const op = o.body.translation();
          const along = (op.x - p.x) * dirX + (op.z - p.z) * dirZ;
          return along > 0 && along < 1.2 && Math.hypot(op.x - p.x, op.z - p.z) < 1.2;
        });
        if (probe === null && !charAhead) {
          mvx = desired.x;
          mvz = desired.z;
        }
      }
      // At idle, apply only vertical motion: the controller emits micrometre
      // horizontal recovery slides that otherwise accumulate into visible creep.
      const applyX = desiredH > 1e-4 ? mvx : 0;
      const applyZ = desiredH > 1e-4 ? mvz : 0;
      char.body.setNextKinematicTranslation({ x: p.x + applyX, y: p.y + mv.y, z: p.z + applyZ });
      char.grounded = this.controller.computedGrounded();

      // Adopt the collision-resolved velocity so walls stop you (and so the
      // wire velocity/interp extrapolation matches what actually happened).
      // Skip at near-zero desired movement: the controller emits micrometre
      // penetration-recovery slides there, and adopting them as velocity
      // makes an idle character creep forever.
      // Heavily blocked movement is only adopted after 2 CONSECUTIVE blocked
      // ticks: the controller sporadically returns near-zero movement for a
      // single tick on open flat ground (same family as the autostep stall),
      // and adopting that one glitch tick reads as "randomly getting stuck" —
      // a real wall blocks every tick, so waiting one tick loses nothing.
      const blockedHard = desiredH > 1e-4 && Math.hypot(mvx, mvz) < desiredH * 0.8;
      char.blockedTicks = blockedHard ? char.blockedTicks + 1 : 0;
      if (desiredH <= 1e-4) {
        char.v.x = 0;
        char.v.z = 0;
      } else if (!blockedHard || char.blockedTicks >= 2) {
        char.v.x = mvx / TICK_DT;
        char.v.z = mvz / TICK_DT;
      }
      if (char.grounded && char.v.y < 0) char.v.y = 0;
      else if (Math.abs(mv.y) < Math.abs(desired.y) * 0.5 && char.v.y > 0) char.v.y = 0; // head bonk
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
    const q = yawQuat(char.yaw);
    return {
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
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
    char.yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
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
