// Chunk renderer for the v5 sky-island voxel map. One InstancedMesh per
// chunk per block type over a single shared unit BoxGeometry; procedural
// 16x16 Minecraft-look canvas textures (NearestFilter), one material per
// block type, created once and shared. Static: nothing happens per frame —
// call rebuildChunk(key) after VoxelWorld.set() to refresh a chunk.
//
// Dependencies: three + shared/src/voxel only (works in game and tool pages).

import * as THREE from "three";
import { AIR, BLOCKS, CHUNK, VoxelWorld } from "../../shared/src/voxel";

// ---------------------------------------------------------------------------
// Shared resources (never disposed per chunk)

let sharedGeometry: THREE.BoxGeometry | null = null;
let sharedMaterials: (THREE.MeshLambertMaterial | null)[] | null = null;

function getGeometry(): THREE.BoxGeometry {
  if (!sharedGeometry) sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
  return sharedGeometry;
}

/** Deterministic PRNG so textures look identical every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEX_SIZE = 16;

function makeTexture(paint: (px: (x: number, y: number, color: string) => void, rand: () => number) => void, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  paint(px, mulberry32(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function pick<T>(rand: () => number, options: T[]): T {
  return options[Math.floor(rand() * options.length)];
}

/** Speckled noise fill from a weighted palette. */
function noiseFill(palette: string[]) {
  return (px: (x: number, y: number, c: string) => void, rand: () => number) => {
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) px(x, y, pick(rand, palette));
    }
  };
}

function buildMaterials(): (THREE.MeshLambertMaterial | null)[] {
  const textures: Record<string, THREE.CanvasTexture> = {
    // mossy green: two greens + a few brown flecks (cube shares one material)
    grass: makeTexture((px, rand) => {
      noiseFill(["#4a8f3c", "#4a8f3c", "#5aa348", "#5aa348", "#3f7d33"])(px, rand);
      for (let i = 0; i < 6; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#6b5433");
      }
    }, 101),
    dirt: makeTexture(noiseFill(["#7a5a3a", "#6b4e32", "#84633f", "#5e442c"]), 102),
    stone: makeTexture(noiseFill(["#8a8a8a", "#7d7d7d", "#949494", "#707070"]), 103),
    // vertical brown grain stripes
    wood: makeTexture((px, rand) => {
      for (let x = 0; x < TEX_SIZE; x++) {
        const base = x % 4 === 0 ? "#4e3820" : x % 2 === 0 ? "#6b4e2a" : "#5f4525";
        for (let y = 0; y < TEX_SIZE; y++) {
          px(x, y, rand() < 0.12 ? "#57401f" : base);
        }
      }
    }, 104),
    // two greens with a few darker "holes" (kept opaque)
    leaves: makeTexture((px, rand) => {
      noiseFill(["#2f6b27", "#3c7d31", "#2f6b27", "#3c7d31"])(px, rand);
      for (let i = 0; i < 10; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#1d4519");
      }
    }, 105),
    // horizontal tan boards with darker seams
    plank: makeTexture((px, rand) => {
      for (let y = 0; y < TEX_SIZE; y++) {
        const seam = y % 4 === 3;
        for (let x = 0; x < TEX_SIZE; x++) {
          const base = seam ? "#8a6f42" : y % 8 < 4 ? "#c2a066" : "#b8955c";
          px(x, y, !seam && rand() < 0.08 ? "#a88752" : base);
        }
      }
    }, 106),
  };
  return BLOCKS.map((name) => {
    if (name === "air") return null;
    return new THREE.MeshLambertMaterial({ map: textures[name] });
  });
}

function getMaterials(): (THREE.MeshLambertMaterial | null)[] {
  if (!sharedMaterials) sharedMaterials = buildMaterials();
  return sharedMaterials;
}

// ---------------------------------------------------------------------------

export class VoxelRenderer {
  private meshes = new Map<string, THREE.InstancedMesh[]>();

  constructor(
    private scene: THREE.Scene,
    private world: VoxelWorld,
  ) {}

  /** Build meshes for every chunk in the world. */
  buildAll(): void {
    for (const key of this.world.chunks.keys()) this.rebuildChunk(key);
  }

  /** Dispose and rebuild only this chunk's meshes. */
  rebuildChunk(key: string): void {
    this.removeChunk(key);
    const chunk = this.world.chunks.get(key);
    if (!chunk) return;
    const [cx, cy, cz] = key.split(",").map(Number);
    const bx = cx * CHUNK;
    const by = cy * CHUNK;
    const bz = cz * CHUNK;

    // gather visible cells per block type (skip fully hidden cells; neighbor
    // checks go through VoxelWorld.get so chunk borders are handled)
    const cells = new Map<number, number[]>(); // type -> [x,y,z,...] world coords
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const b = chunk[(ly * CHUNK + lz) * CHUNK + lx];
          if (b === AIR) continue;
          const x = bx + lx;
          const y = by + ly;
          const z = bz + lz;
          const exposed =
            !this.world.solid(x + 1, y, z) ||
            !this.world.solid(x - 1, y, z) ||
            !this.world.solid(x, y + 1, z) ||
            !this.world.solid(x, y - 1, z) ||
            !this.world.solid(x, y, z + 1) ||
            !this.world.solid(x, y, z - 1);
          if (!exposed) continue;
          let list = cells.get(b);
          if (!list) {
            list = [];
            cells.set(b, list);
          }
          list.push(x, y, z);
        }
      }
    }

    if (cells.size === 0) return;
    const geometry = getGeometry();
    const materials = getMaterials();
    const m = new THREE.Matrix4();
    const built: THREE.InstancedMesh[] = [];
    for (const [type, coords] of cells) {
      const material = materials[type];
      if (!material) continue;
      const count = coords.length / 3;
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      for (let i = 0; i < count; i++) {
        m.makeTranslation(coords[i * 3] + 0.5, coords[i * 3 + 1] + 0.5, coords[i * 3 + 2] + 0.5);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      built.push(mesh);
    }
    if (built.length > 0) this.meshes.set(key, built);
  }

  /** Remove all meshes from the scene and free per-chunk instance buffers.
   * The shared geometry/materials stay alive (module-level, reused). */
  dispose(): void {
    for (const key of [...this.meshes.keys()]) this.removeChunk(key);
  }

  private removeChunk(key: string): void {
    const list = this.meshes.get(key);
    if (!list) return;
    for (const mesh of list) {
      this.scene.remove(mesh);
      mesh.dispose(); // frees the instance buffer; geometry/material are shared
    }
    this.meshes.delete(key);
  }
}
