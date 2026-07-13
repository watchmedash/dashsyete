import { describe, it, expect } from "vitest";
import { MODEL_FOOTPRINTS } from "./modelFootprints";

describe("MODEL_FOOTPRINTS", () => {
  it("has a healthy number of entries", () => {
    expect(Object.keys(MODEL_FOOTPRINTS).length).toBeGreaterThan(90);
  });

  it("every entry has positive half extents", () => {
    for (const [key, f] of Object.entries(MODEL_FOOTPRINTS)) {
      expect(f.hx, key).toBeGreaterThan(0);
      expect(f.hy, key).toBeGreaterThan(0);
      expect(f.hz, key).toBeGreaterThan(0);
    }
  });

  it("spot checks match known model sizes", () => {
    expect(MODEL_FOOTPRINTS["roads/road-straight"].hx).toBeCloseTo(0.5);
    expect(MODEL_FOOTPRINTS["graveyard/gravestone-cross"].hx).toBeLessThan(0.3);
    // industrial warehouses are famously off-center — the whole reason this table exists
    expect(Math.abs(MODEL_FOOTPRINTS["industrial/building-h"].cx)).toBeGreaterThan(0.3);
  });
});
