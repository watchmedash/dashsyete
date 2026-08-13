import { build } from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Stages everything the Electron app ships: the server bundled to one CJS
// file (Rapier's WASM is embedded in rapier3d-compat, so no native deps)
// and the built web client copied to desktop/web.
const here = path.dirname(fileURLToPath(import.meta.url));

// bake the SAME hash vite bakes into the client — the stale-tab handshake
// (welcome.v vs __BUILD_VERSION__) must agree or every launch force-reloads
const hash = execSync("git rev-parse --short HEAD").toString().trim();

await build({
  entryPoints: [path.join(here, "server-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(here, "server.cjs"),
  external: ["electron"],
  define: { "process.env.SIX_SIDES_BUILD": JSON.stringify(hash) },
  logLevel: "info",
});

const dist = path.join(here, "..", "client", "dist");
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("client/dist missing - run `npm run build` first");
  process.exit(1);
}
const web = path.join(here, "web");
fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(dist, web, { recursive: true });
console.log("staged desktop/server.cjs + desktop/web");
