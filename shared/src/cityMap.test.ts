import { describe, it, expect } from "vitest";
import { buildCityMap, tileToWorld, parkedCarCollider } from "./cityMap";
import { TILE } from "./constants";
import { CHAR_RADIUS } from "./character";

const map = buildCityMap();

/** Integer road-cell set reconstructed from the emitted tiles (the 3×3
 * roundabout counts as road for connectivity). */
function roadCells(): Set<string> {
  const cells = new Set<string>();
  for (const t of map.tiles) {
    if (t.pack !== "roads" || !t.model.startsWith("road-")) continue;
    if (!Number.isInteger(t.gx) || !Number.isInteger(t.gz)) continue;
    if (t.model === "road-roundabout") {
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) cells.add(`${t.gx + dx},${t.gz + dz}`);
    } else {
      cells.add(`${t.gx},${t.gz}`);
    }
  }
  return cells;
}

describe("mainland city map", () => {
  it("is deterministic", () => {
    expect(JSON.stringify(buildCityMap())).toEqual(JSON.stringify(buildCityMap()));
  });

  it("has a fully connected road network", () => {
    const cells = roadCells();
    expect(cells.size).toBeGreaterThan(100);
    const start = [...cells][0];
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const [gx, gz] = queue.pop()!.split(",").map(Number);
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const k = `${gx + dx},${gz + dz}`;
        if (cells.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    expect(seen.size).toBe(cells.size);
  });

  it("has ≥16 spawns, all ≥30 m apart, facing somewhere sane", () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(16);
    for (let i = 0; i < map.spawns.length; i++) {
      for (let j = i + 1; j < map.spawns.length; j++) {
        const a = map.spawns[i];
        const b = map.spawns[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it("keeps every spawn point clear of colliders (incl. parked cars)", () => {
    const all = [...map.colliders, ...map.parkedCars.map(parkedCarCollider)];
    for (const s of map.spawns) {
      for (const c of all) {
        const blocks =
          Math.abs(s.x - c.x) < c.hx + CHAR_RADIUS + 0.2 &&
          Math.abs(s.z - c.z) < c.hz + CHAR_RADIUS + 0.2 &&
          c.y - c.hy < 1.9 &&
          c.y + c.hy > 0;
        expect(blocks, `spawn (${s.x},${s.z}) blocked by collider at (${c.x},${c.z})`).toBe(false);
      }
    }
  });

  it("keeps building colliders off the road tiles at walking height", () => {
    const cells = roadCells();
    for (const key of cells) {
      const [gx, gz] = key.split(",").map(Number);
      const x = tileToWorld(gx);
      const z = tileToWorld(gz);
      const margin = 0.5; // fitsTile tolerance
      for (const c of map.colliders) {
        const overlapX = Math.abs(x - c.x) < c.hx + TILE / 2 - margin;
        const overlapZ = Math.abs(z - c.z) < c.hz + TILE / 2 - margin;
        const atWalkHeight = c.y - c.hy < 1.9 && c.y + c.hy > 0.3;
        expect(
          overlapX && overlapZ && atWalkHeight,
          `collider (${c.x.toFixed(1)},${c.z.toFixed(1)}) intrudes on road tile (${gx},${gz})`,
        ).toBe(false);
      }
    }
  });

  it("places every crate spawn on walkable open ground", () => {
    expect(map.crateSpawns.length).toBeGreaterThanOrEqual(10);
    const all = [...map.colliders, ...map.parkedCars.map(parkedCarCollider)];
    for (const cs of map.crateSpawns) {
      const onGround = map.grounds.some(
        (g) => cs.x > g.x0 && cs.x < g.x1 && cs.z > g.z0 && cs.z < g.z1,
      );
      expect(onGround, `crate (${cs.x},${cs.z}) not on any ground slab`).toBe(true);
      for (const c of all) {
        const blocked =
          Math.abs(cs.x - c.x) < c.hx + 0.5 && Math.abs(cs.z - c.z) < c.hz + 0.5 && c.y - c.hy < 1.9 && c.y + c.hy > 0;
        expect(blocked, `crate (${cs.x},${cs.z}) inside collider at (${c.x},${c.z})`).toBe(false);
      }
    }
  });

  it("every placed model has a measured footprint (throws otherwise) and parked cars sit on ground", () => {
    for (const pc of map.parkedCars) {
      const c = parkedCarCollider(pc);
      const onGround = map.grounds.some((g) => c.x > g.x0 && c.x < g.x1 && c.z > g.z0 && c.z < g.z1);
      expect(onGround, `parked ${pc.model} at (${pc.x},${pc.z}) off the mainland`).toBe(true);
    }
  });
});
