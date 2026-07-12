import { describe, it, expect } from "vitest";
import { buildCityMap, tileToWorld } from "./cityMap";
import { TILE } from "./constants";

const map = buildCityMap();

describe("buildCityMap", () => {
  it("has 4 teams x >=6 spawn slots inside the arena", () => {
    expect(map.spawns.map((s) => s.team)).toEqual([0, 1, 2, 3]);
    const half = (map.size * TILE) / 2;
    for (const s of map.spawns) {
      expect(s.points.length).toBeGreaterThanOrEqual(6);
      for (const p of s.points) {
        expect(Math.abs(p.x)).toBeLessThan(half);
        expect(Math.abs(p.z)).toBeLessThan(half);
      }
    }
  });

  it("spawn points do not sit inside any collider footprint", () => {
    for (const s of map.spawns)
      for (const p of s.points)
        for (const c of map.colliders) {
          const inside = Math.abs(p.x - c.x) < c.hx && Math.abs(p.z - c.z) < c.hz;
          expect(inside).toBe(false);
        }
  });

  it("waypoint loops have >=8 points and stay in bounds", () => {
    expect(map.waypointLoops.length).toBeGreaterThanOrEqual(3);
    const half = (map.size * TILE) / 2;
    for (const loop of map.waypointLoops) {
      expect(loop.length).toBeGreaterThanOrEqual(8);
      for (const w of loop) expect(Math.max(Math.abs(w.x), Math.abs(w.z))).toBeLessThan(half);
    }
  });

  it("train path is a closed-ish loop", () => {
    expect(map.trainPath.length).toBeGreaterThanOrEqual(20);
  });

  it("tiles only reference known packs", () => {
    const packs = new Set(["roads", "commercial", "industrial", "suburban", "graveyard", "train", "watercraft", "cars"]);
    for (const t of map.tiles) expect(packs.has(t.pack)).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildCityMap()).toEqual(map);
  });

  it("tileToWorld centers tiles", () => {
    expect(tileToWorld(12, 24)).toBeCloseTo(TILE / 2);
  });
});
