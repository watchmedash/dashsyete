import { describe, it, expect } from "vitest";
import { buildCityMap } from "../../shared/src/cityMap";
import { NavGrid, type Cell } from "./nav";

const map = buildCityMap();
const nav = new NavGrid(map);

describe("NavGrid", () => {
  it("finds a road path from every spawn plaza to the roundabout ring", () => {
    for (const { points } of map.spawns) {
      const start = nav.nearest(points[0].x, points[0].z);
      const path = nav.path(start, [24, 23]); // roundabout ring cell
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(10); // crosses a bridge, not a beeline
    }
  });

  it("paths only step between 4-adjacent drivable cells", () => {
    const path = nav.path(nav.nearest(-6, -226), [29, 29])!;
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1];
      const [bx, bz] = path[i];
      expect(Math.abs(ax - bx) + Math.abs(az - bz)).toBe(1);
      expect(nav.has(bx, bz)).toBe(true);
    }
  });

  it("never routes through the roundabout center monument", () => {
    expect(nav.has(24, 24)).toBe(false);
    const path = nav.path([24, 22], [24, 26])!; // straight across the roundabout
    expect(path.some(([x, z]) => x === 24 && z === 24)).toBe(false);
  });

  it("random destinations are always drivable and mostly downtown", () => {
    let downtown = 0;
    for (let i = 0; i < 200; i++) {
      const c = nav.randomDestination();
      expect(nav.has(c[0], c[1])).toBe(true);
      if (c[0] >= 16 && c[0] < 32 && c[1] >= 16 && c[1] < 32) downtown++;
    }
    expect(downtown).toBeGreaterThan(100);
  });

  it("nearest snaps an off-road position to a drivable cell", () => {
    const c: Cell = nav.nearest(0, 0); // roundabout center area
    expect(nav.has(c[0], c[1])).toBe(true);
  });
});
