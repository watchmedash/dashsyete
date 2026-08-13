import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Game, MAX_HUMANS } from "./game";
import { Accounts } from "./accounts";

/**
 * Room manager: one server process hosts many independent 12-slot "cubes".
 *
 * Routing rules (user spec):
 * - New players ALWAYS join an existing cube that has players in it, until
 *   that cube is full of humans — only then do they land in a fresh cube.
 * - When a player leaves, a bot backfills their slot (each Game does this).
 * - A cube whose last human leaves DISSOLVES (bots and world evaporate);
 *   a fresh warm cube is kept ready so the next join is always instant.
 *
 * All cubes share ONE Accounts store — the menu leaderboard is global and
 * counts pure knockouts.
 */
export class Rooms {
  private rooms = new Set<Game>();
  private accounts = new Accounts("data/players.json");
  private creating = false;
  private slots?: number;
  server?: http.Server;

  /** opts.host: bind address — the desktop app passes 127.0.0.1 so Windows
   * never raises a firewall prompt for a purely local single-player server.
   * opts.slots: combatants per cube (desktop solo runs 50 = you + 49 bots). */
  static async start(port: number, opts: { host?: string; slots?: number } = {}): Promise<Rooms> {
    const mgr = new Rooms();
    mgr.slots = opts.slots;
    const server = http.createServer();
    mgr.server = server;
    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => void mgr.route(ws));
    server.on("request", (req, res) => {
      if ((req.url ?? "").split("?")[0] !== "/api/leaderboard") return;
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(mgr.accounts.top(20)));
    });
    await mgr.createRoom(); // warm cube: the first join is instant
    await new Promise<void>((resolve) => server.listen(port, opts.host, resolve));
    console.log(`Six Sides room server listening on ${opts.host ?? "*"}:${port}`);
    return mgr;
  }

  /** Route a fresh socket to its cube. The client sends `hello` the moment
   * the socket opens — often before async room selection finishes — so
   * early frames are buffered and replayed once handlers are attached. */
  private async route(ws: WebSocket): Promise<void> {
    const early: unknown[] = [];
    const buffer = (d: unknown) => early.push(d);
    ws.on("message", buffer);
    try {
      const room = await this.pick();
      ws.off("message", buffer);
      room.onConnection(ws);
      for (const d of early) ws.emit("message", d);
    } catch (err) {
      console.error("room routing failed:", err);
      ws.close();
    }
    void this.ensureWarm();
  }

  /** Cube for the next joiner: populated-with-space > warm-empty > new. */
  private async pick(): Promise<Game> {
    for (const r of this.rooms) {
      if (r.humanCount() > 0 && r.humanCount() < MAX_HUMANS) return r;
    }
    for (const r of this.rooms) {
      if (r.humanCount() === 0) return r;
    }
    return this.createRoom();
  }

  private async createRoom(): Promise<Game> {
    const room = await Game.create({ bots: true, accounts: this.accounts, slots: this.slots });
    this.rooms.add(room);
    room.onEmpty = () => {
      this.rooms.delete(room);
      room.stop();
      console.log(`cube dissolved (${this.rooms.size} remaining)`);
      void this.ensureWarm();
    };
    console.log(`cube created (${this.rooms.size} total)`);
    return room;
  }

  /** Keep exactly one empty cube warm so joins never wait on world gen. */
  private async ensureWarm(): Promise<void> {
    if (this.creating) return;
    if ([...this.rooms].some((r) => r.humanCount() === 0)) return;
    this.creating = true;
    try {
      await this.createRoom();
    } finally {
      this.creating = false;
    }
  }
}
