import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  FLIP_RESPAWN_S, KILL_FLOOR_Y, MAX_HP, MODEL_SCALES, SNAPSHOT_EVERY, SPAWN_PROTECTION_S, TICK_DT, TICK_RATE,
} from "../../shared/src/constants";
import { MODEL_FOOTPRINTS } from "../../shared/src/modelFootprints";
import {
  decodeClient, encode,
  type CarSnap, type PlayerInfo, type Scores, type ServerMsg,
} from "../../shared/src/protocol";
import { pickTeam } from "../../shared/src/teams";
import type { TeamId } from "../../shared/src/types";
import { Accounts } from "./accounts";
import { Combat } from "./combat";
import { Ship } from "./ship";
import { Roster, type Player } from "./players";
import { Sim } from "../../shared/src/sim";

export class Game {
  readonly sim: Sim;
  readonly roster = new Roster();
  readonly combat = new Combat(this.roster);
  private ship: Ship | null = null;
  private accounts = new Accounts("data/players.json");
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
    game.ship = new Ship(sim, sim.map.shipPath);
    sim.map.props.forEach((p, i) => {
      const f = MODEL_FOOTPRINTS[`${p.pack}/${p.model}`];
      const s = MODEL_SCALES[p.pack];
      sim.addProp(`prop-${i}`, { x: f.hx * s, y: f.hy * s, z: f.hz * s }, p.x, p.z, 25);
    });
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
    return { id: p.id, name: p.name, team: p.team, car: p.car, score: p.score };
  }

  nextSpawn(team: TeamId): { x: number; z: number; rotY: number } {
    // Pick the first UNOCCUPIED slot: spawning inside a car parked on the
    // slot interlocks both and neither can move.
    const points = this.sim.map.spawns[team].points;
    const occupied = (p: { x: number; z: number }) =>
      this.roster.all().some((pl) => {
        if (!pl.alive || !this.sim.hasCar(pl.id)) return false;
        const s = this.sim.getState(pl.id);
        return Math.hypot(s.p[0] - p.x, s.p[2] - p.z) < 5;
      });
    for (let i = 0; i < points.length; i++) {
      const point = points[(this.spawnCursor[team] + i) % points.length];
      if (!occupied(point)) {
        this.spawnCursor[team] += i + 1;
        return point;
      }
    }
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

  addPlayer(opts: { name: string; car: string; team: TeamId; id?: string }): Player {
    const player: Player = {
      id: opts.id ?? crypto.randomUUID(),
      name: opts.name,
      car: opts.car,
      team: opts.team,
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
        const rejectWith = (reason: string) => ws.send(encode({ t: "reject", reason }));
        if (msg.pass.length < 4) {
          rejectWith("password must be at least 4 characters");
          return;
        }
        const alreadyOnline = this.roster
          .all()
          .some((p) => p.name.toLowerCase() === msg.name.toLowerCase());
        if (alreadyOnline) {
          rejectWith("player already online");
          return;
        }
        const login = this.accounts.login(msg.name, msg.pass, msg.car, pickTeam(this.roster.teamCounts()));
        if (!login.ok) {
          rejectWith(login.reason);
          return;
        }
        const player = this.addPlayer({
          name: msg.name,
          car: msg.car,
          team: login.account.team,
        });
        player.score = login.account.score;
        playerId = player.id;
        this.sockets.set(playerId, ws);
        this.send(playerId, {
          t: "welcome",
          id: player.id,
          team: player.team,
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
    this.ship?.tick(TICK_DT);
    const impacts = this.sim.step();
    this.tickCount++;
    const now = this.now();

    if (process.env.COMBAT_DEBUG && impacts.length)
      console.log("impacts:", impacts.map((i) => `${i.a}~${i.b}@${i.relSpeed.toFixed(1)}`).join(" "));
    const hits = this.combat.processImpacts(impacts, now);
    const upkeep = this.combat.tick(now);

    for (const d of hits.damaged) this.broadcast({ t: "damage", id: d.id, hp: d.hp });
    for (const k of hits.knockouts) {
      this.sim.removeCar(k.victimId); // wreck disappears; respawn re-adds the car
      this.broadcast({ t: "knockout", victimId: k.victimId, attackerId: k.attackerId, scores: this.scores() });
      const attacker = this.roster.get(k.attackerId);
      if (attacker) this.accounts.setScore(attacker.name, attacker.score);
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
      for (const id of this.sim.propIds()) {
        const { p: pos, q } = this.sim.getPropState(id);
        cars.push({ id, p: pos, q, v: [0, 0, 0], hp: 0 });
      }
      if (this.ship) cars.push(this.ship.snap());
      const time = this.now();
      for (const [id, ws] of this.sockets) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const lastSeq = this.roster.get(id)?.lastInputSeq ?? 0;
        ws.send(encode({ t: "snapshot", time, lastSeq, cars }));
      }
    }
  }
}

