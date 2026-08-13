import fs from "node:fs";
import path from "node:path";
import { SERVER_PORT } from "../../shared/src/constants";
import { Rooms } from "./rooms";
import { serveStatic } from "./static";

Rooms.start(SERVER_PORT)
  .then((rooms) => {
    const dist = path.resolve("client/dist");
    if (fs.existsSync(dist) && rooms.server) {
      serveStatic(rooms.server, dist);
      console.log(`serving client from ${dist}`);
    }
  })
  .catch((err) => {
    console.error("failed to start server:", err);
    process.exit(1);
  });
