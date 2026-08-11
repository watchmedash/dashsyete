import { describe, it, expect } from "vitest";
import { buildCityMap, buildCustomMap, tileToWorld } from "./cityMap";
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

  it("builds an editor export end-to-end (custom map round trip)", () => {
    // a tiny editor export: a street cross, one building, one decal
    const pieces = [
      { model: "Street_2Lane", x: 0, y: 0, z: 0, rot: 0 as const },
      { model: "Street_2Lane", x: 0, y: 0, z: 12, rot: 0 as const },
      { model: "Street_2Lane", x: 0, y: 0, z: -12, rot: 0 as const },
      { model: "Street_2Lane", x: 12, y: 0, z: 0, rot: 1 as const },
      { model: "Street_2Lane", x: -12, y: 0, z: 0, rot: 1 as const },
      { model: "Building_Small_1", x: 20, y: 0, z: 20, rot: 2 as const },
      { model: "Decal_Crosswalk", x: 0, y: 0, z: 0, rot: 0 as const },
    ];
    const m = buildCustomMap(pieces);
    expect(m.tiles.length).toBe(pieces.length);
    // the building is solid, the streets and decal are not
    expect(m.colliders.length).toBe(1);
    expect(Math.abs(m.colliders[0].x - 20)).toBeLessThan(10);
    // playable: spawns on streets, pickups, ship route, one ground slab
    expect(m.spawns.length).toBeGreaterThan(0);
    for (const s of m.spawns) {
      expect(pieces.some((p) => p.model.startsWith("Street_") && p.x === s.x && p.z === s.z)).toBe(true);
    }
    expect(m.crateSpawns.length).toBeGreaterThan(0);
    expect(m.shipPath.length).toBe(4);
    expect(m.grounds.length).toBe(1);
    // deterministic
    expect(JSON.stringify(buildCustomMap(pieces))).toEqual(JSON.stringify(m));
  });

  it("size field only ever widens the ground slab", () => {
    const pieces = [{ model: "Street_2Lane", x: 0, y: 0, z: 0, rot: 0 as const }];
    const small = buildCustomMap(pieces); // extent from pieces alone (±15)
    const sized = buildCustomMap(pieces, { w: 7, d: 3 }); // 7×3 tiles = ±168/±72
    const g0 = small.grounds[0];
    const g1 = sized.grounds[0];
    expect(g1.x1 - g1.x0).toBeGreaterThan(g0.x1 - g0.x0);
    expect(g1.x1).toBeCloseTo((7 * 48) / 2);
    expect(g1.z1).toBeCloseTo(72);
    // a size SMALLER than the authored footprint never shrinks the island
    const clamped = buildCustomMap(pieces, { w: 0, d: 0 });
    expect(JSON.stringify(clamped.grounds)).toEqual(JSON.stringify(small.grounds));
    // old exports without a size field stay valid
    expect(() => buildCustomMap(pieces, undefined)).not.toThrow();
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
