// Voxel world for the sky-island map: chunked block storage shared by the
// server sim, client prediction, and client rendering. 1 m cubes.

export const CHUNK = 16;
export const AIR = 0;
/** Block ids — keep in sync with client textures. */
export const BLOCKS = [
  "air", "grass", "dirt", "stone", "wood", "leaves", "plank",
  "sand", "snow", "ice", "water", "lava", "basalt", "bedrock",
] as const;
export const B_WATER_ID = 10;
export const B_LAVA_ID = 11;
/** Blocks you can walk INTO (no collider): fluids. */
export const FLUID = new Set([AIR, B_WATER_ID, B_LAVA_ID]);
export type BlockId = number;

export interface VoxelBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface VoxelHit {
  /** The solid block that was hit. */
  x: number;
  y: number;
  z: number;
  /** Face normal (unit axis) — the adjacent cell for placement. */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
}

const key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;

export class VoxelWorld {
  chunks = new Map<string, Uint8Array>();

  static chunkOf(x: number, y: number, z: number): string {
    return key(Math.floor(x / CHUNK), Math.floor(y / CHUNK), Math.floor(z / CHUNK));
  }

  get(x: number, y: number, z: number): BlockId {
    const c = this.chunks.get(VoxelWorld.chunkOf(x, y, z));
    if (!c) return AIR;
    const lx = ((x % CHUNK) + CHUNK) % CHUNK;
    const ly = ((y % CHUNK) + CHUNK) % CHUNK;
    const lz = ((z % CHUNK) + CHUNK) % CHUNK;
    return c[(ly * CHUNK + lz) * CHUNK + lx];
  }

  /** Solid for PHYSICS: fluids (water/lava) are walk-through. */
  solid(x: number, y: number, z: number): boolean {
    return !FLUID.has(this.get(x, y, z));
  }

  /** Set a block; returns the touched chunk key (for collider/mesh rebuild). */
  set(x: number, y: number, z: number, b: BlockId): string {
    const k = VoxelWorld.chunkOf(x, y, z);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Uint8Array(CHUNK * CHUNK * CHUNK);
      this.chunks.set(k, c);
    }
    const lx = ((x % CHUNK) + CHUNK) % CHUNK;
    const ly = ((y % CHUNK) + CHUNK) % CHUNK;
    const lz = ((z % CHUNK) + CHUNK) % CHUNK;
    c[(ly * CHUNK + lz) * CHUNK + lx] = b;
    return k;
  }

  /** Amanatides–Woo DDA: first solid block along the ray, or null. */
  raycast(o: [number, number, number], d: [number, number, number], maxDist: number): VoxelHit | null {
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const dx = d[0] / len;
    const dy = d[1] / len;
    const dz = d[2] / len;
    let x = Math.floor(o[0]);
    let y = Math.floor(o[1]);
    let z = Math.floor(o[2]);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    const frac = (v: number) => v - Math.floor(v);
    let tMaxX = dx !== 0 ? (dx > 0 ? (1 - frac(o[0])) : frac(o[0])) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? (1 - frac(o[1])) : frac(o[1])) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? (1 - frac(o[2])) : frac(o[2])) * tDeltaZ : Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let t = 0;
    // starting inside a block counts as an immediate hit (no normal)
    if (this.solid(x, y, z)) return { x, y, z, nx: 0, ny: 0, nz: 0, dist: 0 };
    while (t <= maxDist) {
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY <= tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) return null;
      if (this.solid(x, y, z)) return { x, y, z, nx, ny, nz, dist: t };
    }
    return null;
  }

  /** Greedy-merge one chunk's solid cells into world-space cuboids (physics).
   * Three passes: runs along x → strips along z → slabs along y. */
  chunkCuboids(k: string): VoxelBox[] {
    const c = this.chunks.get(k);
    if (!c) return [];
    const [cx, cy, cz] = k.split(",").map(Number);
    const solid = (lx: number, ly: number, lz: number) => !FLUID.has(c[(ly * CHUNK + lz) * CHUNK + lx]);
    // collect x-runs, then merge identical runs along z, then along y
    type Run = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
    const slabs: Run[] = [];
    for (let ly = 0; ly < CHUNK; ly++) {
      const strips: Run[] = [];
      for (let lz = 0; lz < CHUNK; lz++) {
        let runStart = -1;
        for (let lx = 0; lx <= CHUNK; lx++) {
          const s = lx < CHUNK && solid(lx, ly, lz);
          if (s && runStart < 0) runStart = lx;
          if (!s && runStart >= 0) {
            // try to extend an existing strip from the previous z row
            const prev = strips.find(
              (r) => r.x0 === runStart && r.x1 === lx && r.z1 === lz && r.y0 === ly,
            );
            if (prev) prev.z1 = lz + 1;
            else strips.push({ x0: runStart, x1: lx, z0: lz, z1: lz + 1, y0: ly, y1: ly + 1 });
            runStart = -1;
          }
        }
      }
      // merge strips into the slab list along y
      for (const s of strips) {
        const below = slabs.find(
          (r) => r.x0 === s.x0 && r.x1 === s.x1 && r.z0 === s.z0 && r.z1 === s.z1 && r.y1 === ly,
        );
        if (below) below.y1 = ly + 1;
        else slabs.push(s);
      }
    }
    const bx = cx * CHUNK;
    const by = cy * CHUNK;
    const bz = cz * CHUNK;
    return slabs.map((r) => ({
      x: bx + (r.x0 + r.x1) / 2,
      y: by + (r.y0 + r.y1) / 2,
      z: bz + (r.z0 + r.z1) / 2,
      hx: (r.x1 - r.x0) / 2,
      hy: (r.y1 - r.y0) / 2,
      hz: (r.z1 - r.z0) / 2,
    }));
  }

  /** RLE over each chunk: "cx,cy,cz|run.type run.type ...;..." (base36). */
  serialize(): string {
    const parts: string[] = [];
    for (const [k, c] of this.chunks) {
      const runs: string[] = [];
      let cur = c[0];
      let n = 1;
      for (let i = 1; i <= c.length; i++) {
        const v = i < c.length ? c[i] : -1;
        if (v === cur) n++;
        else {
          runs.push(`${n.toString(36)}.${cur.toString(36)}`);
          cur = v;
          n = 1;
        }
      }
      parts.push(`${k}|${runs.join(" ")}`);
    }
    return parts.join(";");
  }

  static deserialize(s: string): VoxelWorld {
    const w = new VoxelWorld();
    if (!s) return w;
    for (const part of s.split(";")) {
      const [k, body] = part.split("|");
      const c = new Uint8Array(CHUNK * CHUNK * CHUNK);
      let i = 0;
      for (const run of body.split(" ")) {
        const [nS, vS] = run.split(".");
        const n = parseInt(nS, 36);
        const v = parseInt(vS, 36);
        c.fill(v, i, i + n);
        i += n;
      }
      w.chunks.set(k, c);
    }
    return w;
  }
}
