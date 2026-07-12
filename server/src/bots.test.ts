import { describe, it, expect } from "vitest";
import { steerToward } from "./bots";
import { BOTS_PER_TEAM, PLAYABLE_CARS } from "../../shared/src/constants";
import { generateBotName } from "../../shared/src/names";

describe("steerToward", () => {
  // heading 0 = facing +z; positive steer/yaw rotates +z toward +x.
  // Steering must reduce |angle to target|: target needing yaw increase
  // (toward +x) gets positive steer, toward -x gets negative.
  it("steers positive when the target needs a yaw increase (+x side)", () => {
    const { steer } = steerToward({ x: 0, z: 0 }, 0, { x: 10, z: 10 });
    expect(steer).toBeGreaterThan(0);
  });
  it("steers negative when the target needs a yaw decrease (-x side)", () => {
    const { steer } = steerToward({ x: 0, z: 0 }, 0, { x: -10, z: 10 });
    expect(steer).toBeLessThan(0);
  });
  it("goes straight at full throttle when the target is dead ahead", () => {
    const { steer, throttle } = steerToward({ x: 0, z: 0 }, 0, { x: 0, z: 20 });
    expect(Math.abs(steer)).toBeLessThan(0.05);
    expect(throttle).toBe(1);
  });
  it("slows down for near-reversals", () => {
    const { throttle } = steerToward({ x: 0, z: 0 }, 0, { x: 1, z: -20 });
    expect(throttle).toBeLessThan(1);
  });
  it("handles a rotated heading", () => {
    // facing +x (heading = PI/2), target further +x => straight
    const { steer } = steerToward({ x: 0, z: 0 }, Math.PI / 2, { x: 20, z: 0 });
    expect(Math.abs(steer)).toBeLessThan(0.05);
  });
});

describe("bot spawning invariants", () => {
  it("BOTS_PER_TEAM * 4 unique names can be generated from the pool", () => {
    const taken = new Set<string>();
    for (let i = 0; i < BOTS_PER_TEAM * 4; i++) {
      const n = generateBotName(taken);
      expect(taken.has(n)).toBe(false);
      taken.add(n);
    }
    expect(taken.size).toBe(BOTS_PER_TEAM * 4);
  });
  it("playable car list is non-empty for bot car picks", () => {
    expect(PLAYABLE_CARS.length).toBeGreaterThan(0);
  });
});
