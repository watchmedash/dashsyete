import { describe, it, expect, beforeAll } from "vitest";
import { Sim } from "./sim";
import { TICK_RATE } from "./constants";

let sim: Sim;
beforeAll(async () => {
  sim = await Sim.create();
});

const idle = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

describe("Sim", () => {
  it("a spawned car settles on the ground, not falling forever", () => {
    sim.addCar("a", 0, -30, 0);
    for (let i = 0; i < TICK_RATE * 2; i++) sim.step();
    const { p } = sim.getState("a");
    expect(p[1]).toBeGreaterThan(0);
    expect(p[1]).toBeLessThan(2);
    sim.removeCar("a");
  });

  it("full throttle moves the car", () => {
    sim.addCar("b", 0, -30, 0);
    sim.setInput("b", { ...idle, seq: 1, throttle: 1 });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    const { v } = sim.getState("b");
    expect(Math.hypot(v[0], v[2])).toBeGreaterThan(5);
    sim.removeCar("b");
  });

  it("a short throttle tap rolls to a near-stop instead of cruising forever", () => {
    sim.addCar("coast", 0, -30, 0);
    sim.setInput("coast", { ...idle, seq: 1, throttle: 1 });
    for (let i = 0; i < TICK_RATE; i++) sim.step(); // 1 s tap
    const at = sim.getState("coast");
    const launch = Math.hypot(at.v[0], at.v[2]);
    expect(launch).toBeGreaterThan(8);
    sim.setInput("coast", { ...idle, seq: 2 });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    const after = sim.getState("coast");
    // Engine braking: 3 s after releasing a tap the car is close to stopped.
    expect(Math.hypot(after.v[0], after.v[2])).toBeLessThan(3);
    sim.removeCar("coast");
  });

  it("two cars slammed together produce an impact event", () => {
    // On the avenue, 36 m apart, facing each other (+z forward at rotY=0).
    // Longer approaches let tiny numerical drift turn head-ons into misses.
    sim.addCar("l", 6, -12, 0);
    sim.addCar("r", 6, 24, Math.PI);
    sim.setInput("l", { ...idle, seq: 1, throttle: 1 });
    sim.setInput("r", { ...idle, seq: 1, throttle: 1 });
    const impacts: { a: string; b: string; relSpeed: number }[] = [];
    for (let i = 0; i < TICK_RATE * 6; i++) impacts.push(...sim.step());
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts.some((e) => e.relSpeed > 5)).toBe(true);
    sim.removeCar("l");
    sim.removeCar("r");
  });

  it("a car driven off an island falls into the sea", () => {
    sim.addCar("wet", 80, 80, 0);
    // SE corner of the center island, moving offshore
    sim.setState("wet", [90, 1.2, 90], [0, 0, 0, 1], [20, 0, 20]);
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    expect(sim.getState("wet").p[1]).toBeLessThan(-2);
    sim.removeCar("wet");
  });

  it("a car dropped on its side self-rights onto its wheels", () => {
    const car = sim.addCar("side", 6, -40, 0); // on the open north avenue
    // roll ~90° about z: car on its side
    car.body.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    const q = sim.getState("side").q;
    const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
    expect(upY).toBeGreaterThan(0.5); // low ballast + rounded chassis roll it back
    sim.removeCar("side");
  });

  it("detects a fully inverted car as flipped", () => {
    const car = sim.addCar("inv", 6, -40, 0);
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // 180° roll: on its roof
    for (let i = 0; i < TICK_RATE; i++) sim.step();
    expect(sim.isFlipped("inv")).toBe(true);
    sim.removeCar("inv");
  });

  it("hard cornering at top speed does not flip the car", () => {
    // start deep south on the center island so the whole maneuver stays ashore
    sim.addCar("corner", -60, -80, 0);
    sim.setInput("corner", { ...idle, seq: 1, throttle: 1 });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step(); // reach speed heading +z
    sim.setInput("corner", { ...idle, seq: 2, throttle: 1, steer: 1 });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step(); // full lock at speed
    const { p } = sim.getState("corner");
    expect(p[1]).toBeGreaterThan(0); // still on land — the test is invalid if it swam
    expect(sim.isFlipped("corner")).toBe(false);
    sim.removeCar("corner");
  });

  it("a dynamic prop settles and is shoved by a car without stopping it", () => {
    sim.addProp("prop-t", { x: 0.5, y: 0.6, z: 0.5 }, 6, -30, 25);
    for (let i = 0; i < 30; i++) sim.step();
    const before = sim.getPropState("prop-t").p;
    expect(before[1]).toBeLessThan(1); // settled on the road

    sim.addCar("shover", 6, -45, 0);
    sim.setInput("shover", { ...idle, seq: 1, throttle: 1 });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    const after = sim.getPropState("prop-t").p;
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
    expect(moved).toBeGreaterThan(2);
    const { v } = sim.getState("shover");
    expect(Math.hypot(v[0], v[2])).toBeGreaterThan(8); // barely slowed the car
    sim.removeCar("shover");
    sim.removeProp("prop-t");
  });

  it("teleport resets position and velocity", () => {
    sim.addCar("t", 6, -42, 0);
    sim.setInput("t", { ...idle, seq: 1, throttle: 1 });
    for (let i = 0; i < TICK_RATE; i++) sim.step();
    sim.teleport("t", -84, -84, 0);
    const { p, v } = sim.getState("t");
    expect(p[0]).toBeCloseTo(-84, 0);
    expect(p[2]).toBeCloseTo(-84, 0);
    expect(Math.hypot(v[0], v[1], v[2])).toBeLessThan(0.01);
    sim.removeCar("t");
  });
});

