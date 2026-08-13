import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Build identity: the git hash baked into the bundle. The server sends ITS
// hash in `welcome`; a mismatch means the tab is running a stale bundle and
// force-reloads itself (stale tabs kept haunting playtests).
let hash = "dev";
try {
  hash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  // not a git checkout (deploy tarball) — the server falls back too
}

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(hash),
    // SOLO builds (mobile APK) run the authoritative server in a web worker
    __SOLO_BUILD__: JSON.stringify(process.env.SOLO === "1"),
    // lets game.ts skip its execSync git fallback when bundled for the browser
    "process.env.SIX_SIDES_BUILD": JSON.stringify(hash),
  },
  resolve: {
    // browser stand-ins for the node builtins server code imports — only the
    // solo worker bundle (soloWorker.ts → server/src/game.ts) reaches these
    alias: {
      "node:fs": "/src/shims/fs.ts",
      "node:path": "/src/shims/path.ts",
      "node:http": "/src/shims/http.ts",
      "node:crypto": "/src/shims/crypto.ts",
      "node:child_process": "/src/shims/child_process.ts",
      ws: "/src/shims/ws.ts",
    },
  },
  server: {
    fs: {
      // allow importing shared/ from outside the client root
      allow: [".."],
    },
  },
});
