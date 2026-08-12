// v5 sky-island world: seeded, deterministic generation — the server builds
// it once and streams the RLE to clients, but the same seed produces the
// same world anywhere (tests, tools).
import { VoxelWorld } from "./voxel";

export const B_GRASS = 1;
export const B_DIRT = 2;
export const B_STONE = 3;
export const B_WOOD = 4;
export const B_LEAVES = 5;
export const B_PLANK = 6;

/** Below the lowest island underside: falling here = void respawn. */
export const SKY_KILL_Y = 4;
export const SKY_SEED = 20260812;

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

interface Island {
  cx: number;
  cz: number;
  topY: number;
  r: number;
}

export const ISLANDS: Island[] = [
  { cx: 0, cz: 0, topY: 20, r: 30 }, // main
  { cx: 52, cz: 10, topY: 26, r: 13 },
  { cx: -46, cz: -32, topY: 30, r: 12 },
  { cx: 8, cz: -54, topY: 24, r: 13 },
];

export function buildSkyWorld(seed = SKY_SEED): SkyWorldData {
  const world = new VoxelWorld();
  const noise = makeNoise(seed);
  const rng = mulberry32(seed);

  // ---- Islands: noisy disc, grass top, dirt band, tapering stone underside
  for (const isl of ISLANDS) {
    for (let x = Math.floor(isl.cx - isl.r); x <= isl.cx + isl.r; x++) {
      for (let z = Math.floor(isl.cz - isl.r); z <= isl.cz + isl.r; z++) {
        const d = Math.hypot(x - isl.cx, z - isl.cz);
        const wobble = 0.8 + 0.35 * noise(x * 0.15, z * 0.15);
        if (d > isl.r * wobble) continue;
        const edge = 1 - d / (isl.r * wobble); // 1 center -> 0 rim
        const bump = Math.floor(noise(x * 0.09 + 100, z * 0.09) * 3 * Math.min(1, edge * 3));
        const top = isl.topY + bump;
        const depth = Math.max(1, Math.round(edge * 9 + noise(x * 0.2, z * 0.2 + 50) * 2));
        world.set(x, top, z, B_GRASS);
        for (let y = top - 1; y > top - Math.min(3, depth); y--) world.set(x, y, z, B_DIRT);
        for (let y = top - 3; y > top - depth; y--) world.set(x, y, z, B_STONE);
      }
    }
  }

  // ---- Trees on grass (deterministic placement hash)
  for (const isl of ISLANDS) {
    const count = Math.round(isl.r / 3);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const rr = rng() * isl.r * 0.6;
      const x = Math.round(isl.cx + Math.cos(a) * rr);
      const z = Math.round(isl.cz + Math.sin(a) * rr);
      // find the grass surface
      let y = isl.topY + 4;
      while (y > isl.topY - 2 && !world.solid(x, y, z)) y--;
      if (world.get(x, y, z) !== B_GRASS) continue;
      const h = 3 + Math.floor(rng() * 2);
      for (let t = 1; t <= h; t++) world.set(x, y + t, z, B_WOOD);
      for (let lx = -1; lx <= 1; lx++)
        for (let lz = -1; lz <= 1; lz++)
          for (let ly = 0; ly <= 1; ly++)
            if (!(lx === 0 && lz === 0 && ly === 0)) world.set(x + lx, y + h + ly, z + lz, B_LEAVES);
      world.set(x, y + h + 2, z, B_LEAVES);
    }
  }

  // ---- Plank bridges: main island rim -> each satellite rim, 3 wide with rails
  for (let i = 1; i < ISLANDS.length; i++) {
    const a = ISLANDS[0];
    const b = ISLANDS[i];
    const dx = b.cx - a.cx;
    const dz = b.cz - a.cz;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz; // perpendicular
    const pz = ux;
    const start = a.r * 0.62; // begin inside the main island rim
    const end = len - b.r * 0.62;
    for (let s = start; s <= end; s += 0.5) {
      const f = (s - start) / (end - start);
      const y = Math.round(a.topY + (b.topY - a.topY) * f);
      const x = a.cx + ux * s;
      const z = a.cz + uz * s;
      for (let wOff = -1; wOff <= 1; wOff++) {
        world.set(Math.round(x + px * wOff), y, Math.round(z + pz * wOff), B_PLANK);
      }
      // rails every few meters
      if (Math.round(s * 2) % 8 === 0) {
        world.set(Math.round(x + px * 2), y + 1, Math.round(z + pz * 2), B_WOOD);
        world.set(Math.round(x - px * 2), y + 1, Math.round(z - pz * 2), B_WOOD);
      }
    }
  }

  // ---- Spawns: flat grass points, spread out, 2 air blocks above
  const spawns: SkySpawn[] = [];
  const clearAt = (x: number, z: number): number | null => {
    for (let y = 40; y > 8; y--) {
      if (!world.solid(x, y, z)) continue;
      if (world.get(x, y, z) !== B_GRASS && world.get(x, y, z) !== B_PLANK) return null;
      if (world.solid(x, y + 1, z) || world.solid(x, y + 2, z)) return null;
      return y + 1; // stand ON the surface
    }
    return null;
  };
  const wantSpawn = (x0: number, z0: number) => {
    // candidates can land on a tree or off the noisy rim — search a 5×5 patch
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = x0 + dx;
        const z = z0 + dz;
        const y = clearAt(x, z);
        if (y === null) continue;
        if (spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
        spawns.push({ x: x + 0.5, y, z: z + 0.5, rotY: Math.atan2(-x, -z) });
        return;
      }
    }
  };
  for (const isl of ISLANDS) {
    for (const rf of [0.25, 0.45, 0.6, 0.72]) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2 + rf;
        wantSpawn(
          Math.round(isl.cx + Math.cos(ang) * isl.r * rf),
          Math.round(isl.cz + Math.sin(ang) * isl.r * rf),
        );
      }
    }
    wantSpawn(isl.cx, isl.cz);
  }

  // ---- Crates: one per satellite center-ish + a ring on the main island
  const items = ["rapid", "heavy", "sniper", "longshot", "grenade", "ammo", "health"];
  const crateSpawns: SkyCrate[] = [];
  let ci = 0;
  const wantCrate = (x: number, z: number) => {
    const y = clearAt(x, z);
    if (y === null) return;
    if (crateSpawns.some((c) => Math.hypot(c.x - x, c.z - z) < 10)) return;
    crateSpawns.push({ x: x + 0.5, y, z: z + 0.5, weapon: items[ci++ % items.length] });
  };
  for (const isl of ISLANDS) {
    wantCrate(isl.cx + 2, isl.cz + 2);
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2 + 0.4;
      wantCrate(Math.round(isl.cx + Math.cos(ang) * isl.r * 0.6), Math.round(isl.cz + Math.sin(ang) * isl.r * 0.6));
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
