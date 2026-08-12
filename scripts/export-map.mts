// Exports the CURRENT procedural downtown as an editor-loadable custom map:
// open the map builder (npm run editor) -> Load -> pick downtown-map-export.json,
// modify, then Save to Game.
// Usage: npx tsx scripts/export-map.mts [outfile]
import fs from "node:fs";
import { buildCityMap, tileToWorld } from "../shared/src/cityMap";

const out = process.argv[2] ?? "downtown-map-export.json";
const map = buildCityMap();

const pieces = map.tiles
  .filter((t) => t.pack === "downtown")
  .map((t) => ({
    model: t.model,
    x: +tileToWorld(t.gx).toFixed(2),
    y: t.y ?? 0,
    z: +tileToWorld(t.gz).toFixed(2),
    rot: t.rot,
  }));
for (const p of map.props) {
  if (p.pack !== "downtown") continue;
  pieces.push({ model: p.model, x: +p.x.toFixed(2), y: 0, z: +p.z.toFixed(2), rot: 0 });
}

fs.writeFileSync(out, JSON.stringify({ version: 1, size: { w: 5, d: 5 }, pieces }, null, 1));
console.log(`exported ${pieces.length} pieces -> ${out}`);
