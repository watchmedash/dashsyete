import { describe, it, expect } from "vitest";
import { WEAPONS, GRENADE, DEFAULT_WEAPON, grenadeDamage } from "./weapons";

describe("weapons", () => {
  it("has the default weapon in the table", () => {
    expect(WEAPONS[DEFAULT_WEAPON]).toBeDefined();
  });
  it("every weapon has sane numbers", () => {
    for (const w of Object.values(WEAPONS)) {
      expect(w.damage).toBeGreaterThan(0);
      expect(w.cooldownTicks).toBeGreaterThan(0);
      expect(w.dartSpeed).toBeGreaterThan(10);
      expect(w.model.length).toBeGreaterThan(0);
    }
  });
  it("grenade damage falls off linearly to zero at the blast radius", () => {
    expect(grenadeDamage(0)).toBe(GRENADE.maxDamage);
    expect(grenadeDamage(GRENADE.radius)).toBe(0);
    expect(grenadeDamage(GRENADE.radius * 2)).toBe(0);
    expect(grenadeDamage(GRENADE.radius / 2)).toBeCloseTo(GRENADE.maxDamage / 2, 5);
    expect(grenadeDamage(1)).toBeGreaterThan(grenadeDamage(2));
  });
});
