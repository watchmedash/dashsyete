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
  },
  server: {
    fs: {
      // allow importing shared/ from outside the client root
      allow: [".."],
    },
  },
});
