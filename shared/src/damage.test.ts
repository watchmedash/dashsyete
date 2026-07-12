import { describe, it, expect } from "vitest";
import { impactDamage, damageBetween } from "./damage";
import { DAMAGE_MIN_SPEED, DAMAGE_CAP, DAMAGE_PER_SPEED } from "./constants";

describe("impactDamage", () => {
  it("is zero below the bump threshold", () => {
    expect(impactDamage(0)).toBe(0);
    expect(impactDamage(DAMAGE_MIN_SPEED - 0.01)).toBe(0);
  });
  it("scales linearly above the threshold", () => {
    expect(impactDamage(DAMAGE_MIN_SPEED + 2)).toBeCloseTo(2 * DAMAGE_PER_SPEED);
  });
  it("caps per hit", () => {
    expect(impactDamage(1000)).toBe(DAMAGE_CAP);
  });
});

describe("damageBetween", () => {
  it("same team deals zero regardless of speed", () => {
    expect(damageBetween(1, 1, 50)).toBe(0);
  });
  it("enemy teams use impactDamage", () => {
    expect(damageBetween(0, 2, DAMAGE_MIN_SPEED + 1)).toBe(impactDamage(DAMAGE_MIN_SPEED + 1));
  });
});
