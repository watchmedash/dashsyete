import { describe, it, expect } from "vitest";
import { buildCityMap, tileToWorld } from "./cityMap";
import { CHAR_RADIUS } from "./character";

const map = buildCityMap();

describe("downtown map", () => {
  it("is deterministic", () => {
    expect(JSON.stringify(buildCityMap())).toEqual(JSON.stringify(buildCityMap()));
  });

  it("has a dense street network", () => {
    const streets = map.tiles.filter((t) => t.model.startsWith("Street_"));
    expect(streets.length).toBeGreaterThan(150);
  });

  it("every placed model with a collider has a measured footprint (build throws otherwise)", () => {
    expect(map.colliders.length).toBeGreaterThan(50);
  });

  it("has ≥16 spawns, all ≥30 m apart and clear of colliders", () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(16);
    for (let i = 0; i < map.spawns.length; i++) {
      for (let j = i + 1; j < map.spawns.length; j++) {
        const a = map.spawns[i];
        const b = map.spawns[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(30);
      }
      const s = map.spawns[i];
      for (const c of map.colliders) {
        const blocks =
          Math.abs(s.x - c.x) < c.hx + CHAR_RADIUS &&
          Math.abs(s.z - c.z) < c.hz + CHAR_RADIUS &&
          c.y - c.hy < 1.9 &&
          c.y + c.hy > 0.3; // curbs (0.15) don't block a spawn
        expect(blocks, `spawn (${s.x},${s.z}) blocked by collider at (${c.x},${c.z})`).toBe(false);
      }
    }
  });

  it("places every crate on the island and clear of building colliders", () => {
    expect(map.crateSpawns.length).toBeGreaterThanOrEqual(12);
    for (const cs of map.crateSpawns) {
      const onGround = map.grounds.some(
        (g) => cs.x > g.x0 && cs.x < g.x1 && cs.z > g.z0 && cs.z < g.z1,
      );
      expect(onGround, `crate (${cs.x},${cs.z}) off the island`).toBe(true);
      const floor = cs.y ?? 0; // lobby pickups stand on the y=1 interior slab
      for (const c of map.colliders) {
        if (c.y + c.hy <= floor + 0.05) continue; // the slab it stands ON
        const blocked =
          Math.abs(cs.x - c.x) < c.hx + 0.4 &&
          Math.abs(cs.z - c.z) < c.hz + 0.4 &&
          c.y + c.hy > floor + 0.3 &&
          c.y - c.hy < floor + 1.9;
        expect(blocked, `crate (${cs.x},${cs.z}) inside collider at (${c.x},${c.z})`).toBe(false);
      }
    }
  });

  it("keeps street centerlines free of building colliders", () => {
    for (const t of map.tiles) {
      if (!t.model.startsWith("Street_2Lane") || t.model.includes("noSidewalk")) continue;
      const x = tileToWorld(t.gx);
      const z = tileToWorld(t.gz);
      for (const c of map.colliders) {
        if (c.hy <= 0.15) continue; // curbs live on streets by design
        const overlap = Math.abs(x - c.x) < c.hx && Math.abs(z - c.z) < c.hz && c.y - c.hy < 1.9;
        expect(overlap, `collider (${c.x.toFixed(1)},${c.z.toFixed(1)}) on street at (${x},${z})`).toBe(false);
      }
    }
  });
});
