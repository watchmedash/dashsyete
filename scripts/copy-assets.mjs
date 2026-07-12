import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const packs = {
  "kenney_car-kit": "cars",
  "kenney_city-kit-commercial_2.1": "commercial",
  "kenney_city-kit-industrial_1.0": "industrial",
  "kenney_city-kit-roads": "roads",
  "kenney_city-kit-suburban_20": "suburban",
  "kenney_graveyard-kit_5.0": "graveyard",
  "kenney_train-kit": "train",
  "kenney_watercraft-pack": "watercraft",
};
for (const [src, dst] of Object.entries(packs)) {
  const out = join("client", "public", "assets", dst);
  mkdirSync(out, { recursive: true });
  cpSync(join(src, "Models", "GLB format"), out, { recursive: true });
  console.log(`${src} -> ${out}`);
}
