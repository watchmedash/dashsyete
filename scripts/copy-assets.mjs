import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const packs = {
  "kenney_watercraft-pack": "watercraft",
  "kenney_blocky-characters_20": "characters",
  "kenney_blaster-kit_2.1": "blasters",
};

// Downtown MegaKit: gltf+bin+textures flattened into one dir so the bare
// relative URIs inside the .gltf files (T_*.png, *.bin) resolve.
const downtownOut = join("client", "public", "assets", "downtown");
mkdirSync(downtownOut, { recursive: true });
cpSync(join("downtown_megakit", "gltf"), downtownOut, { recursive: true });
cpSync(join("downtown_megakit", "Textures"), downtownOut, { recursive: true });
console.log(`downtown_megakit -> ${downtownOut}`);

// Survival pack ships FBX (no GLB) — copied as-is, loaded via FBXLoader.
const survivalOut = join("client", "public", "assets", "survival");
mkdirSync(survivalOut, { recursive: true });
cpSync(join("survival_pack", "FBX"), survivalOut, { recursive: true });
console.log(`survival_pack -> ${survivalOut}`);
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
