import { defineConfig } from "vite";
import { resolve } from "node:path";

// Standalone map-builder dev server (npm run editor → Electron shell).
// Separate from the game's vite server on :5173 so game-code changes never
// hot-reload or version-bounce the editor mid-build. The editor entry chain
// (standalone.ts → editor.ts) never references __BUILD_VERSION__, so no
// define is needed here.
export default defineConfig({
  root: "client",
  server: {
    port: 5199,
    strictPort: true,
    fs: {
      // allow importing shared/ from outside the client root
      allow: [".."],
    },
  },
  build: {
    rollupOptions: {
      input: resolve(__dirname, "client/editor.html"),
    },
  },
});
