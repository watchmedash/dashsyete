// v5 CUBE PLANET: a square voxel world floating in the sky. All six faces
// are walkable — gravity pulls toward whichever face you're on (see
// gravity.ts). Seeded + deterministic: server and clients generate the same
// base world; live edits arrive as deltas.
import { VoxelWorld } from "./voxel";
import { faceUp, type V3 } from "./gravity";
import type { CityMap } from "./cityMap";

export const B_GRASS = 1;
export const B_DIRT = 2;
export const B_STONE = 3;
export const B_WOOD = 4;
export const B_LEAVES = 5;
export const B_PLANK = 6;

export const SKY_SEED = 20260812;
/** Half-size of the cube: blocks span [-R, R-1] on every axis. */
export const PLANET_R = 40;
/** Tallest mountain above a face's base shell, in blocks. */
export const PEAK_H = 9;
/** Flung farther than this from the core = hazard respawn. */
export const PLANET_KILL_DIST = 220;
/** Legacy flat-map kill floor (unused on the planet, kept for city maps). */
export const SKY_KILL_Y = 4;
/** Building blocks in hand at (re)spawn — mining earns more. */
export const START_BLOCKS = 30;
/** Max reach for breaking/placing blocks, meters from the eye. */
export const BUILD_REACH = 6;

export interface SkySpawn {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export interface SkyCrate {
  x: number;
  y: number;
  z: number;
  weapon: string;
}

export interface SkyWorldData {
  world: VoxelWorld;
  spawns: SkySpawn[];
  crateSpawns: SkyCrate[];
  shipPath: { x: number; z: number }[];
}

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The six faces: outward normal + two in-face tangent axes. */
export const FACES: { n: V3; a: V3; b: V3 }[] = [
  { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
  { n: [-1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], a: [1, 0, 0], b: [0, 1, 0] },
];

/** Face-surface FOOT position for in-face coords (u,v) on face f: the point
 * sits ON the surface plane, centered in the (u,v) cell. */
function faceFoot(f: { n: V3; a: V3; b: V3 }, u: number, v: number): V3 {
  const s = (i: number) => f.n[i] * PLANET_R + f.a[i] * (u + 0.5) + f.b[i] * (v + 0.5);
  // shift by -0.5 along the normal axis... the surface plane is at ±R exactly:
  // blocks span [-R, R-1] so +face top plane = +R, -face bottom plane = -R.
  const p: V3 = [s(0), s(1), s(2)];
  for (let i = 0; i < 3; i++) if (f.n[i] !== 0) p[i] = f.n[i] > 0 ? PLANET_R : -PLANET_R;
  return p;
}

/** Smooth 2D value noise on an integer lattice (bilinear). */
function makeNoise(seed: number): (x: number, z: number) => number {
  const lattice = (ix: number, iz: number) => {
    const h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + seed;
    const v = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}

/** Integer block coordinate for face f at in-face (u,v), k blocks OUT from
 * the shell surface (k=0 = the outermost shell block itself). */
function faceCell(f: { n: V3; a: V3; b: V3 }, u: number, v: number, k: number): V3 {
  const R = PLANET_R;
  const out = (n: number) => (n > 0 ? R - 1 + k : -R - k);
  return [
    f.n[0] !== 0 ? out(f.n[0]) : f.a[0] * u + f.b[0] * v,
    f.n[1] !== 0 ? out(f.n[1]) : f.a[1] * u + f.b[1] * v,
    f.n[2] !== 0 ? out(f.n[2]) : f.a[2] * u + f.b[2] * v,
  ];
}

export function buildSkyWorld(seed = SKY_SEED): SkyWorldData {
  const world = new VoxelWorld();
  const rng = mulberry32(seed);
  const R = PLANET_R;

  // ---- The base cube: grass shell, dirt band, stone core ------------------
  for (let x = -R; x < R; x++) {
    for (let y = -R; y < R; y++) {
      for (let z = -R; z < R; z++) {
        // chebyshev "depth" from the nearest face, in whole blocks
        const depth = R - 1 - Math.max(
          Math.max(x, -1 - x),
          Math.max(Math.max(y, -1 - y), Math.max(z, -1 - z)),
        );
        world.set(x, y, z, depth === 0 ? B_GRASS : depth <= 2 ? B_DIRT : B_STONE);
      }
    }
  }

  // ---- Mountains + ridges: a ridged-noise heightfield per face ------------
  // ridged = 1-|2n-1| gives sharp crests; squaring keeps plains between them.
  const heightAt = new Map<string, number>(); // "faceIdx|u|v" -> blocks above shell
  FACES.forEach((f, fi) => {
    const n1 = makeNoise(seed + fi * 137);
    const n2 = makeNoise(seed + fi * 137 + 71);
    for (let u = -R; u < R; u++) {
      for (let v = -R; v < R; v++) {
        const ridge = 1 - Math.abs(2 * n1(u * 0.045, v * 0.045) - 1);
        const detail = n2(u * 0.15, v * 0.15);
        // fade the terrain near face borders so edges stay clean 90° seams
        const border = Math.min(R - 1 - Math.abs(u), R - 1 - Math.abs(v));
        const fade = Math.min(1, border / 6);
        const h = Math.floor((ridge * ridge * PEAK_H + detail * 2) * fade);
        if (h <= 0) continue;
        heightAt.set(`${fi}|${u}|${v}`, h);
        for (let k = 1; k <= h; k++) {
          const c = faceCell(f, u, v, k);
          world.set(c[0], c[1], c[2], k === h ? B_GRASS : h - k <= 1 ? B_DIRT : B_STONE);
        }
      }
    }
  });
  const surfaceK = (fi: number, u: number, v: number) => heightAt.get(`${fi}|${u}|${v}`) ?? 0;

  // ---- Trees: on the terrain surface, growing OUTWARD ---------------------
  FACES.forEach((f, fi) => {
    for (let i = 0; i < 14; i++) {
      const u = Math.floor((rng() * 2 - 1) * (R - 8));
      const v = Math.floor((rng() * 2 - 1) * (R - 8));
      const k0 = surfaceK(fi, u, v) + 1; // first air cell above the surface
      const base = faceCell(f, u, v, k0);
      if (world.solid(base[0], base[1], base[2])) continue;
      const h = 3 + Math.floor(rng() * 2);
      for (let t = 0; t < h; t++)
        world.set(base[0] + f.n[0] * t, base[1] + f.n[1] * t, base[2] + f.n[2] * t, B_WOOD);
      for (let da = -1; da <= 1; da++)
        for (let db = -1; db <= 1; db++)
          for (let dn = 0; dn <= 1; dn++) {
            if (da === 0 && db === 0 && dn === 0) continue;
            world.set(
              base[0] + f.n[0] * (h + dn) + f.a[0] * da + f.b[0] * db,
              base[1] + f.n[1] * (h + dn) + f.a[1] * da + f.b[1] * db,
              base[2] + f.n[2] * (h + dn) + f.a[2] * da + f.b[2] * db,
              B_LEAVES,
            );
          }
      world.set(
        base[0] + f.n[0] * (h + 2),
        base[1] + f.n[1] * (h + 2),
        base[2] + f.n[2] * (h + 2),
        B_LEAVES,
      );
    }
  });

  // ---- Spawns: clear points on EVERY face (on top of the terrain) ---------
  const spawns: SkySpawn[] = [];
  const clearFoot = (f: (typeof FACES)[number], u: number, v: number): V3 | null => {
    const fi = FACES.indexOf(f);
    const k = surfaceK(fi, u, v);
    // the surface block must be walkable and the two cells above it clear
    const top = faceCell(f, u, v, k);
    if (world.get(top[0], top[1], top[2]) !== B_GRASS) return null;
    for (let out = 1; out <= 2; out++) {
      const c = faceCell(f, u, v, k + out);
      if (world.solid(c[0], c[1], c[2])) return null;
    }
    // FOOT: on the surface plane, k+1 blocks out from the shell plane
    const plane = faceFoot(f, u, v);
    return [plane[0] + f.n[0] * k, plane[1] + f.n[1] * k, plane[2] + f.n[2] * k];
  };
  const findNear = (f: (typeof FACES)[number], u0: number, v0: number): V3 | null => {
    for (let du = -3; du <= 3; du++)
      for (let dv = -3; dv <= 3; dv++) {
        const foot = clearFoot(f, u0 + du, v0 + dv);
        if (foot) return foot;
      }
    return null;
  };
  for (const f of FACES) {
    const offs = [
      [0, 0], [18, 18], [-18, 18], [18, -18], [-18, -18], [0, 26], [26, 0], [-26, 0], [0, -26],
    ];
    let added = 0;
    for (const [u, v] of offs) {
      if (added >= 4) break;
      const foot = findNear(f, u, v);
      if (!foot) continue;
      if (spawns.some((s) => Math.hypot(s.x - foot[0], s.y - foot[1], s.z - foot[2]) < 16)) continue;
      spawns.push({ x: foot[0], y: foot[1], z: foot[2], rotY: rng() * Math.PI * 2 });
      added++;
    }
  }

  // ---- Crates: items spread over all faces --------------------------------
  const items = ["rapid", "heavy", "sniper", "longshot", "grenade", "ammo", "health"];
  const crateSpawns: SkyCrate[] = [];
  let ci = 0;
  for (const f of FACES) {
    for (const [u, v] of [[10, -10], [-12, 12], [24, 8], [-8, -24]]) {
      const foot = findNear(f, u, v);
      if (!foot) continue;
      if (crateSpawns.some((c) => Math.hypot(c.x - foot[0], c.y - foot[1], c.z - foot[2]) < 12)) continue;
      crateSpawns.push({ x: foot[0], y: foot[1], z: foot[2], weapon: items[ci++ % items.length] });
    }
  }

  const shipPath = [
    { x: 140, z: -120 },
    { x: -140, z: -120 },
    { x: -140, z: -170 },
    { x: 140, z: -170 },
  ];

  return { world, spawns, crateSpawns, shipPath };
}

/** The planet wrapped in the CityMap shape so every map-driven system keeps
 * working. No tiles, no ground slab, terrain via `vox` (planet gravity). */
export function buildSkyCityMap(seed = SKY_SEED): CityMap {
  const sky = buildSkyWorld(seed);
  return {
    size: 0,
    tiles: [],
    colliders: [],
    grounds: [],
    waterY: -400,
    spawns: sky.spawns,
    crateSpawns: sky.crateSpawns,
    parkedCars: [],
    greens: [],
    shipPath: sky.shipPath,
    props: [],
    floors: [],
    vox: { seed, planet: true },
  };
}

/** True while `p` still counts as "on" the planet (not flung into space). */
export function onPlanet(p: V3): boolean {
  return Math.hypot(p[0], p[1], p[2]) < PLANET_KILL_DIST;
}

// re-export for callers that need per-position gravity (projectiles, aim)
export { faceUp };
