import RAPIER from "@dimforge/rapier3d-compat";
import { buildCityMap, type CityMap } from "./cityMap";
import { TICK_DT, TILE } from "./constants";
import type { InputState } from "./protocol";
import {
  ANGULAR_DAMPING, BALLAST_DROP, BRAKE_FORCE, IDLE_BRAKE, STEER_RATE, CHASSIS_HALF, CHASSIS_MASS, ENGINE_FORCE, HANDBRAKE_FORCE, STEER_SPEED_FALLOFF,
  MAX_POP_VY, MAX_SPEED, MAX_STEER, MAX_TUMBLE, REVERSE_FORCE, SIDE_FRICTION, SUSPENSION_COMPRESSION, SUSPENSION_RELAXATION, SUSPENSION_STIFFNESS, WHEEL_POSITIONS, WHEEL_RADIUS, WHEEL_REST,
} from "./vehicle";

export interface SimCar {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.DynamicRayCastVehicleController;
  input: InputState;
  /** Smoothed steering state (binary keyboard input ramps instead of snapping). */
  steer: number;
  /** Consecutive ticks the car has been idle + motionless (sleep gate). */
  stillTicks: number;
}

export interface ImpactEvent {
  a: string;
  b: string;
  relSpeed: number;
  /** True when the car's FRONT hit the other car (its weapon side — the
   * frontal car deals damage without taking any). */
  aFrontal: boolean;
  bFrontal: boolean;
}

// The other car must be within this half-angle of the nose to count as a
// frontal hit.
const FRONT_ARC = Math.PI / 3;

const IDLE: InputState = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

export class Sim {
  readonly map: CityMap;
  private world: RAPIER.World;
  private events: RAPIER.EventQueue;
  private cars = new Map<string, SimCar>();
  private carByCollider = new Map<number, string>();

  private constructor(map: CityMap) {
    this.map = map;
    // Stronger-than-earth gravity: arcade cars feel planted instead of
    // floating away like cardboard on every bump.
    this.world = new RAPIER.World({ x: 0, y: -16, z: 0 });
    this.events = new RAPIER.EventQueue(true);

    // One ground slab per landmass (islands/islets/bridge decks); the sea
    // between them has no floor — cars fall in and sink.
    for (const g of map.grounds) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation((g.x0 + g.x1) / 2, -1, (g.z0 + g.z1) / 2),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((g.x1 - g.x0) / 2, 1, (g.z1 - g.z0) / 2),
        body,
      );
    }

    // Static city colliders (buildings, walls, arena bounds)
    for (const c of map.colliders) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz), body);
    }
  }

  static async create(): Promise<Sim> {
    await RAPIER.init();
    return new Sim(buildCityMap());
  }

  addCar(id: string, x: number, z: number, rotY: number): SimCar {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, WHEEL_REST + WHEEL_RADIUS + CHASSIS_HALF.y, z)
        .setRotation(yawQuat(rotY))
        .setAngularDamping(ANGULAR_DAMPING) // no fishtailing after steering, harder to flip
        .setCcdEnabled(true), // cars move ~0.5 m/tick at top speed; prevent tunneling
    );
    // Rounded chassis: sharp box corners catch on other chassis and lever
    // cars into the air on simple bumps; rounded edges slide past instead.
    // Zero restitution + low friction keep contacts from launching anyone.
    const R = 0.15;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(
        CHASSIS_HALF.x - R, CHASSIS_HALF.y - R, CHASSIS_HALF.z - R, R,
      )
        .setMass(CHASSIS_MASS * 0.3)
        .setRestitution(0)
        .setFriction(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      body,
    );
    // Anti-flip: most of the mass lives in a small dense slab hanging below
    // the chassis floor, pulling the center of mass down.
    // (setAdditionalMassProperties kills contact events in this rapier
    // version; and the slab must be SMALLER than the chassis in x/z so
    // car-vs-car contacts always happen chassis-to-chassis — only the chassis
    // collider carries the CONTACT_FORCE_EVENTS flag.)
    // Slab proportions matter: LONG in z so the yaw inertia is high enough
    // that per-tick side-friction impulses can't seesaw the heading (the
    // "uncontrollable buzz"), NARROW in x so a broadside shove can't pivot
    // the car over the slab's edge (trip-flip).
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(CHASSIS_HALF.x * 0.5, 0.05, CHASSIS_HALF.z * 0.85)
        .setTranslation(0, -CHASSIS_HALF.y - BALLAST_DROP, 0)
        .setMass(CHASSIS_MASS * 0.7),
      body,
    );
    const controller = this.world.createVehicleController(body);
    controller.setIndexForwardAxis = 2; // cars are z-forward (default is x)
    WHEEL_POSITIONS.forEach((pos, i) => {
      controller.addWheel(
        { x: pos[0], y: pos[1], z: pos[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        WHEEL_REST,
        WHEEL_RADIUS,
      );
      controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
      controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
      controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
      controller.setWheelSideFrictionStiffness(i, SIDE_FRICTION);
    });
    const car: SimCar = { id, body, collider, controller, input: { ...IDLE }, steer: 0, stillTicks: 0 };
    this.cars.set(id, car);
    this.carByCollider.set(collider.handle, id);
    return car;
  }

  removeCar(id: string): void {
    const car = this.cars.get(id);
    if (!car) return;
    this.carByCollider.delete(car.collider.handle);
    this.world.removeVehicleController(car.controller);
    this.world.removeRigidBody(car.body);
    this.cars.delete(id);
  }

  hasCar(id: string): boolean {
    return this.cars.has(id);
  }

  setInput(id: string, input: InputState): void {
    const car = this.cars.get(id);
    if (car) car.input = input;
  }

  teleport(id: string, x: number, z: number, rotY: number): void {
    const car = this.cars.get(id);
    if (!car) return;
    car.body.setTranslation({ x, y: WHEEL_REST + WHEEL_RADIUS + CHASSIS_HALF.y, z }, true);
    car.body.setRotation(yawQuat(rotY), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.input = { ...IDLE };
  }

  /** Advance one fixed tick; returns car-vs-car impacts. */
  step(): ImpactEvent[] {
    for (const car of this.cars.values()) {
      const { input, controller, collider } = car;
      const vel = car.body.linvel();
      const speed = Math.hypot(vel.x, vel.z);
      // Idle cars SLEEP. The controller applies suspension/friction impulses
      // every tick; at rest those feed a slow yaw+creep instability (the car
      // "walks" with no input). Skipping the controller and sleeping the body
      // freezes it dead; a collision or new input wakes it. Sleep only after
      // SUSTAINED stillness (the settle bounce passes through v=0 at its
      // extremes — freezing there parks the car at the wrong ride height) and
      // only with all wheels grounded — never freeze a car mid-air.
      const idleInput = input.throttle === 0 && input.brake === 0 && !input.handbrake;
      const av = car.body.angvel();
      // The walk is a SLIDE (brakes don't affect it): controller side-friction
      // impulses re-inject velocity every tick. Actively bleed horizontal
      // velocity + yaw at idle crawl speeds so the car reaches the sleep gate.
      if (idleInput && speed < 0.5) {
        car.body.setLinvel({ x: vel.x * 0.8, y: vel.y, z: vel.z * 0.8 }, false);
        car.body.setAngvel({ x: av.x, y: av.y * 0.8, z: av.z }, false);
      }
      const still =
        idleInput && speed < 0.1 && Math.abs(vel.y) < 0.1 && Math.hypot(av.x, av.y, av.z) < 0.1 &&
        [0, 1, 2, 3].every((i) => controller.wheelIsInContact(i));
      car.stillTicks = still ? car.stillTicks + 1 : 0;
      if (car.stillTicks >= 10) {
        car.body.sleep();
        continue;
      }
      // Taper drive force near the speed cap instead of a hard cutoff — the
      // on/off cutoff surges longitudinally at MAX_SPEED (camera push-pull).
      const headroom = Math.max(0, Math.min(1, (MAX_SPEED - speed) / 3));
      const revHeadroom = Math.max(0, Math.min(1, (12 - speed) / 3));
      const engine =
        input.throttle >= 0
          ? input.throttle * ENGINE_FORCE * headroom
          : input.throttle * REVERSE_FORCE * revHeadroom;
      // Smoothed steering: ramp toward the commanded value instead of
      // snapping (binary keyboard input otherwise jerks the yaw rate).
      const maxDelta = STEER_RATE * TICK_DT;
      car.steer += Math.max(-maxDelta, Math.min(maxDelta, input.steer - car.steer));
      // Speed-sensitive steering: full lock when slow, gentler at speed
      // (full lock at 28 m/s rolls the car).
      const lock = MAX_STEER / (1 + speed / STEER_SPEED_FALLOFF);
      controller.setWheelSteering(0, car.steer * lock);
      controller.setWheelSteering(1, car.steer * lock);
      controller.setWheelEngineForce(2, engine);
      controller.setWheelEngineForce(3, engine);
      // Low-speed parking brake: bleeds off a slow post-bump roll so the car
      // drops under the sleep threshold above. Speed-gated so impacts and
      // coasting are unaffected (a braked victim trips over its own wheels).
      const brake = input.brake * BRAKE_FORCE + (idleInput && speed < 2 ? IDLE_BRAKE : 0);
      for (let i = 0; i < 4; i++) controller.setWheelBrake(i, brake);
      if (input.handbrake) {
        controller.setWheelBrake(2, HANDBRAKE_FORCE);
        controller.setWheelBrake(3, HANDBRAKE_FORCE);
      }
      // Exclude ALL of the car's own colliders (chassis + ballast slab) from
      // the wheel raycasts.
      controller.updateVehicle(TICK_DT, undefined, undefined, (c) => c.parent()?.handle !== car.body.handle);
    }

    // Impact damage must use pre-step velocities: after the step the collision
    // impulse has already equalized them and the relative speed reads ~0.
    const preVel = new Map<string, { x: number; y: number; z: number }>();
    for (const car of this.cars.values()) {
      const v = car.body.linvel();
      preVel.set(car.id, { x: v.x, y: v.y, z: v.z });
    }

    this.world.timestep = TICK_DT;
    this.world.step(this.events);

    // Arcade sanity clamps: contact geometry (a rounded nose wedging under a
    // broadside chassis) can produce unbounded launch/roll impulses. Cap
    // upward velocity and roll/pitch rate so cars hop and rock but never fly
    // or barrel-roll off a hit.
    for (const car of this.cars.values()) {
      const v = car.body.linvel();
      if (v.y > MAX_POP_VY) car.body.setLinvel({ x: v.x, y: MAX_POP_VY, z: v.z }, false);
      const av = car.body.angvel();
      const tumble = Math.hypot(av.x, av.z);
      if (tumble > MAX_TUMBLE) {
        const s = MAX_TUMBLE / tumble;
        car.body.setAngvel({ x: av.x * s, y: av.y, z: av.z * s }, false);
      }
    }

    const impacts: ImpactEvent[] = [];
    this.events.drainContactForceEvents((e) => {
      const idA = this.carByCollider.get(e.collider1());
      const idB = this.carByCollider.get(e.collider2());
      if (!idA || !idB || idA === idB) return;
      const va = preVel.get(idA)!;
      const vb = preVel.get(idB)!;
      const relSpeed = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
      impacts.push({
        a: idA,
        b: idB,
        relSpeed,
        aFrontal: this.hitWithFront(idA, idB),
        bFrontal: this.hitWithFront(idB, idA),
      });
    });
    return impacts;
  }

  /** True when `otherId` lies within the frontal arc of `id`'s nose. */
  private hitWithFront(id: string, otherId: string): boolean {
    const me = this.cars.get(id)!.body;
    const other = this.cars.get(otherId)!.body;
    const p = me.translation();
    const o = other.translation();
    const q = me.rotation();
    const heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    let bearing = Math.atan2(o.x - p.x, o.z - p.z) - heading;
    while (bearing > Math.PI) bearing -= 2 * Math.PI;
    while (bearing < -Math.PI) bearing += 2 * Math.PI;
    return Math.abs(bearing) < FRONT_ARC;
  }

  getState(id: string): { p: [number, number, number]; q: [number, number, number, number]; v: [number, number, number] } {
    const car = this.cars.get(id)!;
    const p = car.body.translation();
    const q = car.body.rotation();
    const v = car.body.linvel();
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z] };
  }

  private kinematics = new Map<string, RAPIER.RigidBody>();
  private propBodies = new Map<string, RAPIER.RigidBody>();

  /** Adds a light knockable prop (cone, box, hay bale...). Never deals damage. */
  addProp(id: string, half: { x: number; y: number; z: number }, x: number, z: number, massKg: number): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, half.y + 0.5, z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.8)
        .setCcdEnabled(true), // small + light: a top-speed car tunnels through otherwise
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

  getPropState(id: string): { p: [number, number, number]; q: [number, number, number, number] } {
    const body = this.propBodies.get(id)!;
    const p = body.translation();
    const q = body.rotation();
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] };
  }

  /** Adds a kinematic box body (e.g. the train) that blocks cars but never deals damage. */
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

  /** Hard-set a car's full physics state (used by client prediction corrections). */
  setState(
    id: string,
    p: [number, number, number],
    q: [number, number, number, number],
    v: [number, number, number],
  ): void {
    const car = this.cars.get(id);
    if (!car) return;
    car.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    car.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    car.body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
  }

  /** Nudge a car toward a target state (soft prediction correction). */
  blendState(
    id: string,
    p: [number, number, number],
    q: [number, number, number, number],
    v: [number, number, number],
    alpha: number,
  ): void {
    const car = this.cars.get(id);
    if (!car) return;
    const cp = car.body.translation();
    const cv = car.body.linvel();
    car.body.setTranslation(
      { x: cp.x + (p[0] - cp.x) * alpha, y: cp.y + (p[1] - cp.y) * alpha, z: cp.z + (p[2] - cp.z) * alpha },
      true,
    );
    const cq = car.body.rotation();
    const t = alpha;
    // nlerp is fine for small corrections
    let dot = cq.x * q[0] + cq.y * q[1] + cq.z * q[2] + cq.w * q[3];
    const s = dot < 0 ? -1 : 1;
    dot *= s;
    const nx = cq.x + (q[0] * s - cq.x) * t;
    const ny = cq.y + (q[1] * s - cq.y) * t;
    const nz = cq.z + (q[2] * s - cq.z) * t;
    const nw = cq.w + (q[3] * s - cq.w) * t;
    const len = Math.hypot(nx, ny, nz, nw) || 1;
    car.body.setRotation({ x: nx / len, y: ny / len, z: nz / len, w: nw / len }, true);
    car.body.setLinvel(
      { x: cv.x + (v[0] - cv.x) * alpha, y: cv.y + (v[1] - cv.y) * alpha, z: cv.z + (v[2] - cv.z) * alpha },
      true,
    );
  }

  /** True if the car's local up vector points below the horizon (flipped). */
  isFlipped(id: string): boolean {
    const car = this.cars.get(id);
    if (!car) return false;
    const q = car.body.rotation();
    // up = quat * (0,1,0): y component of the rotated up vector.
    // < 0.3 also catches cars resting on their side, not just fully inverted.
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return upY < 0.3;
  }
}

function yawQuat(rotY: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) };
}









