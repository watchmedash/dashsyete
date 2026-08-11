// Server-authoritative projectile stepping: foam darts (straight-line, short
// lifetime) and grenades (ballistic + bounce + timed explosion). Pure
// functions over a Sim — the server owns the arrays; the client only renders
// darts from snapshots.
import { TICK_DT } from "./constants";
import { CHAR_HALF_HEIGHT, CHAR_RADIUS, GRAVITY } from "./character";
import { HEADSHOT_Y } from "./weapons";
import type { Sim } from "./sim";

export interface Dart {
  id: string;
  owner: string;
  weapon: string;
  p: [number, number, number];
  v: [number, number, number];
  /** Muzzle position — damage falloff runs on distance traveled from here. */
  o: [number, number, number];
  ticksLeft: number;
}

export interface Nade {
  id: string;
  owner: string;
  p: [number, number, number];
  v: [number, number, number];
  fuse: number;
}

export interface DartEnd {
  dart: Dart;
  /** Character hit this tick, or null (wall hit / lifetime expiry). */
  hitChar: string | null;
  hitWorld: boolean;
  /** Hit landed above the shoulders (2× damage). */
  headshot: boolean;
  /** Muzzle-to-impact distance in meters (drives falloff). */
  travel: number;
}

/**
 * Advance every dart one tick. Live darts are mutated in place; darts that
 * ended this tick (character hit, world hit, or expiry) are REMOVED from the
 * array and reported in the result.
 */
export function stepDarts(sim: Sim, darts: Dart[], charIds: string[]): DartEnd[] {
  const ended: DartEnd[] = [];
  for (let i = darts.length - 1; i >= 0; i--) {
    const d = darts[i];
    const segLen = Math.hypot(d.v[0], d.v[1], d.v[2]) * TICK_DT;
    const dir: [number, number, number] = [
      d.v[0] / (segLen / TICK_DT),
      d.v[1] / (segLen / TICK_DT),
      d.v[2] / (segLen / TICK_DT),
    ];

    // Nearest character hit along this tick's segment.
    let bestT = Infinity;
    let bestChar: string | null = null;
    let bestHead = false;
    for (const id of charIds) {
      if (id === d.owner || !sim.hasChar(id)) continue;
      const c = sim.getState(id).p;
      const t = segmentCapsuleHit(d.p, dir, segLen, c);
      if (t !== null && t < bestT) {
        bestT = t;
        bestChar = id;
        bestHead = d.p[1] + dir[1] * t - c[1] > HEADSHOT_Y;
      }
    }

    // World hit (static geometry only).
    const wall = sim.castRayStatic(d.p, dir, segLen);
    if (wall !== null && wall < bestT) {
      bestT = wall;
      bestChar = null;
      bestHead = false;
    }

    const travelTo = (hit: [number, number, number]) =>
      Math.hypot(hit[0] - d.o[0], hit[1] - d.o[1], hit[2] - d.o[2]);

    if (bestT <= segLen) {
      d.p = [d.p[0] + dir[0] * bestT, d.p[1] + dir[1] * bestT, d.p[2] + dir[2] * bestT];
      darts.splice(i, 1);
      ended.push({ dart: d, hitChar: bestChar, hitWorld: bestChar === null, headshot: bestHead, travel: travelTo(d.p) });
      continue;
    }

    d.p = [d.p[0] + d.v[0] * TICK_DT, d.p[1] + d.v[1] * TICK_DT, d.p[2] + d.v[2] * TICK_DT];
    if (--d.ticksLeft <= 0) {
      darts.splice(i, 1);
      ended.push({ dart: d, hitChar: null, hitWorld: false, headshot: false, travel: travelTo(d.p) });
    }
  }
  return ended;
}

/**
 * Advance grenades one tick: gravity, static-world bounces, fuse countdown.
 * Exploded grenades are removed from the array and returned.
 */
export function stepNades(sim: Sim, nades: Nade[]): Nade[] {
  const exploded: Nade[] = [];
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    n.v[1] -= GRAVITY * TICK_DT;
    const segLen = Math.hypot(n.v[0], n.v[1], n.v[2]) * TICK_DT;
    if (segLen > 1e-6) {
      const dir: [number, number, number] = [
        (n.v[0] * TICK_DT) / segLen,
        (n.v[1] * TICK_DT) / segLen,
        (n.v[2] * TICK_DT) / segLen,
      ];
      const hit = sim.castRayStaticN(n.p, dir, segLen + 0.1);
      if (hit && hit.toi <= segLen) {
        // move to just before the surface, then reflect + damp
        const t = Math.max(0, hit.toi - 0.02);
        n.p = [n.p[0] + dir[0] * t, n.p[1] + dir[1] * t, n.p[2] + dir[2] * t];
        const [nx, ny, nz] = hit.normal;
        const dot = n.v[0] * nx + n.v[1] * ny + n.v[2] * nz;
        n.v = [
          (n.v[0] - 2 * dot * nx) * 0.4,
          (n.v[1] - 2 * dot * ny) * 0.4,
          (n.v[2] - 2 * dot * nz) * 0.4,
        ];
      } else if (hit && hit.toi < 0.05) {
        // Resting on a surface: kill the into-surface velocity so slow
        // grenades don't creep through the floor tick by tick.
        const [nx, ny, nz] = hit.normal;
        const dot = n.v[0] * nx + n.v[1] * ny + n.v[2] * nz;
        if (dot < 0) n.v = [(n.v[0] - dot * nx) * 0.8, (n.v[1] - dot * ny) * 0.8, (n.v[2] - dot * nz) * 0.8];
      } else {
        n.p = [n.p[0] + n.v[0] * TICK_DT, n.p[1] + n.v[1] * TICK_DT, n.p[2] + n.v[2] * TICK_DT];
      }
    }
    if (--n.fuse <= 0) {
      nades.splice(i, 1);
      exploded.push(n);
    }
  }
  return exploded;
}

/**
 * Distance along a ray (origin `o`, normalized `dir`, max `segLen`) to a
 * character capsule centred at `c`, or null. The capsule is the vertical
 * segment c.y ± CHAR_HALF_HEIGHT with radius CHAR_RADIUS.
 */
function segmentCapsuleHit(
  o: [number, number, number],
  dir: [number, number, number],
  segLen: number,
  c: [number, number, number],
): number | null {
  // Sample-based sweep: fine for 45–50 m/s darts (0.75–0.83 m per tick vs a
  // 0.35 m capsule radius) — 8 samples per segment keeps max gap < 0.11 m.
  const STEPS = 8;
  for (let s = 0; s <= STEPS; s++) {
    const t = (segLen * s) / STEPS;
    const px = o[0] + dir[0] * t;
    const py = o[1] + dir[1] * t;
    const pz = o[2] + dir[2] * t;
    // distance to the capsule's vertical core segment
    const cy = Math.max(c[1] - CHAR_HALF_HEIGHT, Math.min(c[1] + CHAR_HALF_HEIGHT, py));
    const d = Math.hypot(px - c[0], py - cy, pz - c[2]);
    if (d <= CHAR_RADIUS) return t;
  }
  return null;
}
