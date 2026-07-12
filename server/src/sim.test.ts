import { describe, it, expect, beforeAll } from "vitest";
import { Sim } from "./sim";
import { TICK_RATE } from "../../shared/src/constants";

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
    sim.addCar("l", 6, -42, 0);        // on the avenue, facing each other (+z forward at rotY=0)
    sim.addCar("r", 6, 66, Math.PI);
    sim.setInput("l", { ...idle, seq: 1, throttle: 1 });
    sim.setInput("r", { ...idle, seq: 1, throttle: 1 });
    const impacts: { a: string; b: string; relSpeed: number }[] = [];
    for (let i = 0; i < TICK_RATE * 6; i++) impacts.push(...sim.step());
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts.some((e) => e.relSpeed > 5)).toBe(true);
    sim.removeCar("l");
    sim.removeCar("r");
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
