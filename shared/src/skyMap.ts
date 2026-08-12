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
export const PLANET_R = 22;
/** Flung farther than this from the core = hazard respawn. */
export const PLANET_KILL_DIST = 160;
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

export function buildSkyWorld(seed = SKY_SEED): SkyWorldData {
  const world = new VoxelWorld();
  const rng = mulberry32(seed);
  const R = PLANET_R;

  // ---- The cube: grass shell, dirt band, stone core -----------------------
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

  // ---- Trees: a few per face, growing OUTWARD along the face normal -------
  for (const f of FACES) {
    for (let i = 0; i < 5; i++) {
      const u = Math.floor((rng() * 2 - 1) * (R - 6));
      const v = Math.floor((rng() * 2 - 1) * (R - 6));
      const foot = faceFoot(f, u, v);
      const bx = Math.floor(foot[0] + f.n[0] * 0.5 - (f.n[0] !== 0 ? 0.5 : 0));
      const by = Math.floor(foot[1] + f.n[1] * 0.5 - (f.n[1] !== 0 ? 0.5 : 0));
      const bz = Math.floor(foot[2] + f.n[2] * 0.5 - (f.n[2] !== 0 ? 0.5 : 0));
      const h = 3 + Math.floor(rng() * 2);
      for (let t = 0; t < h; t++)
        world.set(bx + f.n[0] * t, by + f.n[1] * t, bz + f.n[2] * t, B_WOOD);
      for (let da = -1; da <= 1; da++)
        for (let db = -1; db <= 1; db++)
          for (let dn = 0; dn <= 1; dn++) {
            if (da === 0 && db === 0 && dn === 0) continue;
            world.set(
              bx + f.n[0] * (h + dn) + f.a[0] * da + f.b[0] * db,
              by + f.n[1] * (h + dn) + f.a[1] * da + f.b[1] * db,
              bz + f.n[2] * (h + dn) + f.a[2] * da + f.b[2] * db,
              B_LEAVES,
            );
          }
      world.set(bx + f.n[0] * (h + 2), by + f.n[1] * (h + 2), bz + f.n[2] * (h + 2), B_LEAVES);
    }
  }

  // ---- Spawns: a ring of clear points on EVERY face -----------------------
  const spawns: SkySpawn[] = [];
  const clearFoot = (f: (typeof FACES)[number], u: number, v: number): V3 | null => {
    // reject if a tree occupies the two cells above the surface
    const foot = faceFoot(f, u, v);
    for (let out = 0; out < 2; out++) {
      const px = Math.floor(foot[0] + f.n[0] * (out + 0.5) + (f.n[0] === 0 ? 0 : -0.0));
      const py = Math.floor(foot[1] + f.n[1] * (out + 0.5));
      const pz = Math.floor(foot[2] + f.n[2] * (out + 0.5));
      if (world.solid(px, py, pz)) return null;
    }
    return foot;
  };
  for (const f of FACES) {
    const offs = [
      [0, 0], [9, 9], [-9, 9], [9, -9], [-9, -9], [0, 13], [13, 0],
    ];
    let added = 0;
    for (const [u, v] of offs) {
      if (added >= 3) break;
      const foot = clearFoot(f, u, v);
      if (!foot) continue;
      if (spawns.some((s) => Math.hypot(s.x - foot[0], s.y - foot[1], s.z - foot[2]) < 10)) continue;
      spawns.push({ x: foot[0], y: foot[1], z: foot[2], rotY: rng() * Math.PI * 2 });
      added++;
    }
  }

  // ---- Crates: items spread over all faces --------------------------------
  const items = ["rapid", "heavy", "sniper", "longshot", "grenade", "ammo", "health"];
  const crateSpawns: SkyCrate[] = [];
  let ci = 0;
  for (const f of FACES) {
    for (const [u, v] of [[5, -5], [-6, 6], [12, 4]]) {
      const foot = clearFoot(f, u, v);
      if (!foot) continue;
      if (crateSpawns.some((c) => Math.hypot(c.x - foot[0], c.y - foot[1], c.z - foot[2]) < 8)) continue;
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
