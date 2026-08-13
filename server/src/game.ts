import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import {
  CRATE_RESPAWN_S, GRENADES_PER_PICKUP, KILL_FLOOR_Y, MAX_HP, MODEL_SCALES, PICKUP_RADIUS,
  PLAYABLE_SKINS, RESPAWN_DELAY_S, SNAPSHOT_EVERY, SPAWN_PROTECTION_S, TICK_DT, TICK_RATE,
} from "../../shared/src/constants";
import { MODEL_FOOTPRINTS } from "../../shared/src/modelFootprints";
import {
  B_BEDROCK, B_BUILD, B_CACTUS, B_LAVA, B_WATER, BIOMES, BUILD_REACH, FACES, PLANET_R,
  SKY_KILL_Y, START_BLOCKS, faceIndexOfUp, onPlanet,
} from "../../shared/src/skyMap";
import { basis, dirFromYawPitch, faceUp, yawFromDir, type V3 } from "../../shared/src/gravity";
import {
  decodeClient, encode,
  type CharSnap, type DartSnap, type InputState, type PlayerInfo, type Scores, type ServerMsg,
} from "../../shared/src/protocol";
import { tileToWorld } from "../../shared/src/cityMap";
import { CHAR_CENTER_Y, EYE_HEIGHT, FALL_DMG_PER_MS, FALL_SAFE_SPEED } from "../../shared/src/character";
import {
  DART_LIFE_TICKS, DEFAULT_WEAPON, GRENADE, HEALTH_PACK_HP, ITEM_AMMO, ITEM_HEALTH, WEAPONS,
} from "../../shared/src/weapons";
import { stepDarts, stepNades, type Dart, type Nade } from "../../shared/src/projectiles";
import { Accounts } from "./accounts";
import { Combat, type CombatResult } from "./combat";
import { Ship } from "./ship";
import { Roster, type Player } from "./players";
import { Sim } from "../../shared/src/sim";

// Build identity for the stale-tab handshake (see protocol `welcome.v`).
const BUILD_VERSION = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

/** The match always holds this many combatants: bots fill every slot no
 * human is using (20 humans → 30 bots; solo → 49 bots). */
// A "cube" (room) holds 12 combatants — roughly 2 per face. Humans replace
// bots up to the full 12; the room manager spins up a new cube when every
// existing one is full of humans.
const TOTAL_SLOTS = 12;
export const MAX_HUMANS = 12;

const BOT_NAMES = [
  "Dart Vader", "Foamy", "Trigger", "Blocky", "Ricochet", "Piper", "Sprocket", "Nimbus",
  "Crater", "Wick", "Bolt", "Mossy", "Drift", "Ember", "Frost", "Dune", "Basalt", "Fern",
  "Pebble", "Gale", "Comet", "Slate", "Titan", "Wisp", "Racket", "Jinx", "Static", "Nova-2",
  "Puddle", "Sprig", "Flint", "Halo", "Rumble", "Skitter", "Vertex", "Quill", "Bramble",
  "Cinder", "Glacier", "Mirage", "Canopy", "Regolith", "Squall", "Tectonic", "Umbra",
  "Voxel", "Warden", "Zephyr", "Cobalt", "Magma",
];

interface BotBrain {
  waypoint: [number, number, number] | null;
  rethinkAt: number;
  lastPos: [number, number, number];
  input: InputState;
  strafePhase: number;
  /** Mid-reload until this game-time (empty mag = 2.2 s pause, like a human). */
  reloadingUntil: number;
  /** Personality: 0.7 timid .. 1.3 reckless — scales trigger rate and flee threshold. */
  aggro: number;
  /** Earliest game-time the next grenade may go out (no mag-dumping all 3). */
  nadeAt: number;
  /** >now: actively fleeing; -1: already fled once this life (fights to the death). */
  fleeUntil: number;
}

/** Which cube face a block cell belongs to (dominant axis of its center). */
function faceOfCell(x: number, y: number, z: number): number {
  const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
  const ax = Math.abs(cx), ay = Math.abs(cy), az = Math.abs(cz);
  if (ay >= ax && ay >= az) return cy >= 0 ? 0 : 1;
  if (ax >= az) return cx >= 0 ? 2 : 3;
  return cz >= 0 ? 4 : 5;
}

interface CrateState {
  x: number;
  z: number;
  y: number;
  weapon: string;
  availableAtTick: number;
}

export class Game {
  readonly sim: Sim;
  readonly roster = new Roster();
  readonly combat = new Combat(this.roster);
  private ship: Ship | null = null;
  private accounts = new Accounts("data/players.json");
  server?: http.Server;
  private wss?: WebSocketServer;
  private sockets = new Map<string, WebSocket>();
  private spawnCursor = 0;
  /** Road tile centers — hazard respawns go to the nearest one. */
  private roadPoints: { x: number; z: number }[] = [];
  /** Per-player input queue: applied ONE PER TICK in arrival order so the
   * client's rewind+replay reconciliation sees the same input timeline.
   * lastInputSeq is set when an input is APPLIED, not when it arrives. */
  private inputQueues = new Map<string, InputState[]>();
  /** Players whose input queue ran dry: hold until 2 inputs rebuffer, so one
   * network hiccup doesn't become a shear per snapshot (rhythmic bumps). */
  private starving = new Set<string>();
  private lastUnstuck = new Map<string, number>();
  /** Tick of each player's last accepted block break (mining rate limit). */
  private lastBreak = new Map<string, number>();
  private darts: Dart[] = [];
  private nades: Nade[] = [];
  private nextProjectileId = 1;
  private crates: CrateState[] = [];
  /** Guns dropped by pickup swaps: one-shot floor pickups, despawn after a while. */
  private drops: { id: string; x: number; y: number; z: number; weapon: string; expiresAtTick: number; lockId: string }[] = [];
  private nextDropId = 1;
  /** Per-face block economy: breaks add debt, places pay it back. A face
   * deep in debt (blocks carried elsewhere) slowly REGENERATES material. */
  private faceDebt = [0, 0, 0, 0, 0, 0];
  /** Bot AI state, keyed by bot player id. */
  private botBrains = new Map<string, BotBrain>();
  private nextBotN = 0;
  private botsEnabled = false;
  private tickCount = 0;
  private interval: NodeJS.Timeout | null = null;

  private constructor(sim: Sim) {
    this.sim = sim;
  }

  /** Fires when the LAST human disconnects (room manager may dissolve us). */
  onEmpty: (() => void) | null = null;

  humanCount(): number {
    return this.sockets.size;
  }

  /** Build a running match (a "cube") with its own world + tick pump — no
   * network attached. The room manager routes sockets in via onConnection. */
  static async create(opts: { bots?: boolean; accounts?: Accounts } = {}): Promise<Game> {
    const sim = await Sim.create();
    const game = new Game(sim);
    game.botsEnabled = !!opts.bots;
    if (opts.accounts) game.accounts = opts.accounts;
    game.roadPoints = sim.map.tiles
      .filter((t) => t.pack === "downtown" && t.model.startsWith("Street_2Lane"))
      .map((t) => ({ x: tileToWorld(t.gx), z: tileToWorld(t.gz) }));
    // No decor cargo ship in the voxel sky/planet world — nothing to sail on.
    if (!sim.vox) game.ship = new Ship(sim, sim.map.shipPath);
    game.crates = sim.map.crateSpawns.map((c) => ({ ...c, y: c.y ?? 0, availableAtTick: 0 }));
    sim.map.props.forEach((p, i) => {
      const f = MODEL_FOOTPRINTS[`${p.pack}/${p.model}`];
      const s = MODEL_SCALES[p.pack];
      sim.addProp(`prop-${i}`, { x: f.hx * s, y: f.hy * s, z: f.hz * s }, p.x, p.z, 25);
    });
    // Drift-compensated tick pump: a bare setInterval(16.67) fires LATE on a
    // loaded host (Windows timers especially) and never catches up, so game
    // time dilates — the whole match runs in subtle slow motion. Accumulate
    // real elapsed time and step as many fixed ticks as it covers (capped so
    // a debugger pause or laptop sleep doesn't fast-forward the world).
    let last = performance.now();
    let acc = 0;
    game.interval = setInterval(() => {
      const nowMs = performance.now();
      acc += nowMs - last;
      last = nowMs;
      if (acc > 250) acc = 250;
      while (acc >= 1000 / TICK_RATE) {
        acc -= 1000 / TICK_RATE;
        game.tick();
      }
    }, 4);
    return game;
  }

  /** Single-room server (tests + simple deploys): own http listener + wss. */
  static async start(port: number, opts: { bots?: boolean } = {}): Promise<Game> {
    const game = await Game.create(opts);
    const server = http.createServer();
    game.server = server;
    game.wss = new WebSocketServer({ server });
    game.wss.on("connection", (ws) => game.onConnection(ws));
    // Home-menu leaderboard API (CORS open: the dev client runs on :5173).
    server.on("request", (req, res) => {
      if ((req.url ?? "").split("?")[0] !== "/api/leaderboard") return;
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(game.accounts.top(20)));
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));
    console.log(`Six Sides server listening on :${port}`);
    return game;
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    for (const ws of this.sockets.values()) ws.close();
    this.wss?.close();
    this.server?.close();
  }

  now(): number {
    return this.tickCount * TICK_DT;
  }

  scores(): Scores {
    return { players: this.roster.all().map((p) => ({ id: p.id, score: p.score, deaths: p.deaths })) };
  }

  playerInfo(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, skin: p.skin, score: p.score, bot: p.bot || undefined };
  }

  private occupied(p: { x: number; z: number; y?: number }, exceptId?: string): boolean {
    return this.roster.all().some((pl) => {
      if (pl.id === exceptId || !pl.alive || !this.sim.hasChar(pl.id)) return false;
      const s = this.sim.getState(pl.id);
      // include y when the point carries one (side faces of the planet
      // separate spawns vertically in world space)
      return Math.hypot(s.p[0] - p.x, p.y !== undefined ? s.p[1] - p.y : 0, s.p[2] - p.z) < 3;
    });
  }

  /** Nearest CLEAR road tile to a position (sea hazard + unstuck). */
  nearestRoadRespawn(x: number, z: number, exceptId: string): { x: number; z: number; rotY: number; y?: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (const p of this.roadPoints) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestDist && !this.occupied(p, exceptId)) {
        bestDist = d;
        best = p;
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, rotY: Math.atan2(-best.x, -best.z) };
  }

  /** FFA spawn. On the planet: a RANDOM face every spawn (user request —
   * never the same green field twice in a row), then the clear point on that
   * face farthest from living enemies. Flat maps: farthest-from-enemies. */
  nextSpawn(exceptId?: string): { x: number; z: number; rotY: number; y?: number } {
    const points = this.sim.map.spawns;
    const enemies = this.roster
      .all()
      .filter((p) => p.alive && p.id !== exceptId && this.sim.hasChar(p.id))
      .map((p) => this.sim.getState(p.id).p);
    const enemyDist = (pt: { x: number; z: number; y?: number }) =>
      enemies.length
        ? Math.min(...enemies.map((e) => Math.hypot(e[0] - pt.x, e[1] - (pt.y ?? e[1]), e[2] - pt.z)))
        : 1;
    if (this.sim.planet) {
      const faceOf = (pt: { x: number; z: number; y?: number }) =>
        faceUp([pt.x, pt.y ?? 0, pt.z], null, true).join(",");
      const faces = [...new Set(points.map(faceOf))];
      // shuffled face order: try a random face, fall through if it's full
      for (let i = faces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [faces[i], faces[j]] = [faces[j], faces[i]];
      }
      for (const f of faces) {
        const cands = points.filter((pt) => faceOf(pt) === f && !this.occupied(pt, exceptId));
        if (!cands.length) continue;
        let best = cands[0];
        let bestScore = -Infinity;
        for (const c of cands) {
          const d = enemyDist(c);
          if (d > bestScore) {
            bestScore = d;
            best = c;
          }
        }
        return best;
      }
    }
    let best = points[this.spawnCursor++ % points.length];
    let bestScore = -Infinity;
    for (const point of points) {
      if (this.occupied(point, exceptId)) continue;
      const score = enemyDist(point);
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best;
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

  addPlayer(opts: { name: string; skin: string; id?: string }): Player {
    const player: Player = {
      id: opts.id ?? crypto.randomUUID(),
      name: opts.name,
      skin: opts.skin,
      score: 0,
      deaths: 0,
      blocks: START_BLOCKS,
      hp: MAX_HP,
      alive: true,
      respawnAt: 0,
      protectedUntil: 0,
      lastDamagedAt: -Infinity,
      lastAttacker: null,
      lastInputSeq: 0,
      slots: [DEFAULT_WEAPON, null],
      activeSlot: 0,
      lastSel: 1,
      ammo: [WEAPONS[DEFAULT_WEAPON].ammoCap, 0],
      cooldownUntilTick: 0,
      grenades: 0,
      prevFire: false,
      prevNade: false,
      prevSwap: false,
    };
    this.roster.add(player);
    // Every spawn — joins included — lands on a RANDOM face (see nextSpawn).
    const s = this.nextSpawn(player.id);
    this.sim.addChar(player.id, s.x, s.z, s.rotY, s.y ?? 0);
    this.broadcast({ t: "join", player: this.playerInfo(player) }, player.id);
    return player;
  }

  removePlayer(id: string): void {
    if (!this.roster.get(id)) return;
    const wasHuman = this.sockets.has(id);
    this.sim.removeChar(id);
    this.roster.remove(id);
    this.sockets.delete(id);
    if (wasHuman && this.sockets.size === 0) this.onEmpty?.();
    this.botBrains.delete(id);
    this.inputQueues.delete(id);
    this.starving.delete(id);
    this.lastUnstuck.delete(id);
    this.lastBreak.delete(id);
    this.darts = this.darts.filter((d) => d.owner !== id);
    this.broadcast({ t: "leave", id });
  }

  onConnection(ws: WebSocket): void {
    let playerId: string | null = null;

    ws.on("message", (data) => {
      const msg = decodeClient(String(data));
      if (!msg) return;

      if (msg.t === "hello" && playerId === null) {
        const rejectWith = (reason: string) => ws.send(encode({ t: "reject", reason }));
        if (this.sockets.size >= MAX_HUMANS) {
          rejectWith(`server full — ${MAX_HUMANS} player cap`);
          return;
        }
        // No name keys (user decision): an online name collision just
        // auto-suffixes a number — "Zed" joins as "Zed2".
        const taken = (n: string) =>
          this.roster.all().some((p) => p.name.toLowerCase() === n.toLowerCase());
        let name = msg.name;
        for (let i = 2; taken(name); i++) name = `${msg.name}${i}`.slice(0, 20);
        const player = this.addPlayer({ name, skin: msg.skin });
        player.score = this.accounts.touch(name, msg.skin).score;
        playerId = player.id;
        this.sockets.set(playerId, ws);
        if (this.botsEnabled) this.ensureBots(); // a human takes a bot's slot
        this.send(playerId, {
          t: "welcome",
          id: player.id,
          players: this.roster.all().map((p) => this.playerInfo(p)),
          scores: this.scores(),
          vox: this.sim.vox?.serialize(), // current voxel world incl. edits
          v: BUILD_VERSION,
        });
        return;
      }

      if (msg.t === "input" && playerId !== null) {
        const player = this.roster.get(playerId);
        if (!player || !player.alive) return;
        let queue = this.inputQueues.get(playerId);
        if (!queue) this.inputQueues.set(playerId, (queue = []));
        queue.push(msg.input);
        // only a truly dead backlog drops on arrival — routine bursts from
        // client frame hitches drain gradually in tick() instead
        if (queue.length > 40) queue.shift();
      }

      // Latency echo for the client's ping readout.
      if (msg.t === "ping") {
        ws.send(encode({ t: "pong", c: msg.c }));
        return;
      }

      // Self-service hazard respawn (wedged in decor...): exactly what
      // falling in the sea does, cooldown-limited.
      if (msg.t === "unstuck" && playerId !== null) {
        const player = this.roster.get(playerId);
        if (!player || !player.alive || !this.sim.hasChar(playerId)) return;
        const now = this.now();
        if (now - (this.lastUnstuck.get(playerId) ?? -Infinity) < 5) return;
        this.lastUnstuck.set(playerId, now);
        this.hazardRespawn(player, this.sim.getState(playerId).p, now);
      }

      // Build/destroy intent (v5 voxel mode) — validate, apply, broadcast.
      if (msg.t === "blockEdit" && playerId !== null) this.handleBlockEdit(playerId, msg);
    });

    ws.on("close", () => {
      if (playerId !== null) this.removePlayer(playerId);
    });
    ws.on("error", () => {
      if (playerId !== null) this.removePlayer(playerId);
    });
  }

  // ---- BOTS: the match always holds TOTAL_SLOTS combatants — bots fill
  // every slot no human is using and yield slots as humans join.
  private ensureBots(): void {
    const humans = this.sockets.size;
    const bots = this.roster.all().filter((p) => p.bot);
    const want = Math.max(0, TOTAL_SLOTS - humans);
    for (let i = bots.length; i < want; i++) this.addBot();
    for (let i = bots.length - 1; i >= want; i--) {
      this.botBrains.delete(bots[i].id);
      this.removePlayer(bots[i].id);
    }
  }

  private addBot(): void {
    const n = this.nextBotN++;
    const base = BOT_NAMES[n % BOT_NAMES.length];
    const name = n < BOT_NAMES.length ? base : `${base} ${Math.floor(n / BOT_NAMES.length) + 1}`;
    const player = this.addPlayer({ name, skin: PLAYABLE_SKINS[n % PLAYABLE_SKINS.length] });
    player.bot = true;
    this.sim.setStreamRadius(player.id, 1); // tight collider bubble (50 of them)
    this.sim.setStepEvery(player.id, 3); // 20 Hz controller (= snapshot rate)
    this.botBrains.set(player.id, {
      waypoint: null,
      rethinkAt: 0,
      lastPos: [0, 0, 0],
      input: { seq: 0, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false, swap: false, sel: 1 },
      strafePhase: Math.random() * Math.PI * 2,
      reloadingUntil: 0,
      aggro: 0.7 + Math.random() * 0.6,
      nadeAt: 0,
      fleeUntil: 0,
    });
  }

  /** Drive every bot: wander the face, engage the nearest target, reload. */
  private botTick(now: number): void {
    for (const p of this.roster.all()) {
      if (!p.bot || !p.alive || !this.sim.hasChar(p.id)) continue;
      const brain = this.botBrains.get(p.id);
      if (!brain) continue;
      // empty mag = a real 2.2 s RELOAD pause (no fire), then a fresh mag —
      // bots have the same finite mags as humans, they just carry spares
      if (p.ammo[p.activeSlot] <= 0 && brain.reloadingUntil === 0) brain.reloadingUntil = now + 2.2;
      if (brain.reloadingUntil > 0 && now >= brain.reloadingUntil) {
        p.ammo[p.activeSlot] = WEAPONS[p.slots[p.activeSlot] ?? DEFAULT_WEAPON]?.ammoCap ?? 30;
        brain.reloadingUntil = 0;
      }
      // think at 10 Hz, act every tick
      if (this.tickCount % 6 === 0) this.botThink(p, brain, now);
      if (brain.reloadingUntil > 0) brain.input.fire = false;
      this.sim.setInput(p.id, brain.input);
      this.handleFire(p, brain.input);
    }
  }

  private botThink(p: Player, brain: BotBrain, now: number): void {
    const st = this.sim.getState(p.id);
    const up = this.sim.getUp(p.id);
    const { t1, t2 } = basis(up);
    const input = brain.input;
    input.seq++;
    input.jump = false;
    input.fire = false;
    input.nade = false;
    // stuck? (barely moved since last think while trying to move)
    const moved = Math.hypot(st.p[0] - brain.lastPos[0], st.p[1] - brain.lastPos[1], st.p[2] - brain.lastPos[2]);
    if (moved < 0.25 && Math.abs(input.moveZ) > 0.1 && st.grounded) input.jump = true;
    brain.lastPos = [st.p[0], st.p[1], st.p[2]];

    // nearest living target (human or bot — pure FFA); spawn-protected
    // players are invulnerable, so shooting them just wastes the mag.
    // Fresh bots on the starter blaster keep a SHORT engagement range so
    // they actually go gear up (loot-run below) — with 50 combatants the
    // old flat 55 m meant nobody ever reached the wander branch.
    let best: Player | null = null;
    let bestD = p.slots[0] !== DEFAULT_WEAPON || p.grenades > 0 ? 55 : 34;
    for (const o of this.roster.all()) {
      if (o.id === p.id || !o.alive || !this.sim.hasChar(o.id)) continue;
      if (now < o.protectedUntil) continue;
      const op = this.sim.getState(o.id).p;
      const d = Math.hypot(op[0] - st.p[0], op[1] - st.p[1], op[2] - st.p[2]);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }

    if (best) {
      const bp = this.sim.getState(best.id).p;
      const dir: V3 = [bp[0] - st.p[0], bp[1] - st.p[1], bp[2] - st.p[2]];
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      dir[0] /= len; dir[1] /= len; dir[2] /= len;
      // face-frame aim, DISTANCE-SCALED error: sharp in a knife fight,
      // sloppy at range (±0.3 rad at 50 m barely threatens)
      const err = 0.05 + bestD * 0.0055;
      input.yaw = yawFromDir(dir, up) + (Math.random() - 0.5) * 2 * err;
      const upAmt = dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2];
      input.aimPitch = Math.max(-1.5, Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, upAmt))))) + (Math.random() - 0.5) * 1.4 * err;
      // LINE OF SIGHT: no blasting into the hill between you — push toward
      // the target instead until the lane is clear
      const eye: [number, number, number] = [
        st.p[0] + up[0] * EYE_HEIGHT,
        st.p[1] + up[1] * EYE_HEIGHT,
        st.p[2] + up[2] * EYE_HEIGHT,
      ];
      const wall = this.sim.castRayStatic(eye, dir, bestD);
      const clearLOS = wall === null || wall > bestD - 1.5;

      // SELF-PRESERVATION: badly hurt bots break contact once per life —
      // turn tail, sprint a serpentine away, then (if still alive) turn and
      // fight to the death. Timid bots bail earlier than reckless ones.
      if (p.hp >= MAX_HP - 5) brain.fleeUntil = 0; // fresh life / big heal restores nerve
      if (brain.fleeUntil === 0 && bestD < 32 && p.hp < 45 - brain.aggro * 20) {
        brain.fleeUntil = now + 3.5 + Math.random() * 3.5;
      }
      if (brain.fleeUntil > now) {
        input.yaw = yawFromDir([-dir[0], -dir[1], -dir[2]], up);
        input.aimPitch = 0;
        input.moveZ = 1;
        input.moveX = Math.sin(now * 2.2 + brain.strafePhase) * 0.5; // serpentine
        input.sprint = true;
        brain.waypoint = null;
        return;
      }
      if (brain.fleeUntil > 0) brain.fleeUntil = -1; // flee window spent — no second retreat

      // trigger discipline: eager up close, hesitant past mid range,
      // scaled by personality (timid bots hold fire longer)
      input.fire = clearLOS && bestD < 38 && Math.random() < (bestD < 12 ? 0.7 : 0.32) * brain.aggro;
      // TACTICAL GRENADES: mostly lobbed when the target hides behind cover
      // (arc over what the darts can't cross), rarely in the open; a real
      // cooldown stops any bot from dumping its whole pouch at once
      if (p.grenades > 0 && now >= brain.nadeAt && bestD > 9 && bestD < 26 && Math.random() < (clearLOS ? 0.05 : 0.3)) {
        input.nade = true;
        if (!clearLOS) input.aimPitch = 0.55 + Math.random() * 0.25; // lob it over
        brain.nadeAt = now + 5 + Math.random() * 6;
      }
      input.moveZ = bestD > 14 ? 1 : bestD < 7 ? -0.6 : 0;
      if (!clearLOS) input.moveZ = 1; // push for a clear angle (after range logic so it sticks)
      input.moveX = Math.sin(now * 1.4 + brain.strafePhase) * 0.8; // strafe wobble
      input.sprint = bestD > 22;
      brain.waypoint = null;
    } else {
      // wander: pick a tangent-offset waypoint on the current face
      if (
        !brain.waypoint ||
        now >= brain.rethinkAt ||
        Math.hypot(brain.waypoint[0] - st.p[0], brain.waypoint[1] - st.p[1], brain.waypoint[2] - st.p[2]) < 4
      ) {
        // LOOT RUN: usually drift toward a nearby armed crate instead of a
        // random point — bots actually use the pickup economy (guns, health,
        // grenades) instead of only ever finding crates by accident
        let cw: [number, number, number] | null = null;
        let cd = 50;
        for (const c of this.crates) {
          if (c.availableAtTick > this.tickCount) continue;
          const d = Math.hypot(c.x - st.p[0], (c.y ?? 0) - st.p[1], c.z - st.p[2]);
          if (d > 3 && d < cd) {
            cd = d;
            cw = [c.x, c.y ?? 0, c.z];
          }
        }
        if (cw && Math.random() < 0.65) {
          brain.waypoint = cw;
        } else {
          const a = (Math.random() * 2 - 1) * 45;
          const b = (Math.random() * 2 - 1) * 45;
          const w: [number, number, number] = [
            st.p[0] + t1[0] * a + t2[0] * b,
            st.p[1] + t1[1] * a + t2[1] * b,
            st.p[2] + t1[2] * a + t2[2] * b,
          ];
          // clamp inside the face so wanderers don't stream over edges
          for (let i = 0; i < 3; i++) {
            if (up[i] === 0) w[i] = Math.max(-PLANET_R + 6, Math.min(PLANET_R - 6, w[i]));
          }
          brain.waypoint = w;
        }
        brain.rethinkAt = now + 6 + Math.random() * 6;
      }
      const dir: V3 = [
        brain.waypoint[0] - st.p[0],
        brain.waypoint[1] - st.p[1],
        brain.waypoint[2] - st.p[2],
      ];
      input.yaw = yawFromDir(dir, up);
      input.aimPitch = 0;
      input.moveZ = 1;
      input.moveX = 0;
      input.sprint = Math.random() < 0.35;
    }
  }

  /** Teleport onto the nearest clear road (sea hazard + unstuck button). */
  private hazardRespawn(p: Player, pos: [number, number, number], now: number): void {
    const s = this.nearestRoadRespawn(pos[0], pos[2], p.id) ?? this.nextSpawn(p.id);
    this.sim.teleport(p.id, s.x, s.z, s.rotY, s.y ?? 0);
    p.hp = MAX_HP;
    p.protectedUntil = now + SPAWN_PROTECTION_S;
    this.broadcast({ t: "respawn", id: p.id });
  }

  /** Validate and apply a break/place intent; broadcast the accepted edit. */
  private handleBlockEdit(playerId: string, msg: { x: number; y: number; z: number; b: number }): void {
    const vox = this.sim.vox;
    const player = this.roster.get(playerId);
    if (!vox || !player || !player.alive || !this.sim.hasChar(playerId)) return;
    const s = this.sim.getState(playerId);
    const bup = this.sim.getUp(playerId);
    const eye: [number, number, number] = [
      s.p[0] + bup[0] * EYE_HEIGHT,
      s.p[1] + bup[1] * EYE_HEIGHT,
      s.p[2] + bup[2] * EYE_HEIGHT,
    ];
    const d = Math.hypot(msg.x + 0.5 - eye[0], msg.y + 0.5 - eye[1], msg.z + 0.5 - eye[2]);
    if (d > BUILD_REACH + 1) return; // small slack for latency
    if (msg.b === 0) {
      // break: must exist; bedrock and fluids are unbreakable
      const cur = vox.get(msg.x, msg.y, msg.z);
      if (cur === 0 || cur === B_BEDROCK || cur === B_WATER || cur === B_LAVA) return;
      // mining takes TIME client-side (per-block hardness); this rate limit
      // only stops a hacked client from strip-mining instantly
      if (this.tickCount - (this.lastBreak.get(playerId) ?? -99) < 8) return;
      this.lastBreak.set(playerId, this.tickCount);
      // every mined block converts to building stock, capped at a 99-stack
      player.blocks = Math.min(99, player.blocks + 1);
      this.faceDebt[faceOfCell(msg.x, msg.y, msg.z)]++;
      this.applyBlockEdits([[msg.x, msg.y, msg.z, 0]]);
      // neighboring water pours into the fresh hole
      this.flowWater([[msg.x, msg.y, msg.z]]);
    } else {
      // place: cell empty OR water (blocks displace water — that's how you
      // build back OUT of a lake), stock available, nobody overlapping
      const cur = vox.get(msg.x, msg.y, msg.z);
      if ((cur !== 0 && cur !== B_WATER) || player.blocks <= 0) return;
      // BUILD HEIGHT CAP: the only per-face building limit (user decision)
      const alt = Math.max(Math.abs(msg.x + 0.5), Math.abs(msg.y + 0.5), Math.abs(msg.z + 0.5)) - PLANET_R;
      if (this.sim.planet && alt > 30) return;
      // nobody overlapping — FACE-AWARE: split the offset into up/tangent in
      // the cell's face frame (the old x/z + world-y test was flat-world only:
      // on side faces it rejected legal placements ahead of you and could
      // miss real overlaps)
      const cc: [number, number, number] = [msg.x + 0.5, msg.y + 0.5, msg.z + 0.5];
      const bup2 = faceUp(cc, null, this.sim.planet);
      for (const id of this.sim.charIds()) {
        const c = this.sim.getState(id).p;
        const rx = c[0] - cc[0], ry = c[1] - cc[1], rz = c[2] - cc[2];
        const vert = rx * bup2[0] + ry * bup2[1] + rz * bup2[2];
        const tan = Math.hypot(rx - bup2[0] * vert, ry - bup2[1] * vert, rz - bup2[2] * vert);
        if (tan < 0.85 && vert > -1.3 && vert < 1.3) return;
      }
      player.blocks--;
      this.faceDebt[faceOfCell(msg.x, msg.y, msg.z)]--;
      this.applyBlockEdits([[msg.x, msg.y, msg.z, B_BUILD]]);
    }
  }

  /** Bounded Minecraft-style pour: emptied cells that touch water fill up,
   * water falls down shafts and spreads over supported ground. */
  private flowWater(seeds: [number, number, number][]): void {
    const vox = this.sim.vox;
    if (!vox || !this.sim.planet) return;
    const filled = new Set<string>();
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const isWater = (x: number, y: number, z: number) =>
      vox.get(x, y, z) === B_WATER || filled.has(key(x, y, z));
    const isAir = (x: number, y: number, z: number) =>
      vox.get(x, y, z) === 0 && !filled.has(key(x, y, z));
    const queue: [number, number, number][] = [];
    for (const [x, y, z] of seeds) {
      if (!isAir(x, y, z)) continue;
      // water pours in from the SIDES or ABOVE — never wells UP from below
      // (that made lakes climb one block every time you broke a shore block)
      const up = faceUp([x + 0.5, y + 0.5, z + 0.5], null, true);
      const { t1, t2 } = basis(up);
      const ingress = [up, t1, [-t1[0], -t1[1], -t1[2]], t2, [-t2[0], -t2[1], -t2[2]]] as const;
      if (ingress.some((d) => isWater(x + d[0], y + d[1], z + d[2]))) queue.push([x, y, z]);
    }
    const edits: [number, number, number, number][] = [];
    let budget = 80;
    while (queue.length && budget > 0) {
      const [x, y, z] = queue.shift()!;
      if (!isAir(x, y, z)) continue;
      filled.add(key(x, y, z));
      edits.push([x, y, z, B_WATER]);
      budget--;
      const up = faceUp([x + 0.5, y + 0.5, z + 0.5], null, true);
      const bx = x - up[0], by = y - up[1], bz = z - up[2];
      if (isAir(bx, by, bz)) {
        queue.push([bx, by, bz]); // pour straight down first
        continue;
      }
      // spread sideways only over support (no floating water shelves)
      const { t1, t2 } = basis(up);
      for (const t of [t1, [-t1[0], -t1[1], -t1[2]], t2, [-t2[0], -t2[1], -t2[2]]] as const) {
        const nx = x + t[0], ny = y + t[1], nz = z + t[2];
        if (!isAir(nx, ny, nz)) continue;
        if (!isAir(nx - up[0], ny - up[1], nz - up[2])) queue.push([nx, ny, nz]);
      }
    }
    this.applyBlockEdits(edits);
  }

  /** Apply authoritative edits to the sim world and tell every client. */
  private applyBlockEdits(edits: [number, number, number, number][]): void {
    if (!edits.length) return;
    for (const [x, y, z, b] of edits) this.sim.applyBlock(x, y, z, b);
    this.broadcast({ t: "block", e: edits });
  }

  /** Weapon fire / grenade throws / slot swaps for one applied input. */
  private handleFire(player: Player, input: InputState): void {
    // Slot swap (edge): only when the second slot holds a gun.
    if (input.swap && !player.prevSwap && player.slots[1]) {
      player.activeSlot = player.activeSlot === 0 ? 1 : 0;
      player.cooldownUntilTick = this.tickCount + 12; // draw time
    }
    const weaponId = player.slots[player.activeSlot] ?? DEFAULT_WEAPON;
    const weapon = WEAPONS[weaponId] ?? WEAPONS[DEFAULT_WEAPON];
    const wantsFire = weapon.auto ? input.fire : input.fire && !player.prevFire;
    const state = this.sim.getState(player.id);
    // Aim in the shooter's FACE FRAME (identical to the old formula off the
    // planet, where up = +Y).
    const up = this.sim.getUp(player.id);
    const dir = dirFromYawPitch(input.yaw, input.aimPitch, up);
    const hasAmmo = player.ammo[player.activeSlot] > 0;
    if (wantsFire && hasAmmo && this.tickCount >= player.cooldownUntilTick) {
      player.cooldownUntilTick = this.tickCount + weapon.cooldownTicks;
      if (Number.isFinite(player.ammo[player.activeSlot])) player.ammo[player.activeSlot]--;
      // Muzzle: ON the camera ray (center eye, slightly forward). Darts that
      // start on the crosshair line hit the crosshair at EVERY distance by
      // construction — the visible hand tracer is cosmetic only.
      const muzzle: [number, number, number] = [
        state.p[0] + up[0] * EYE_HEIGHT + dir[0] * 0.4,
        state.p[1] + up[1] * EYE_HEIGHT + dir[1] * 0.4,
        state.p[2] + up[2] * EYE_HEIGHT + dir[2] * 0.4,
      ];
      this.darts.push({
        id: `dart-${this.nextProjectileId++}`,
        owner: player.id,
        weapon: weapon.id,
        p: muzzle,
        o: [...muzzle],
        v: [dir[0] * weapon.dartSpeed, dir[1] * weapon.dartSpeed, dir[2] * weapon.dartSpeed],
        ticksLeft: DART_LIFE_TICKS,
      });
    }
    if (input.nade && !player.prevNade && player.grenades > 0) {
      player.grenades--;
      this.nades.push({
        id: `nade-${this.nextProjectileId++}`,
        owner: player.id,
        p: [
          state.p[0] + dir[0] * 0.6 + up[0] * 0.4,
          state.p[1] + dir[1] * 0.6 + up[1] * 0.4,
          state.p[2] + dir[2] * 0.6 + up[2] * 0.4,
        ],
        v: [
          dir[0] * GRENADE.throwSpeed + up[0] * GRENADE.throwUp,
          dir[1] * GRENADE.throwSpeed + up[1] * GRENADE.throwUp,
          dir[2] * GRENADE.throwSpeed + up[2] * GRENADE.throwUp,
        ],
        fuse: GRENADE.fuseTicks,
      });
    }
    player.prevFire = input.fire;
    player.prevNade = input.nade;
    player.prevSwap = input.swap;
  }

  /** Walk-over pickups (weapons, grenades, ammo cells, first-aid kits). */
  private handlePickups(): void {
    for (const crate of this.crates) {
      if (this.tickCount < crate.availableAtTick) continue;
      for (const p of this.roster.all()) {
        if (!p.alive || !this.sim.hasChar(p.id)) continue;
        const s = this.sim.getState(p.id);
        // full 3D pickup radius: works on every planet face (and city floors)
        if (
          Math.hypot(s.p[0] - crate.x, s.p[1] - crate.y, s.p[2] - crate.z) >
          PICKUP_RADIUS + CHAR_CENTER_Y
        )
          continue;
        if (crate.weapon === "grenade") p.grenades += GRENADES_PER_PICKUP;
        else if (crate.weapon === ITEM_HEALTH) {
          if (p.hp >= MAX_HP) continue; // don't waste the kit — leave it armed
          p.hp = Math.min(MAX_HP, p.hp + HEALTH_PACK_HP);
          this.broadcast({ t: "damage", id: p.id, hp: p.hp, attackerId: "" }); // hp update
        } else if (crate.weapon === ITEM_AMMO) {
          // refills BOTH guns; skipped only when everything is already full
          const cap0 = WEAPONS[p.slots[0]]?.ammoCap ?? 0;
          const cap1 = p.slots[1] ? WEAPONS[p.slots[1]]?.ammoCap ?? 0 : 0;
          if (p.ammo[0] >= cap0 && p.ammo[1] >= cap1) continue;
          p.ammo[0] = cap0;
          if (p.slots[1]) p.ammo[1] = cap1;
        } else {
          this.grantGun(p, crate.weapon);
        }
        crate.availableAtTick = this.tickCount + CRATE_RESPAWN_S * TICK_RATE;
        break;
      }
    }

    // dropped guns: grabbing one SWAPS — your old gun goes INTO the drop
    // entity in place (guns are conserved; no drop-chains multiplying guns)
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (this.tickCount >= d.expiresAtTick) {
        this.drops.splice(i, 1);
        continue;
      }
      for (const p of this.roster.all()) {
        if (!p.alive || !this.sim.hasChar(p.id)) continue;
        const s = this.sim.getState(p.id);
        const dist = Math.hypot(s.p[0] - d.x, s.p[1] - d.y, s.p[2] - d.z);
        // the dropper can't re-grab their own discard until they STEP AWAY
        // once (a time lock made standing on it swap back and forth forever)
        if (p.id === d.lockId) {
          if (dist > PICKUP_RADIUS + CHAR_CENTER_Y + 1) d.lockId = "";
          continue;
        }
        if (dist > PICKUP_RADIUS + CHAR_CENTER_Y) continue;
        const traded = this.equipGun(p, d.weapon);
        if (traded && traded !== DEFAULT_WEAPON) {
          // swap in place: the drop now holds what the player was carrying
          d.weapon = traded;
          d.lockId = p.id;
          d.expiresAtTick = this.tickCount + 30 * TICK_RATE;
        } else {
          this.drops.splice(i, 1);
        }
        break;
      }
    }
  }

  /** Equip a gun into THE gun slot (single-slot loadout, user decision
   * 2026-08-12); returns the replaced gun, "" if none. */
  private equipGun(p: Player, weapon: string): string {
    const old = p.slots[0] ?? "";
    p.slots[0] = weapon;
    p.ammo[0] = WEAPONS[weapon]?.ammoCap ?? 0;
    p.activeSlot = 0;
    p.cooldownUntilTick = this.tickCount + 12; // draw time
    return old;
  }

  /** Crate pickup: equip, and DROP the replaced gun at the feet. The starter
   * blaster never drops (everyone has one — it would only be floor litter). */
  private grantGun(p: Player, weapon: string): void {
    const old = this.equipGun(p, weapon);
    if (!old || old === DEFAULT_WEAPON) return;
    const s = this.sim.getState(p.id);
    this.drops.push({
      id: `drop-${this.nextDropId++}`,
      x: s.p[0], y: s.p[1], z: s.p[2],
      weapon: old,
      expiresAtTick: this.tickCount + 30 * TICK_RATE,
      lockId: p.id,
    });
    if (this.drops.length > 16) this.drops.shift(); // floor-litter cap
  }

  /** Environmental damage (lava, falls): no attacker credit, can knock out. */
  private hurt(p: Player, dmg: number, now: number): void {
    p.hp = Math.max(0, p.hp - dmg);
    p.lastDamagedAt = now;
    this.broadcast({ t: "damage", id: p.id, hp: p.hp, attackerId: "" });
    if (p.hp <= 0) {
      p.alive = false;
      p.deaths++;
      p.respawnAt = now + RESPAWN_DELAY_S;
      this.sim.removeChar(p.id);
      this.broadcast({ t: "knockout", victimId: p.id, attackerId: "", scores: this.scores() });
    }
  }

  private applyCombatResult(res: CombatResult, now: number): void {
    for (const d of res.damaged)
      this.broadcast({ t: "damage", id: d.id, hp: d.hp, attackerId: d.attackerId, headshot: d.headshot });
    for (const k of res.knockouts) {
      this.sim.removeChar(k.victimId); // body disappears; respawn re-adds it
      this.broadcast({ t: "knockout", victimId: k.victimId, attackerId: k.attackerId, scores: this.scores() });
      const attacker = this.roster.get(k.attackerId);
      if (attacker && k.attackerId !== k.victimId) {
        if (!attacker.bot) this.accounts.setScore(attacker.name, attacker.score);
        // KILL HEAL: +50 hp to the killer (the only heal besides packs)
        if (attacker.alive && attacker.hp < MAX_HP) {
          attacker.hp = Math.min(MAX_HP, attacker.hp + 50);
          this.broadcast({ t: "damage", id: attacker.id, hp: attacker.hp, attackerId: "" });
        }
      }
    }
  }

  private tick(): void {
    // Drain one queued input per player per tick. Shed only a GENUINE
    // backlog (network hiccup piled >4 ticks of added latency), and in one
    // visible correction: steady-state timer jitter makes the queue breathe
    // 0..3, and dropping an input there shears the client's replay by one
    // tick (a visible yank at sprint speed).
    for (const [id, queue] of this.inputQueues) {
      const player = this.roster.get(id);
      if (!player || !player.alive) {
        queue.length = 0;
        continue;
      }
      if (queue.length === 0) {
        this.starving.add(id);
        continue;
      }
      if (this.starving.has(id)) {
        if (queue.length < 2) continue;
        this.starving.delete(id);
      }
      const input = queue.shift()!;
      // GRADUAL backlog drain: a client frame hitch bursts inputs; shedding
      // the pile in one splice sheared the replay by 20+ ticks (a 2.5m+ HARD
      // SNAP at sprint speed). Bleed ONE extra input occasionally instead —
      // and ONLY past a comfortable depth (draining at shallow depths caused
      // a constant push-pull ripple; a steady queue of ≤6 is just ~100 ms of
      // input latency, invisible next to rubber-banding).
      if (queue.length > 6 && this.tickCount % 10 === 0) queue.shift();
      // true network death only: reset hard (one visible snap, then clean)
      if (queue.length > 30) queue.splice(0, queue.length - 6);
      player.lastInputSeq = input.seq;
      player.lastSel = input.sel ?? 1;
      this.sim.setInput(id, input);
      this.handleFire(player, input);
    }
    if (this.botsEnabled) {
      if (this.tickCount % 60 === 0) this.ensureBots();
      this.botTick(this.now());
    }
    this.ship?.tick(TICK_DT);
    this.sim.step();
    this.tickCount++;
    const now = this.now();

    // Projectiles step against the post-step world.
    const aliveIds = this.roster.all().filter((p) => p.alive && this.sim.hasChar(p.id)).map((p) => p.id);
    const dartEnds = stepDarts(this.sim, this.darts, aliveIds);
    const exploded = stepNades(this.sim, this.nades);
    this.applyCombatResult(this.combat.processDartHits(dartEnds, now), now);
    if (exploded.length) {
      this.applyCombatResult(
        this.combat.processExplosions(
          exploded,
          (id) => (this.sim.hasChar(id) ? this.sim.getState(id).p : null),
          now,
        ),
        now,
      );
      // grenades blast craters into voxel terrain (batched per explosion);
      // bedrock and fluids don't crater, and every destroyed block DROPS
      // into the thrower's build stock (same mined=earned economy, 99 cap)
      if (this.sim.vox) {
        for (const n of exploded) {
          const edits: [number, number, number, number][] = [];
          const R = 3.0; // crater matches the bigger 8 m blast
          for (let x = Math.floor(n.p[0] - R); x <= n.p[0] + R; x++)
            for (let y = Math.floor(n.p[1] - R); y <= n.p[1] + R; y++)
              for (let z = Math.floor(n.p[2] - R); z <= n.p[2] + R; z++) {
                if (Math.hypot(x + 0.5 - n.p[0], y + 0.5 - n.p[1], z + 0.5 - n.p[2]) > R) continue;
                const b = this.sim.vox.get(x, y, z);
                if (b === 0 || b === B_BEDROCK || b === B_WATER || b === B_LAVA) continue;
                edits.push([x, y, z, 0]);
              }
          this.applyBlockEdits(edits);
          for (const [ex, ey, ez] of edits) this.faceDebt[faceOfCell(ex, ey, ez)]++;
          this.flowWater(edits.map(([ex, ey, ez]) => [ex, ey, ez] as [number, number, number]));
          const owner = this.roster.get(n.owner);
          if (owner && edits.length) owner.blocks = Math.min(99, owner.blocks + edits.length);
        }
      }
    }
    this.handlePickups();

    const upkeep = this.combat.tick(now);
    for (const id of upkeep.respawns) {
      const p = this.roster.get(id);
      if (!p) continue;
      const s = this.nextSpawn(p.id);
      p.slots = [DEFAULT_WEAPON, null];
      p.activeSlot = 0;
      p.ammo = [WEAPONS[DEFAULT_WEAPON].ammoCap, 0];
      p.grenades = 0;
      p.blocks = START_BLOCKS;
      this.sim.addChar(id, s.x, s.z, s.rotY, s.y ?? 0);
      this.broadcast({ t: "respawn", id });
    }

    // LAVA burns: standing in a pool ticks damage (~30 hp/s), no credit.
    if (this.sim.vox && this.tickCount % 6 === 0) {
      for (const p of this.roster.all()) {
        if (!p.alive || !this.sim.hasChar(p.id) || now < p.protectedUntil) continue;
        const s = this.sim.getState(p.id);
        const bup = this.sim.getUp(p.id);
        const feet = this.sim.vox.get(
          Math.floor(s.p[0] - bup[0] * 0.8),
          Math.floor(s.p[1] - bup[1] * 0.8),
          Math.floor(s.p[2] - bup[2] * 0.8),
        );
        if (feet === B_LAVA) {
          this.hurt(p, 3, now);
          continue;
        }
        // CACTUS spines: brushing against (or standing on) a cactus pricks —
        // check the foot cell's 4 side neighbors and the block underfoot
        const fx = Math.floor(s.p[0] - bup[0] * 0.8);
        const fy = Math.floor(s.p[1] - bup[1] * 0.8);
        const fz = Math.floor(s.p[2] - bup[2] * 0.8);
        const { t1, t2 } = basis(bup);
        const pricked =
          this.sim.vox.get(fx - bup[0], fy - bup[1], fz - bup[2]) === B_CACTUS ||
          this.sim.vox.get(fx + t1[0], fy + t1[1], fz + t1[2]) === B_CACTUS ||
          this.sim.vox.get(fx - t1[0], fy - t1[1], fz - t1[2]) === B_CACTUS ||
          this.sim.vox.get(fx + t2[0], fy + t2[1], fz + t2[2]) === B_CACTUS ||
          this.sim.vox.get(fx - t2[0], fy - t2[1], fz - t2[2]) === B_CACTUS;
        if (pricked) this.hurt(p, 1, now);
        // BREATHING: head underwater drains 1 hp per 20 s (hiding has a cost)
        const eye = this.sim.vox.get(
          Math.floor(s.p[0] + bup[0] * EYE_HEIGHT),
          Math.floor(s.p[1] + bup[1] * EYE_HEIGHT),
          Math.floor(s.p[2] + bup[2] * EYE_HEIGHT),
        );
        if (eye === B_WATER) {
          p.underwaterTicks = (p.underwaterTicks ?? 0) + 6;
          if (p.underwaterTicks >= 20 * TICK_RATE) {
            p.underwaterTicks = 0;
            this.hurt(p, 1, now);
          }
        } else {
          p.underwaterTicks = 0;
        }
      }
    }

    // FACE REGENERATION: a face whose blocks were carried elsewhere (debt)
    // slowly grows material back — every side keeps a minimum of itself.
    if (this.sim.vox && this.sim.planet && this.tickCount % (12 * TICK_RATE) === 0) {
      const edits: [number, number, number, number][] = [];
      for (let fi = 0; fi < 6; fi++) {
        if (this.faceDebt[fi] <= 150) continue;
        const f = FACES[fi];
        for (let attempt = 0; attempt < 6 && this.faceDebt[fi] > 150; attempt++) {
          const u = Math.floor((Math.random() * 2 - 1) * (PLANET_R - 8));
          const v = Math.floor((Math.random() * 2 - 1) * (PLANET_R - 8));
          // scan the face column from high above down to the shell
          for (let k = 28; k >= 0; k--) {
            const out = (n: number) => (n > 0 ? PLANET_R - 1 + k : -PLANET_R - k);
            const cx = f.n[0] !== 0 ? out(f.n[0]) : f.a[0] * u + f.b[0] * v;
            const cy = f.n[1] !== 0 ? out(f.n[1]) : f.a[1] * u + f.b[1] * v;
            const cz = f.n[2] !== 0 ? out(f.n[2]) : f.a[2] * u + f.b[2] * v;
            const b = this.sim.vox.get(cx, cy, cz);
            if (b === 0) continue;
            if (b === B_WATER || b === B_LAVA) break; // never cap a lake
            // first solid from above: materialize the biome's sub block on
            // top — unless someone is standing there
            const px = cx + f.n[0] + 0.5, py = cy + f.n[1] + 0.5, pz = cz + f.n[2] + 0.5;
            const blocked = this.sim.charIds().some((id) => {
              const c = this.sim.getState(id).p;
              return Math.hypot(c[0] - px, c[1] - py, c[2] - pz) < 2.2;
            });
            if (!blocked) {
              edits.push([cx + f.n[0], cy + f.n[1], cz + f.n[2], BIOMES[fi].sub]);
              this.faceDebt[fi]--;
            }
            break;
          }
        }
      }
      this.applyBlockEdits(edits);
    }

    // FALL DAMAGE: hard landings hurt, scaled by impact speed over the safe
    // threshold (the sim records each landing's speed; consume every tick).
    // Per-biome multiplier: the moon face forgives, the volcano punishes.
    for (const p of this.roster.all()) {
      if (!this.sim.hasChar(p.id)) continue;
      const impact = this.sim.consumeImpact(p.id);
      if (!p.alive || impact <= FALL_SAFE_SPEED || now < p.protectedUntil) continue;
      const fallMul = this.sim.planet
        ? BIOMES[faceIndexOfUp(this.sim.getUp(p.id))].fallDmg ?? 1
        : 1;
      const dmg = Math.round((impact - FALL_SAFE_SPEED) * FALL_DMG_PER_MS * fallMul);
      if (dmg > 0) this.hurt(p, dmg, now);
    }


    // World hazard: walked/knocked into the sea.
    for (const p of this.roster.all()) {
      if (!p.alive || !this.sim.hasChar(p.id)) continue;
      const pos = this.sim.getState(p.id).p;
      const lost = this.sim.planet
        ? !onPlanet(pos) // flung into space
        : pos[1] < (this.sim.vox ? SKY_KILL_Y : KILL_FLOOR_Y);
      if (lost) this.hazardRespawn(p, pos, now);
    }

    if (this.tickCount % SNAPSHOT_EVERY === 0) {
      const chars: CharSnap[] = [];
      for (const p of this.roster.all()) {
        if (!p.alive || !this.sim.hasChar(p.id)) continue;
        const { p: pos, q, v, grounded } = this.sim.getState(p.id);
        const active = p.slots[p.activeSlot] ?? DEFAULT_WEAPON;
        const clip = p.ammo[p.activeSlot];
        chars.push({
          id: p.id, p: pos, q, v, hp: p.hp, weapon: active, grounded,
          nades: p.grenades,
          ammo: Number.isFinite(clip) ? clip : -1, // JSON has no Infinity
          slot2: p.slots[p.activeSlot === 0 ? 1 : 0] ?? "",
          aslot: p.activeSlot,
          blocks: p.blocks,
          fly: this.sim.getFly(p.id) || undefined,
        });
      }
      for (const id of this.sim.propIds()) {
        const { p: pos, q, v } = this.sim.getPropState(id);
        chars.push({ id, p: pos, q, v, hp: 0, weapon: "", grounded: false });
      }
      if (this.ship) chars.push(this.ship.snap());
      // dropped guns ride the snapshot like crates: hp 1 = grabbable
      for (const d of this.drops) {
        chars.push({
          id: d.id, p: [d.x, d.y, d.z], q: [0, 0, 0, 1], v: [0, 0, 0],
          hp: 1, weapon: d.weapon, grounded: true,
        });
      }
      // crate pickup states ride the snapshot as pseudo-entities: id
      // "crate-<n>", weapon = what's inside, hp 1 armed / 0 rearming.
      this.crates.forEach((c, i) => {
        chars.push({
          id: `crate-${i}`,
          p: [c.x, c.y, c.z],
          q: [0, 0, 0, 1],
          v: [0, 0, 0],
          hp: this.tickCount >= c.availableAtTick ? 1 : 0,
          weapon: c.weapon,
          grounded: true,
        });
      });
      const darts: DartSnap[] = [
        ...this.darts.map((d) => ({ id: d.id, p: d.p, v: d.v, owner: d.owner })),
        ...this.nades.map((n) => ({ id: n.id, p: n.p, v: n.v, owner: n.owner })),
      ];
      const time = this.now();
      for (const [id, ws] of this.sockets) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const lastSeq = this.roster.get(id)?.lastInputSeq ?? 0;
        ws.send(encode({ t: "snapshot", time, lastSeq, chars, darts }));
      }
    }
  }
}
