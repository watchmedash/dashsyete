import { BOTS_PER_TEAM, PLAYABLE_CARS } from "../../shared/src/constants";
import type { CityMap } from "../../shared/src/cityMap";
import { generateBotName } from "../../shared/src/names";
import type { InputState } from "../../shared/src/protocol";
import type { TeamId } from "../../shared/src/types";
import type { Game } from "./game";

const HUNT_RANGE = 45;    // start chasing an enemy within this distance
                          // (enemy spawn plazas sit >100 m from any foreign route, no spawn-camping)
const HUNT_DROP = 70;     // give up beyond this
const WAYPOINT_REACHED = 8;
const STUCK_SPEED = 1.6;  // m/s (grinding against walls oscillates around ~1)
const STUCK_AFTER_S = 2.5;
const REVERSE_FOR_S = 1.2;

interface Brain {
  id: string;
  loop: { x: number; z: number }[];
  waypoint: number;
  dir: 1 | -1;
  targetId: string | null;
  stuckSince: number | null;
  reversingUntil: number;
  navReversing: boolean;
  seq: number;
}

/**
 * Computes steer/throttle to drive from `pos` (facing `heading`) toward
 * `target`. When the target is far behind, backs up while swinging the nose
 * toward it (reverse-turn) — `wasReversing` adds hysteresis so the bot
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

function nearestWaypoint(loop: { x: number; z: number }[], pos: { x: number; z: number }): number {
  let best = 0;
  let bestDist = Infinity;
  loop.forEach((wp, i) => {
    const d = Math.hypot(wp.x - pos.x, wp.z - pos.z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export class Bots {
  private game: Game;
  private map: CityMap;
  private brains: Brain[] = [];

  constructor(game: Game, map: CityMap) {
    this.game = game;
    this.map = map;
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
          // Each team cruises its own route: home island -> spoke bridge ->
          // center ring -> back. Stagger starting waypoints across the
          // plaza-adjacent points (route indices 0..3) so a fresh team
          // doesn't scrum onto a single corner.
          loop: this.map.waypointRoutes[team],
          waypoint: i % 4,
          dir: n % 2 === 0 ? 1 : -1,
          targetId: null,
          stuckSince: null,
          reversingUntil: 0,
          navReversing: false,
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

      // Stuck recovery: reverse with opposite steer for a moment
      if (now < brain.reversingUntil) {
        this.send(brain, { throttle: -1, steer: 0.6 });
        continue;
      }
      const wantsToMove = true;
      if (wantsToMove && speed < STUCK_SPEED) {
        brain.stuckSince ??= now;
        if (now - brain.stuckSince > STUCK_AFTER_S) {
          brain.reversingUntil = now + REVERSE_FOR_S;
          brain.stuckSince = null;
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

      // Cruise waypoint loop. If the current waypoint is far away (fresh
      // spawn, respawn, or post-hunt drift), retarget to the nearest one so
      // the bot heads for a road instead of cutting through buildings.
      const len = brain.loop.length;
      let wp = brain.loop[brain.waypoint % len];
      if (Math.hypot(wp.x - pos.x, wp.z - pos.z) > 40) {
        brain.waypoint = nearestWaypoint(brain.loop, pos);
        wp = brain.loop[brain.waypoint];
      }
      if (Math.hypot(wp.x - pos.x, wp.z - pos.z) < WAYPOINT_REACHED) {
        brain.waypoint = (brain.waypoint + brain.dir + len) % len;
        wp = brain.loop[brain.waypoint];
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
