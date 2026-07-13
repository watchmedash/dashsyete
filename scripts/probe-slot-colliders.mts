// Nearest static colliders + ground slabs around a drifting spawn slot.
import { buildCityMap } from "../shared/src/cityMap";

const map = buildCityMap();

for (const [label, x, z] of [
  ["team1 slot2 (drifts)", 226, 3],
  ["team1 slot1 (clean)", 226, -6],
] as [string, number, number][]) {
  console.log(`\n${label} @ (${x},${z}):`);
  const near = map.colliders
    .map((c) => {
      const dx = Math.max(0, Math.abs(c.x - x) - c.hx);
      const dz = Math.max(0, Math.abs(c.z - z) - c.hz);
      return { c, d: Math.hypot(dx, dz) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  for (const { c, d } of near)
    console.log(
      `  d=${d.toFixed(2)}  at (${c.x.toFixed(1)}, y ${c.y.toFixed(2)}, ${c.z.toFixed(1)}) ` +
      `half (${c.hx.toFixed(2)}, ${c.hy.toFixed(2)}, ${c.hz.toFixed(2)}) ` +
      `ytop ${(c.y + c.hy).toFixed(2)} ybot ${(c.y - c.hy).toFixed(2)}`,
    );
  console.log("  slabs overlapping car footprint (±2.5 m):");
  for (const g of map.grounds) {
    if (x + 2.5 > g.x0 && x - 2.5 < g.x1 && z + 2.5 > g.z0 && z - 2.5 < g.z1)
      console.log(`    [${g.x0},${g.z0}] .. [${g.x1},${g.z1}]`);
  }
}
