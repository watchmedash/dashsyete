import fs from "node:fs";
import path from "node:path";
import { SERVER_PORT } from "../../shared/src/constants";
import { Game } from "./game";
import { serveStatic } from "./static";

Game.start(SERVER_PORT, { bots: true })
  .then((game) => {
    const dist = path.resolve("client/dist");
    if (fs.existsSync(dist)) {
      serveStatic(game.server, dist);
      console.log(`serving client from ${dist}`);
    }
  })
  .catch((err) => {
    console.error("failed to start server:", err);
    process.exit(1);
  });
