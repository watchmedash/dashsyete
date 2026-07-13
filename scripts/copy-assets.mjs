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

// Touch-control sprites (Kenney mobile-controls-1)
const uiOut = join("client", "public", "assets", "ui");
mkdirSync(uiOut, { recursive: true });
const uiSprites = [
  ["Sprites/Style B/Default/joystick_circle_pad_a.png", "joystick_pad.png"],
  ["Sprites/Style B/Default/joystick_circle_nub_a.png", "joystick_nub.png"],
  ["Sprites/Style B/Default/button_circle.png", "button_circle.png"],
  ["Sprites/Icons/Default/icon_pedal.png", "icon_gas.png"],
  ["Sprites/Icons/Default/icon_pedal_brake.png", "icon_brake.png"],
];
for (const [src, dst] of uiSprites) {
  cpSync(join("mobile-controls-1", src), join(uiOut, dst));
}
console.log(`mobile-controls-1 -> ${uiOut}`);
