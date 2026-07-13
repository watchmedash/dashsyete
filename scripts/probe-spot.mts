// Everything solid near a world point.
import { buildCityMap } from "../shared/src/cityMap";

const [x, z] = [Number(process.argv[2] ?? 3), Number(process.argv[3] ?? -182)];
const map = buildCityMap();
for (const c of map.colliders) {
  const dx = Math.max(0, Math.abs(c.x - x) - c.hx);
  const dz = Math.max(0, Math.abs(c.z - z) - c.hz);
  const d = Math.hypot(dx, dz);
  if (d < 6)
    console.log(
      `collider d=${d.toFixed(1)} at (${c.x.toFixed(1)}, y${c.y.toFixed(2)}, ${c.z.toFixed(1)}) half (${c.hx.toFixed(2)}, ${c.hy.toFixed(2)}, ${c.hz.toFixed(2)})`,
    );
}
for (const t of map.tiles) {
  const tx = (t.gx - map.size / 2 + 0.5) * 12;
  const tz = (t.gz - map.size / 2 + 0.5) * 12;
  if (Math.hypot(tx - x, tz - z) < 14) console.log(`tile (${t.gx},${t.gz}) @ (${tx},${tz}): ${t.pack}/${t.model} rot ${t.rot}`);
}
for (const p of map.props) {
  if (Math.hypot(p.x - x, p.z - z) < 10) console.log(`prop ${p.pack}/${p.model} @ (${p.x}, ${p.z})`);
}
