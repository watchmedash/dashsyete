import { describe, it, expect } from "vitest";
import { buildSkyWorld, ISLANDS, SKY_KILL_Y, B_GRASS, B_PLANK } from "./skyMap";

const sky = buildSkyWorld();

describe("sky-island generation", () => {
  it("is deterministic for the same seed", () => {
    expect(buildSkyWorld().world.serialize()).toBe(sky.world.serialize());
    expect(buildSkyWorld(7).world.serialize()).not.toBe(sky.world.serialize());
  });

  it("builds a substantial world (all islands present)", () => {
    let cells = 0;
    for (const c of sky.world.chunks.values()) for (const v of c) if (v !== 0) cells++;
    expect(cells).toBeGreaterThan(8000);
    for (const isl of ISLANDS) {
      // island center column has a surface near topY
      let found = false;
      for (let y = isl.topY + 3; y >= isl.topY - 2; y--) if (sky.world.solid(isl.cx, y, isl.cz)) found = true;
      expect(found, `island at ${isl.cx},${isl.cz}`).toBe(true);
    }
  });

  it("everything floats above the kill floor", () => {
    for (const key of sky.world.chunks.keys()) {
      const cy = Number(key.split(",")[1]);
      expect(cy * 16 + 16).toBeGreaterThan(SKY_KILL_Y);
    }
  });

  it("spawns stand on walkable ground with headroom, spread apart", () => {
    expect(sky.spawns.length).toBeGreaterThanOrEqual(12);
    for (const s of sky.spawns) {
      const bx = Math.floor(s.x);
      const bz = Math.floor(s.z);
      const below = sky.world.get(bx, s.y - 1, bz);
      expect([B_GRASS, B_PLANK]).toContain(below);
      expect(sky.world.solid(bx, s.y, bz)).toBe(false);
      expect(sky.world.solid(bx, s.y + 1, bz)).toBe(false);
    }
    for (let i = 0; i < sky.spawns.length; i++)
      for (let j = i + 1; j < sky.spawns.length; j++) {
        const a = sky.spawns[i];
        const b = sky.spawns[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(13);
      }
  });

  it("crates sit on solid ground and cover the item table", () => {
    expect(sky.crateSpawns.length).toBeGreaterThanOrEqual(10);
    const weapons = new Set(sky.crateSpawns.map((c) => c.weapon));
    expect(weapons.size).toBeGreaterThanOrEqual(6);
    for (const c of sky.crateSpawns) {
      expect(sky.world.solid(Math.floor(c.x), c.y - 1, Math.floor(c.z))).toBe(true);
    }
  });

  it("bridges connect the main island to every satellite (walk the line)", () => {
    for (let i = 1; i < ISLANDS.length; i++) {
      const a = ISLANDS[0];
      const b = ISLANDS[i];
      const len = Math.hypot(b.cx - a.cx, b.cz - a.cz);
      let gaps = 0;
      for (let s = a.r * 0.7; s <= len - b.r * 0.7; s += 1) {
        const x = Math.round(a.cx + ((b.cx - a.cx) / len) * s);
        const z = Math.round(a.cz + ((b.cz - a.cz) / len) * s);
        // solid ground somewhere in the band below head height
        let ok = false;
        for (let y = 35; y > 12; y--) if (sky.world.solid(x, y, z)) { ok = true; break; }
        if (!ok) gaps++;
      }
      expect(gaps, `bridge to island ${i}`).toBe(0);
    }
  });
});
