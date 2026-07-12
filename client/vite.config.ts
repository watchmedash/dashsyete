import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      // allow importing shared/ from outside the client root
      allow: [".."],
    },
  },
});
