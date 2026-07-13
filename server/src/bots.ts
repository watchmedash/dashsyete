import { BOTS_PER_TEAM, PLAYABLE_CARS } from "../../shared/src/constants";
import type { CityMap } from "../../shared/src/cityMap";
import { generateBotName } from "../../shared/src/names";
import type { InputState } from "../../shared/src/protocol";
import type { TeamId } from "../../shared/src/types";
import type { Game } from "./game";
import { NavGrid } from "./nav";

const HUNT_RANGE = 45;    // start chasing an enemy within this distance
                          // (enemy spawn plazas sit >100 m from any foreign route, no spawn-camping)
const HUNT_DROP = 70;     // give up beyond this
const WAYPOINT_REACHED = 8;
const STUCK_SPEED = 1.6;  // m/s (grinding against walls oscillates around ~1)
const STUCK_AFTER_S = 2.5;
const REVERSE_FOR_S = 2;

interface Brain {
  id: string;
  /** Road-following waypoints (tile centers) toward a random destination. */
  path: { x: number; z: number }[];
  pathIdx: number;
  targetId: string | null;
  stuckSince: number | null;
  reversingUntil: number;
  navReversing: boolean;
  escapeSteerSign: number;
  lastStuckAt: number;
  /** Stuck episodes in quick succession; enough of them = hopelessly wedged. */
  stuckStreak: number;
  /** Net-progress watchdog: grinding a wall can keep speed ABOVE the stuck
   * threshold while going nowhere — compare position over a 4 s window. */
  progressPos: { x: number; z: number };
  progressAt: number;
  seq: number;
}

/**
 * Computes steer/throttle to drive from `pos` (facing `heading`) toward
 * `target`. When the target is far behind, backs up while swinging the nose
 * toward it (reverse-turn) -- `wasReversing` adds hysteresis so the bot
 * commits to the maneuver instead of oscillating at the mode boundary.
 */
export function steerToward(
  pos: { x: number; z: number },
  heading: number,
  target: { x: number; z: number },
  wasReversing = false,
): { steer: number; throttle: number; reversing: boolean } {
  const desired = Math.atan2(target.x - pos.x, target.z - pos.z);
  let angle = desired - heading;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;

  const enterReverse = 2.4;
  const exitReverse = 1.1;
  const reversing = wasReversing ? Math.abs(angle) > exitReverse : Math.abs(angle) > enterReverse;
  if (reversing) {
    // Backing up swings the nose opposite the steer direction.
    return { steer: -Math.sign(angle), throttle: -0.8, reversing };
  }
  // Positive steer increases yaw (verified against the rapier controller),
  // and angle = desired - heading, so steering toward the target is +angle.
  const steer = Math.max(-1, Math.min(1, angle * 1.5));
  return { steer, throttle: 1, reversing };
}

/**
 * Reverse-steer that swings the nose TOWARD a target at relative bearing
 * `angle` while backing up (the nose swings opposite the steer direction --
 * same empirically verified convention as steerToward's reverse mode).
 */
export function escapeSteer(angle: number): number {
  return -Math.sign(angle) || 1;
}

function bearing(pos: { x: number; z: number }, heading: number, target: { x: number; z: number }): number {
  let angle = Math.atan2(target.x - pos.x, target.z - pos.z) - heading;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

export class Bots {
  private game: Game;
  private map: CityMap;
  private nav: NavGrid;
  private brains: Brain[] = [];

  constructor(game: Game, map: CityMap) {
    this.game = game;
    this.map = map;
    this.nav = new NavGrid(map);
  }

  /** One stuck episode: reverse out; on repeats re-route; hopelessly wedged
   * bots get rescued the way flip/fall hazards do — teleport home. */
  private recoverStuck(
    brain: Brain,
    team: TeamId,
    pos: { x: number; z: number },
    heading: number,
    now: number,
  ): void {
    brain.stuckStreak = now - brain.lastStuckAt < 20 ? brain.stuckStreak + 1 : 1;
    if (brain.stuckStreak >= 4) {
      const s = this.game.nextSpawn(team);
      this.game.sim.teleport(brain.id, s.x, s.z, s.rotY);
      this.replan(brain, { x: s.x, z: s.z });
      brain.stuckStreak = 0;
      brain.lastStuckAt = -Infinity;
      return;
    }
    const wp = brain.path[brain.pathIdx] ?? pos;
    brain.escapeSteerSign = escapeSteer(bearing(pos, heading, wp));
    if (now - brain.lastStuckAt < 10) {
      // Second wedge in short order: the plan isn't working -- pick a fresh
      // route and try backing the other way.
      this.replan(brain, pos);
      brain.escapeSteerSign = -brain.escapeSteerSign;
    }
    brain.lastStuckAt = now;
    brain.reversingUntil = now + REVERSE_FOR_S;
  }

  /** New random road route from wherever the bot is. Each bot wanders the
   * whole network (downtown-biased) instead of the old per-team conga loop. */
  private replan(brain: Brain, pos: { x: number; z: number }): void {
    const start = this.nav.nearest(pos.x, pos.z);
    let dest = this.nav.randomDestination();
    // a destination on top of us produces a 1-cell path; pick again once
    if (dest[0] === start[0] && dest[1] === start[1]) dest = this.nav.randomDestination();
    const cells = this.nav.path(start, dest);
    brain.path = (cells ?? [start]).map((c) => this.nav.toWorld(c));
    brain.pathIdx = 0;
  }

  spawnAll(): void {
    const taken = new Set<string>();
    let n = 0;
    for (let team = 0 as TeamId; team < 4; team++) {
      for (let i = 0; i < BOTS_PER_TEAM; i++) {
        const name = generateBotName(taken);
        taken.add(name);
        const car = PLAYABLE_CARS[Math.floor(Math.random() * PLAYABLE_CARS.length)];
        const player = this.game.addPlayer({ id: `bot-${n++}`, name, car, team: team as TeamId, bot: true });
        this.brains.push({
          id: player.id,
          path: [],
          pathIdx: 0,
          targetId: null,
          stuckSince: null,
          reversingUntil: 0,
          navReversing: false,
          escapeSteerSign: 1,
          lastStuckAt: -Infinity,
          stuckStreak: 0,
          progressPos: { x: 0, z: 0 },
          progressAt: 0,
          seq: 0,
        });
      }
    }
  }

  tick(now: number): void {
    for (const brain of this.brains) {
      const me = this.game.roster.get(brain.id);
      if (!me || !me.alive || !this.game.sim.hasCar(brain.id)) continue;

      const { p, q, v } = this.game.sim.getState(brain.id);
      const pos = { x: p[0], z: p[2] };
      const heading = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
      const speed = Math.hypot(v[0], v[2]);

      // Stuck recovery: back up swinging the nose toward the waypoint
      if (now < brain.reversingUntil) {
        this.send(brain, { throttle: -1, steer: brain.escapeSteerSign });
        continue;
      }
      // Progress watchdog (cruise only): wall-grinding keeps speed above the
      // stuck threshold while going nowhere. Hunts are exempt — shoving
      // matches legitimately pin cars in place.
      if (now - brain.progressAt >= 4) {
        const moved = Math.hypot(pos.x - brain.progressPos.x, pos.z - brain.progressPos.z);
        brain.progressPos = { x: pos.x, z: pos.z };
        brain.progressAt = now;
        if (moved < 4 && !brain.targetId) {
          this.recoverStuck(brain, me.team, pos, heading, now);
          continue;
        }
      }
      if (speed < STUCK_SPEED) {
        brain.stuckSince ??= now;
        if (now - brain.stuckSince > STUCK_AFTER_S) {
          brain.stuckSince = null;
          this.recoverStuck(brain, me.team, pos, heading, now);
          continue;
        }
      } else {
        brain.stuckSince = null;
      }

      // Hunt: chase a nearby living enemy
      const target = this.pickTarget(brain, pos, now);
      if (target) {
        const t = this.game.sim.getState(target).p;
        const cmd = steerToward(pos, heading, { x: t[0], z: t[2] }, brain.navReversing);
        brain.navReversing = cmd.reversing;
        this.send(brain, cmd);
        continue;
      }

      // Cruise: follow the planned road route. Replan when there is no route,
      // the route is done, or a hunt/knock dragged us far off it (>40 m —
      // beelining back from there could cut through building blocks).
      let wp = brain.path[brain.pathIdx];
      if (!wp || Math.hypot(wp.x - pos.x, wp.z - pos.z) > 40) {
        this.replan(brain, pos);
        wp = brain.path[brain.pathIdx];
      }
      // advance past every waypoint we're already on top of (12 m spacing)
      while (
        brain.pathIdx < brain.path.length - 1 &&
        Math.hypot(wp.x - pos.x, wp.z - pos.z) < WAYPOINT_REACHED
      ) {
        brain.pathIdx++;
        wp = brain.path[brain.pathIdx];
      }
      if (Math.hypot(wp.x - pos.x, wp.z - pos.z) < WAYPOINT_REACHED) {
        // destination reached — wander on
        this.replan(brain, pos);
        wp = brain.path[brain.pathIdx];
      }
      const cmd = steerToward(pos, heading, wp, brain.navReversing);
      brain.navReversing = cmd.reversing;
      this.send(brain, cmd);
    }
  }

  private pickTarget(brain: Brain, pos: { x: number; z: number }, now: number): string | null {
    const me = this.game.roster.get(brain.id)!;

    // Keep the current target while it stays in range and alive
    if (brain.targetId) {
      const t = this.game.roster.get(brain.targetId);
      if (t && t.alive && this.game.sim.hasCar(t.id) && now >= t.protectedUntil) {
        const tp = this.game.sim.getState(t.id).p;
        if (Math.hypot(tp[0] - pos.x, tp[2] - pos.z) < HUNT_DROP) return brain.targetId;
      }
      brain.targetId = null;
    }

    let best: string | null = null;
    let bestDist = HUNT_RANGE;
    for (const other of this.game.roster.all()) {
      if (other.team === me.team || !other.alive || now < other.protectedUntil) continue;
      if (!this.game.sim.hasCar(other.id)) continue;
      const op = this.game.sim.getState(other.id).p;
      const d = Math.hypot(op[0] - pos.x, op[2] - pos.z);
      if (d < bestDist) {
        bestDist = d;
        best = other.id;
      }
    }
    brain.targetId = best;
    return best;
  }

  private send(brain: Brain, cmd: { throttle: number; steer: number }): void {
    const input: InputState = {
      seq: ++brain.seq,
      throttle: cmd.throttle,
      steer: cmd.steer,
      brake: 0,
      handbrake: false,
    };
    this.game.sim.setInput(brain.id, input);
  }
}

