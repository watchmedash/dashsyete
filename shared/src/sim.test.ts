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

  it("detects a car resting on its side as flipped", () => {
    const car = sim.addCar("side", 30, -30, 0);
    // roll ~90° about z: car on its side
    car.body.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.isFlipped("side")).toBe(true);
    sim.removeCar("side");
  });

  it("hard cornering at top speed does not flip the car", () => {
    sim.addCar("corner", -60, -30, 0);
    sim.setInput("corner", { ...idle, seq: 1, throttle: 1 });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step(); // reach speed
    sim.setInput("corner", { ...idle, seq: 2, throttle: 1, steer: 1 });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step(); // full lock at speed
    expect(sim.isFlipped("corner")).toBe(false);
    sim.removeCar("corner");
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

