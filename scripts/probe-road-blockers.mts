// Any static collider overlapping a ROAD/bridge/plaza cell = invisible wall.
// Scans every drivable cell for colliders that intrude into the tile.
import { buildCityMap, tileToWorld } from "../shared/src/cityMap";

const map = buildCityMap();

// rebuild the drivable cell set the same way the map does (roads/bridges/
// plaza/roundabout are the only tiles cars are meant to drive)
const drivable = new Set<string>();
for (const t of map.tiles) {
  if (t.pack === "roads" && t.model.startsWith("road-")) drivable.add(`${t.gx},${t.gz}`);
}

let hits = 0;
for (const key of drivable) {
  const [gx, gz] = key.split(",").map(Number);
  const cx = tileToWorld(gx);
  const cz = tileToWorld(gz);
  for (const c of map.colliders) {
    if (c.hy < 0.7) continue; // bridge rails / low fences hug the tile edge
    const ox = Math.min(cx + 6, c.x + c.hx) - Math.max(cx - 6, c.x - c.hx);
    const oz = Math.min(cz + 6, c.z + c.hz) - Math.max(cz - 6, c.z - c.hz);
    if (ox > 1 && oz > 1) {
      console.log(
        `tile (${gx},${gz}) @ (${cx},${cz}) blocked by collider (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) ` +
        `half (${c.hx.toFixed(1)}, ${c.hy.toFixed(1)}, ${c.hz.toFixed(1)}) overlap ${ox.toFixed(1)}x${oz.toFixed(1)}`,
      );
      hits++;
    }
  }
}
console.log(hits ? `${hits} blocked road tiles` : "no road tiles blocked");
