import { Rooms } from "../server/src/rooms";
import { serveStatic } from "../server/src/static";

/**
 * Desktop (offline) server entry: one local room server with bot backfill —
 * exactly the online game, just listening on loopback inside the Electron
 * app. The packaged web client is served from SIX_SIDES_DIST.
 *
 * cwd is set by the Electron main process to a writable per-user directory
 * before this module loads, so the keyless score store (data/players.json)
 * persists across sessions without touching the install directory.
 */
const port = Number(process.env.SIX_SIDES_PORT ?? 8794);

// loopback-only (no Windows firewall prompt) + a 50-slot cube: you + 49 bots
Rooms.start(port, { host: "127.0.0.1", slots: 50 })
  .then((rooms) => {
    const dist = process.env.SIX_SIDES_DIST;
    if (dist && rooms.server) serveStatic(rooms.server, dist);
    console.log(`offline server ready on 127.0.0.1:${port}`);
  })
  .catch((err) => {
    console.error("offline server failed to start:", err);
    process.exit(1);
  });
