import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  FLIP_RESPAWN_S, KILL_FLOOR_Y, MAX_HP, SNAPSHOT_EVERY, SPAWN_PROTECTION_S, TICK_DT, TICK_RATE,
} from "../../shared/src/constants";
import {
  decodeClient, encode,
  type CarSnap, type PlayerInfo, type Scores, type ServerMsg,
} from "../../shared/src/protocol";
import { pickTeam } from "../../shared/src/teams";
import type { TeamId } from "../../shared/src/types";
import { Bots } from "./bots";
import { Combat } from "./combat";
import { Roster, type Player } from "./players";
import { Sim } from "../../shared/src/sim";

export class Game {
  readonly sim: Sim;
  readonly roster = new Roster();
  readonly combat = new Combat(this.roster);
  private bots: Bots | null = null;
  private flippedSince = new Map<string, number>();
  readonly server: http.Server;
  private wss: WebSocketServer;
  private sockets = new Map<string, WebSocket>();
  private spawnCursor: [number, number, number, number] = [0, 0, 0, 0];
  private tickCount = 0;
  private interval: NodeJS.Timeout | null = null;

  private constructor(sim: Sim, server: http.Server) {
    this.sim = sim;
    this.server = server;
    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  static async start(port: number): Promise<Game> {
    const sim = await Sim.create();
    const server = http.createServer();
    const game = new Game(sim, server);
    game.bots = new Bots(game, sim.map);
    game.bots.spawnAll();
    await new Promise<void>((resolve) => server.listen(port, resolve));
    game.interval = setInterval(() => game.tick(), 1000 / TICK_RATE);
    console.log(`Dash City server listening on :${port}`);
    return game;
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.wss.close();
    this.server.close();
  }

  now(): number {
    return this.tickCount * TICK_DT;
  }

  scores(): Scores {
    return {
      teams: [...this.roster.teamScores] as Scores["teams"],
      players: this.roster.all().map((p) => ({ id: p.id, score: p.score })),
    };
  }

  playerInfo(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, team: p.team, car: p.car, score: p.score, bot: p.bot };
  }

  nextSpawn(team: TeamId): { x: number; z: number; rotY: number } {
    const points = this.sim.map.spawns[team].points;
    const point = points[this.spawnCursor[team] % points.length];
    this.spawnCursor[team]++;
    return point;
  }

  broadcast(msg: ServerMsg, exceptId?: string): void {
    const data = encode(msg);
    for (const [id, ws] of this.sockets) {
      if (id !== exceptId && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  send(id: string, msg: ServerMsg): void {
    const ws = this.sockets.get(id);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
  }

  /** Add a player (human with socket, or bot without) to roster + sim. */
  addPlayer(opts: { name: string; car: string; team: TeamId; bot: boolean; id?: string }): Player {
    const player: Player = {
      id: opts.id ?? crypto.randomUUID(),
      name: opts.name,
      car: opts.car,
      team: opts.team,
      bot: opts.bot,
      score: 0,
      hp: MAX_HP,
      alive: true,
      respawnAt: 0,
      protectedUntil: 0,
      lastDamagedAt: -Infinity,
      lastAttacker: null,
      lastInputSeq: 0,
    };
    this.roster.add(player);
    const s = this.nextSpawn(player.team);
    this.sim.addCar(player.id, s.x, s.z, s.rotY);
    this.broadcast({ t: "join", player: this.playerInfo(player) }, player.id);
    return player;
  }

  removePlayer(id: string): void {
    if (!this.roster.get(id)) return;
    this.sim.removeCar(id);
    this.roster.remove(id);
    this.sockets.delete(id);
    this.broadcast({ t: "leave", id });
  }

  private onConnection(ws: WebSocket): void {
    let playerId: string | null = null;

    ws.on("message", (data) => {
      const msg = decodeClient(String(data));
      if (!msg) return;

      if (msg.t === "hello" && playerId === null) {
        const team = pickTeam(this.roster.humanCounts());
        const player = this.addPlayer({ name: msg.name, car: msg.car, team, bot: false });
        playerId = player.id;
        this.sockets.set(playerId, ws);
        this.send(playerId, {
          t: "welcome",
          id: player.id,
          team,
          players: this.roster.all().map((p) => this.playerInfo(p)),
          scores: this.scores(),
        });
        return;
      }

      if (msg.t === "input" && playerId !== null) {
        const player = this.roster.get(playerId);
        if (!player || !player.alive) return;
        player.lastInputSeq = msg.input.seq;
        this.sim.setInput(playerId, msg.input);
      }
    });

    ws.on("close", () => {
      if (playerId !== null) this.removePlayer(playerId);
    });
    ws.on("error", () => {
      if (playerId !== null) this.removePlayer(playerId);
    });
  }

  private tick(): void {
    this.bots?.tick(this.now());
    const impacts = this.sim.step();
    this.tickCount++;
    const now = this.now();

    const hits = this.combat.processImpacts(impacts, now);
    const upkeep = this.combat.tick(now);

    for (const d of hits.damaged) this.broadcast({ t: "damage", id: d.id, hp: d.hp });
    for (const k of hits.knockouts) {
      this.sim.removeCar(k.victimId); // wreck disappears; respawn re-adds the car
      this.broadcast({ t: "knockout", victimId: k.victimId, attackerId: k.attackerId, scores: this.scores() });
    }
    for (const id of upkeep.respawns) {
      const p = this.roster.get(id);
      if (!p) continue;
      const s = this.nextSpawn(p.team);
      this.sim.addCar(id, s.x, s.z, s.rotY);
      this.broadcast({ t: "respawn", id });
    }

    // World hazards: fell out of the map, or upside-down too long.
    // Forced respawn with no attribution and no score changes.
    for (const p of this.roster.all()) {
      if (!p.alive || !this.sim.hasCar(p.id)) continue;
      const fell = this.sim.getState(p.id).p[1] < KILL_FLOOR_Y;
      if (this.sim.isFlipped(p.id)) {
        const since = this.flippedSince.get(p.id) ?? now;
        this.flippedSince.set(p.id, since);
        if (!fell && now - since < FLIP_RESPAWN_S) continue;
      } else {
        this.flippedSince.delete(p.id);
        if (!fell) continue;
      }
      this.flippedSince.delete(p.id);
      const s = this.nextSpawn(p.team);
      this.sim.teleport(p.id, s.x, s.z, s.rotY);
      p.hp = MAX_HP;
      p.protectedUntil = now + SPAWN_PROTECTION_S;
      this.broadcast({ t: "respawn", id: p.id });
    }

    if (this.tickCount % SNAPSHOT_EVERY === 0) {
      const cars: CarSnap[] = [];
      for (const p of this.roster.all()) {
        if (!p.alive || !this.sim.hasCar(p.id)) continue;
        const { p: pos, q, v } = this.sim.getState(p.id);
        cars.push({ id: p.id, p: pos, q, v, hp: p.hp });
      }
      const time = this.now();
      for (const [id, ws] of this.sockets) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const lastSeq = this.roster.get(id)?.lastInputSeq ?? 0;
        ws.send(encode({ t: "snapshot", time, lastSeq, cars }));
      }
    }
  }
}

