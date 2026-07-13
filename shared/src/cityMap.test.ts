import { describe, it, expect } from "vitest";
import { buildCityMap, tileToWorld } from "./cityMap";
import { TILE } from "./constants";

const map = buildCityMap();

const onGround = (p: { x: number; z: number }) =>
  map.grounds.some((g) => p.x >= g.x0 && p.x <= g.x1 && p.z >= g.z0 && p.z <= g.z1);

describe("buildCityMap v2 (islands)", () => {
  it("has 4 teams x >=6 spawn slots, each on solid ground", () => {
    expect(map.spawns.map((s) => s.team)).toEqual([0, 1, 2, 3]);
    for (const s of map.spawns) {
      expect(s.points.length).toBeGreaterThanOrEqual(6);
      for (const p of s.points) expect(onGround(p), `spawn t${s.team} (${p.x},${p.z})`).toBe(true);
    }
  });

  it("spawn points do not sit inside any collider footprint", () => {
    for (const s of map.spawns)
      for (const p of s.points)
        for (const c of map.colliders) {
          const inside = Math.abs(p.x - c.x) < c.hx && Math.abs(p.z - c.z) < c.hz && c.hy > 0.7;
          expect(inside, `spawn (${p.x},${p.z}) in collider (${c.x},${c.z})`).toBe(false);
        }
  });

  it("has one waypoint route per team, all points on ground", () => {
    expect(map.waypointRoutes).toHaveLength(4);
    for (const route of map.waypointRoutes) {
      expect(route.length).toBeGreaterThanOrEqual(12);
      for (const w of route) expect(onGround(w), `waypoint (${w.x},${w.z})`).toBe(true);
    }
  });

  it("has at least 9 landmasses (center + 4 islands + 4 islets)", () => {
    const big = map.grounds.filter((g) => (g.x1 - g.x0) * (g.z1 - g.z0) > 40 * 40);
    expect(big.length).toBeGreaterThanOrEqual(9);
  });

  it("islands are separated by water (spawn plazas not on one shared slab)", () => {
    for (const a of map.spawns)
      for (const b of map.spawns) {
        if (a.team >= b.team) continue;
        const shared = map.grounds.some(
          (g) =>
            a.points.every((p) => p.x >= g.x0 && p.x <= g.x1 && p.z >= g.z0 && p.z <= g.z1) &&
            b.points.every((p) => p.x >= g.x0 && p.x <= g.x1 && p.z >= g.z0 && p.z <= g.z1),
        );
        expect(shared, `teams ${a.team}/${b.team} share a slab`).toBe(false);
      }
  });

  it("ship path stays in open water", () => {
    expect(map.shipPath.length).toBeGreaterThanOrEqual(4);
    for (const p of map.shipPath) expect(onGround(p), `ship point (${p.x},${p.z})`).toBe(false);
  });

  it("props all sit on ground", () => {
    expect(map.props.length).toBeGreaterThanOrEqual(20);
    for (const p of map.props) expect(onGround(p), `prop (${p.x},${p.z})`).toBe(true);
  });

  it("tiles only reference known packs", () => {
    const packs = new Set(["roads", "commercial", "industrial", "suburban", "graveyard", "train", "watercraft", "cars"]);
    for (const t of map.tiles) expect(packs.has(t.pack), t.pack).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildCityMap()).toEqual(map);
  });

  it("tileToWorld centers tiles on the 48-grid", () => {
    expect(map.size).toBe(48);
    expect(tileToWorld(24, 48)).toBeCloseTo(TILE / 2);
  });
});
