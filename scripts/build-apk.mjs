import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SIX SIDES Android debug APK — SINGLE PLAYER ONLY.
 * 1. vite build with SOLO=1 (the authoritative server runs in a web worker)
 * 2. prune city-era asset packs the planet game never loads (~175 MB)
 * 3. capacitor sync into android/, gradle assembleDebug
 * 4. copy the apk into release/
 * NOTE: leaves client/dist as the SOLO build — run `npm run build` after if
 * you're going to serve the web version from this checkout.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", cwd: root, ...opts });

console.log("[apk] building SOLO web client…");
run("npm run build", { env: { ...process.env, SOLO: "1" } });

console.log("[apk] pruning unused asset packs…");
const keep = new Set(["characters", "blasters", "watercraft", "survival", "ui"]);
const assetsDir = path.join(root, "client", "dist", "assets");
for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
  if (entry.isDirectory() && !keep.has(entry.name)) {
    fs.rmSync(path.join(assetsDir, entry.name), { recursive: true, force: true });
    console.log(`  dropped ${entry.name}`);
  }
}

console.log("[apk] capacitor sync…");
run("npx cap sync android");

console.log("[apk] gradle assembleDebug…");
const sdk = path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
fs.writeFileSync(path.join(root, "android", "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "\\\\")}\n`);
run(".\\gradlew.bat assembleDebug", {
  cwd: path.join(root, "android"),
  env: {
    ...process.env,
    ANDROID_HOME: sdk,
    JAVA_HOME: "C:\\Program Files\\Android\\Android Studio\\jbr",
  },
});

const apk = path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const out = path.join(root, "release", "SIX-SIDES-debug.apk");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(apk, out);
console.log(`[apk] done: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
