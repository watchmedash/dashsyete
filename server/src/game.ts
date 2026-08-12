import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import {
  CRATE_RESPAWN_S, GRENADES_PER_PICKUP, KILL_FLOOR_Y, MAX_HP, MODEL_SCALES, PICKUP_RADIUS,
  RESPAWN_DELAY_S, SNAPSHOT_EVERY, SPAWN_PROTECTION_S, TICK_DT, TICK_RATE,
} from "../../shared/src/constants";
import { MODEL_FOOTPRINTS } from "../../shared/src/modelFootprints";
import {
  B_BEDROCK, B_LAVA, B_PLANK, B_WATER, BUILD_REACH, SKY_KILL_Y, START_BLOCKS, onPlanet,
} from "../../shared/src/skyMap";
import { dirFromYawPitch } from "../../shared/src/gravity";
import {
  decodeClient, encode,
  type CharSnap, type DartSnap, type InputState, type PlayerInfo, type Scores, type ServerMsg,
} from "../../shared/src/protocol";
import { tileToWorld } from "../../shared/src/cityMap";
import { CHAR_CENTER_Y, EYE_HEIGHT } from "../../shared/src/character";
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
  readonly server: http.Server;
  private wss: WebSocketServer;
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
  private darts: Dart[] = [];
  private nades: Nade[] = [];
  private nextProjectileId = 1;
  private crates: CrateState[] = [];
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
    await new Promise<void>((resolve) => server.listen(port, resolve));
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
    return { players: this.roster.all().map((p) => ({ id: p.id, score: p.score, deaths: p.deaths })) };
  }

  playerInfo(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, skin: p.skin, score: p.score };
  }

  private occupied(p: { x: number; z: number }, exceptId?: string): boolean {
    return this.roster.all().some((pl) => {
      if (pl.id === exceptId || !pl.alive || !this.sim.hasChar(pl.id)) return false;
      const s = this.sim.getState(pl.id);
      return Math.hypot(s.p[0] - p.x, s.p[2] - p.z) < 3;
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

  /** FFA spawn: the clear spawn point farthest from every living enemy. */
  nextSpawn(exceptId?: string): { x: number; z: number; rotY: number; y?: number } {
    const points = this.sim.map.spawns;
    const enemies = this.roster
      .all()
      .filter((p) => p.alive && p.id !== exceptId && this.sim.hasChar(p.id))
      .map((p) => this.sim.getState(p.id).p);
    let best = points[this.spawnCursor++ % points.length];
    let bestScore = -Infinity;
    for (const point of points) {
      if (this.occupied(point, exceptId)) continue;
      const nearest = enemies.length
        ? Math.min(...enemies.map((e) => Math.hypot(e[0] - point.x, e[2] - point.z)))
        : Math.random() * 0; // no enemies: any clear point (cursor fallback below)
      const score = enemies.length ? nearest : 1;
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
      ammo: [WEAPONS[DEFAULT_WEAPON].ammoCap, 0],
      cooldownUntilTick: 0,
      grenades: 0,
      prevFire: false,
      prevNade: false,
      prevSwap: false,
    };
    this.roster.add(player);
    // First impressions: JOINS land on the grassland top face; knockout
    // respawns can use any face (nextSpawn picks farthest-from-enemies).
    let s = this.nextSpawn(player.id);
    if (this.sim.planet) {
      const tops = this.sim.map.spawns.filter(
        (sp) => (sp.y ?? 0) > 50 && !this.occupied(sp, player.id), // top face: foot y ≥ R
      );
      if (tops.length) s = tops[Math.floor(Math.random() * tops.length)];
    }
    this.sim.addChar(player.id, s.x, s.z, s.rotY, s.y ?? 0);
    this.broadcast({ t: "join", player: this.playerInfo(player) }, player.id);
    return player;
  }

  removePlayer(id: string): void {
    if (!this.roster.get(id)) return;
    this.sim.removeChar(id);
    this.roster.remove(id);
    this.sockets.delete(id);
    this.inputQueues.delete(id);
    this.starving.delete(id);
    this.lastUnstuck.delete(id);
    this.darts = this.darts.filter((d) => d.owner !== id);
    this.broadcast({ t: "leave", id });
  }

  private onConnection(ws: WebSocket): void {
    let playerId: string | null = null;

    ws.on("message", (data) => {
      const msg = decodeClient(String(data));
      if (!msg) return;

      if (msg.t === "hello" && playerId === null) {
        const rejectWith = (reason: string) => ws.send(encode({ t: "reject", reason }));
        const alreadyOnline = this.roster
          .all()
          .some((p) => p.name.toLowerCase() === msg.name.toLowerCase());
        if (alreadyOnline) {
          rejectWith("player already online");
          return;
        }
        const login = this.accounts.login(msg.name, msg.key, msg.skin);
        if (!login.ok) {
          rejectWith(login.reason);
          return;
        }
        const player = this.addPlayer({ name: msg.name, skin: msg.skin });
        player.score = login.account.score;
        playerId = player.id;
        this.sockets.set(playerId, ws);
        this.send(playerId, {
          t: "welcome",
          id: player.id,
          players: this.roster.all().map((p) => this.playerInfo(p)),
          scores: this.scores(),
          vox: this.sim.vox?.serialize(), // current voxel world incl. edits
          key: login.issuedKey, // present only when the name was just minted
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
        if (queue.length > 10) queue.shift(); // stale backlog: stay current
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
      // every mined block converts to building stock, capped at a 99-stack
      player.blocks = Math.min(99, player.blocks + 1);
      this.applyBlockEdits([[msg.x, msg.y, msg.z, 0]]);
    } else {
      // place: cell empty, stock available, no character overlapping the cell
      if (vox.get(msg.x, msg.y, msg.z) !== 0 || player.blocks <= 0) return;
      for (const id of this.sim.charIds()) {
        const c = this.sim.getState(id).p;
        if (
          Math.abs(c[0] - (msg.x + 0.5)) < 0.85 &&
          Math.abs(c[2] - (msg.z + 0.5)) < 0.85 &&
          c[1] + 0.8 > msg.y && c[1] - 0.8 < msg.y + 1
        )
          return;
      }
      player.blocks--;
      this.applyBlockEdits([[msg.x, msg.y, msg.z, B_PLANK]]);
    }
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
          // gun pickup fills slot 2 (full mag) and equips it
          p.slots[1] = crate.weapon;
          p.ammo[1] = WEAPONS[crate.weapon]?.ammoCap ?? 0;
          p.activeSlot = 1;
          p.cooldownUntilTick = 0;
        }
        crate.availableAtTick = this.tickCount + CRATE_RESPAWN_S * TICK_RATE;
        break;
      }
    }
  }

  private applyCombatResult(res: CombatResult, now: number): void {
    for (const d of res.damaged)
      this.broadcast({ t: "damage", id: d.id, hp: d.hp, attackerId: d.attackerId, headshot: d.headshot });
    for (const k of res.knockouts) {
      this.sim.removeChar(k.victimId); // body disappears; respawn re-adds it
      this.broadcast({ t: "knockout", victimId: k.victimId, attackerId: k.attackerId, scores: this.scores() });
      const attacker = this.roster.get(k.attackerId);
      if (attacker) this.accounts.setScore(attacker.name, attacker.score);
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
      if (queue.length > 4) queue.splice(0, queue.length - 2);
      player.lastInputSeq = input.seq;
      this.sim.setInput(id, input);
      this.handleFire(player, input);
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
      // grenades blast craters into voxel terrain (batched per explosion)
      if (this.sim.vox) {
        for (const n of exploded) {
          const edits: [number, number, number, number][] = [];
          const R = 2.2;
          for (let x = Math.floor(n.p[0] - R); x <= n.p[0] + R; x++)
            for (let y = Math.floor(n.p[1] - R); y <= n.p[1] + R; y++)
              for (let z = Math.floor(n.p[2] - R); z <= n.p[2] + R; z++)
                if (
                  Math.hypot(x + 0.5 - n.p[0], y + 0.5 - n.p[1], z + 0.5 - n.p[2]) <= R &&
                  this.sim.vox.get(x, y, z) !== 0
                )
                  edits.push([x, y, z, 0]);
          this.applyBlockEdits(edits);
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
        if (feet !== B_LAVA) continue;
        p.hp = Math.max(0, p.hp - 3);
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
          blocks: p.blocks,
        });
      }
      for (const id of this.sim.propIds()) {
        const { p: pos, q, v } = this.sim.getPropState(id);
        chars.push({ id, p: pos, q, v, hp: 0, weapon: "", grounded: false });
      }
      if (this.ship) chars.push(this.ship.snap());
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
