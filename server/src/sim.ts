import RAPIER from "@dimforge/rapier3d-compat";
import { buildCityMap, type CityMap } from "../../shared/src/cityMap";
import { TICK_DT, TILE } from "../../shared/src/constants";
import type { InputState } from "../../shared/src/protocol";
import {
  BRAKE_FORCE, CHASSIS_HALF, CHASSIS_MASS, ENGINE_FORCE, HANDBRAKE_FORCE,
  MAX_STEER, REVERSE_FORCE, SUSPENSION_STIFFNESS, WHEEL_POSITIONS, WHEEL_RADIUS, WHEEL_REST,
} from "../../shared/src/vehicle";

export interface SimCar {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.DynamicRayCastVehicleController;
  input: InputState;
}

export interface ImpactEvent {
  a: string;
  b: string;
  relSpeed: number;
}

const IDLE: InputState = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

export class Sim {
  readonly map: CityMap;
  private world: RAPIER.World;
  private events: RAPIER.EventQueue;
  private cars = new Map<string, SimCar>();
  private carByCollider = new Map<number, string>();

  private constructor(map: CityMap) {
    this.map = map;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.events = new RAPIER.EventQueue(true);

    // Ground slab covering the whole map
    const span = (map.size * TILE) / 2;
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(span * 2, 0.5, span * 2), ground);

    // Static city colliders (buildings, walls, arena bounds)
    for (const c of map.colliders) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz), body);
    }
  }

  static async create(): Promise<Sim> {
    await RAPIER.init({});
    return new Sim(buildCityMap());
  }

  addCar(id: string, x: number, z: number, rotY: number): SimCar {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, WHEEL_REST + WHEEL_RADIUS + CHASSIS_HALF.y, z)
        .setRotation(yawQuat(rotY)),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(CHASSIS_HALF.x, CHASSIS_HALF.y, CHASSIS_HALF.z)
        .setMass(CHASSIS_MASS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      body,
    );
    const controller = this.world.createVehicleController(body);
    WHEEL_POSITIONS.forEach((pos, i) => {
      controller.addWheel(
        { x: pos[0], y: pos[1], z: pos[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        WHEEL_REST,
        WHEEL_RADIUS,
      );
      controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
    });
    const car: SimCar = { id, body, collider, controller, input: { ...IDLE } };
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
      const engine =
        input.throttle >= 0 ? input.throttle * ENGINE_FORCE : input.throttle * REVERSE_FORCE;
      controller.setWheelSteering(0, input.steer * MAX_STEER);
      controller.setWheelSteering(1, input.steer * MAX_STEER);
      controller.setWheelEngineForce(2, engine);
      controller.setWheelEngineForce(3, engine);
      const brake = input.brake * BRAKE_FORCE;
      for (let i = 0; i < 4; i++) controller.setWheelBrake(i, brake);
      if (input.handbrake) {
        controller.setWheelBrake(2, HANDBRAKE_FORCE);
        controller.setWheelBrake(3, HANDBRAKE_FORCE);
      }
      controller.updateVehicle(TICK_DT, undefined, undefined, (c) => c !== collider);
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

    const impacts: ImpactEvent[] = [];
    this.events.drainContactForceEvents((e) => {
      const idA = this.carByCollider.get(e.collider1());
      const idB = this.carByCollider.get(e.collider2());
      if (!idA || !idB || idA === idB) return;
      const va = preVel.get(idA)!;
      const vb = preVel.get(idB)!;
      const relSpeed = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
      impacts.push({ a: idA, b: idB, relSpeed });
    });
    return impacts;
  }

  getState(id: string): { p: [number, number, number]; q: [number, number, number, number]; v: [number, number, number] } {
    const car = this.cars.get(id)!;
    const p = car.body.translation();
    const q = car.body.rotation();
    const v = car.body.linvel();
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z] };
  }

  /** True if the car's local up vector points below the horizon (flipped). */
  isFlipped(id: string): boolean {
    const car = this.cars.get(id);
    if (!car) return false;
    const q = car.body.rotation();
    // up = quat * (0,1,0): y component of the rotated up vector
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return upY < 0;
  }
}

function yawQuat(rotY: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) };
}
