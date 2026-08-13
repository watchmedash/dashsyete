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

function makeTexture(
  paint: (px: (x: number, y: number, color: string) => void, rand: () => number) => void,
  seed: number,
  frame = true,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;
  const px = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  paint(px, mulberry32(seed));
  // EDGE FRAME: a subtly darkened 1-texel border (top kept lighter) makes
  // every block read as a block instead of the terrain smearing into one
  // carpet — the core of the voxel look. Fluids skip it (water/lava tile).
  if (frame) {
    const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    const shade = (x: number, y: number, f: number) => {
      const i = (y * TEX_SIZE + x) * 4;
      img.data[i] *= f;
      img.data[i + 1] *= f;
      img.data[i + 2] *= f;
    };
    for (let i = 0; i < TEX_SIZE; i++) {
      shade(i, 0, 0.92);
      shade(i, TEX_SIZE - 1, 0.78);
      shade(0, i, 0.85);
      shade(TEX_SIZE - 1, i, 0.85);
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  // Mipmapped min filter: NearestFilter at distance was a moiré/shimmer
  // mess across the whole far field. Close-up stays crisp (mag = nearest).
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
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
    sand: makeTexture(noiseFill(["#dcc98a", "#d3bf7e", "#e4d296", "#c9b573"]), 107),
    snow: makeTexture((px, rand) => {
      noiseFill(["#f4f8fb", "#eaf0f6", "#f9fcff"])(px, rand);
      for (let i = 0; i < 5; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#d8e2ec");
      }
    }, 108),
    ice: makeTexture(noiseFill(["#a8d4e8", "#98c8e0", "#b8dff0", "#8dbeda"]), 109),
    water: makeTexture(noiseFill(["#3a70b8", "#3468ac", "#4179c2", "#2e5f9e"]), 110, false),
    lava: makeTexture((px, rand) => {
      noiseFill(["#e85d1a", "#f2701f", "#d94e12", "#f98a2b"])(px, rand);
      for (let i = 0; i < 8; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#ffd54a");
      }
    }, 111, false),
    // volcanic ground: lifted mid-grays + warm ember flecks so the dark face
    // reads with contrast instead of a black mush
    basalt: makeTexture((px, rand) => {
      noiseFill(["#5a5a64", "#4c4c55", "#67676f", "#42424a"])(px, rand);
      for (let i = 0; i < 4; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#b85a24");
      }
    }, 112),
    bedrock: makeTexture(noiseFill(["#232327", "#1c1c20", "#2b2b30", "#161619"]), 113),
    // forest floor: deep mossy green, clearly darker than grassland
    darkgrass: makeTexture((px, rand) => {
      noiseFill(["#2c5f26", "#255420", "#33682b", "#1f4a1b"])(px, rand);
      for (let i = 0; i < 5; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#173d14");
      }
    }, 114),
    // the PLACEABLE block: riveted composite panel (matches the held model)
    build: makeTexture((px, rand) => {
      noiseFill(["#b4b9c2", "#a9aeb8", "#bcc1ca"])(px, rand);
      for (let i = 0; i < TEX_SIZE; i++) {
        px(i, 0, "#878d98");
        px(i, TEX_SIZE - 1, "#878d98");
        px(0, i, "#878d98");
        px(TEX_SIZE - 1, i, "#878d98");
        if (rand() < 0.15) px(Math.floor(rand() * 12) + 2, Math.floor(rand() * 12) + 2, "#cdd2da");
      }
      for (const [rx, ry] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(rx, ry, "#6b717c");
      // center cross-brace
      for (let i = 4; i < 12; i++) {
        px(i, 7, "#989ea9");
        px(i, 8, "#989ea9");
        px(7, i, "#989ea9");
        px(8, i, "#989ea9");
      }
    }, 115),
    // dense forest canopy: near-black green
    darkleaves: makeTexture((px, rand) => {
      noiseFill(["#1c4517", "#153a12", "#22511c", "#0f300d"])(px, rand);
      for (let i = 0; i < 8; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#092407");
      }
    }, 116),
    // snow-capped spruce canopy: frosted green under heavy white
    snowleaves: makeTexture((px, rand) => {
      noiseFill(["#3c6b34", "#33602c", "#457540"])(px, rand);
      for (let y = 0; y < TEX_SIZE; y++) {
        for (let x = 0; x < TEX_SIZE; x++) {
          if (rand() < (y < 5 ? 0.85 : 0.3)) px(x, y, rand() < 0.5 ? "#eef4f8" : "#dfe8ef");
        }
      }
    }, 117),
    // POWERUP: deep violet with a gold core + cyan sparks (rendered unlit
    // below so it glows on every face — unmissable loot)
    power: makeTexture((px, rand) => {
      noiseFill(["#2c1a4e", "#241542", "#341f5a"])(px, rand);
      for (let i = 4; i < 12; i++) {
        px(i, 7, "#f2b830");
        px(i, 8, "#f2b830");
        px(7, i, "#f2b830");
        px(8, i, "#f2b830");
      }
      for (const [sx, sy] of [[6, 6], [9, 9], [6, 9], [9, 6]]) px(sx, sy, "#ffd980");
      for (let i = 0; i < 7; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#57e6ff");
      }
    }, 119),
    // ribbed cactus green with pale spines
    cactus: makeTexture((px, rand) => {
      for (let x = 0; x < TEX_SIZE; x++) {
        const rib = x % 4 === 0;
        for (let y = 0; y < TEX_SIZE; y++) {
          px(x, y, rib ? "#2e6b28" : rand() < 0.15 ? "#4c9a44" : "#3f8a37");
        }
      }
      for (let i = 0; i < 6; i++) {
        px(Math.floor(rand() * TEX_SIZE), Math.floor(rand() * TEX_SIZE), "#e8f0d8");
      }
    }, 118),
  };
  return BLOCKS.map((name) => {
    if (name === "air") return null;
    if (name === "water")
      // near-opaque from OUTSIDE (underwater is a hiding spot); from INSIDE
      // the top surface is a backface (culled) so submerged players see out
      return new THREE.MeshLambertMaterial({ map: textures.water, transparent: true, opacity: 0.94 });
    if (name === "lava" || name === "power")
      // unlit = it glows, day or night, on any face
      return new THREE.MeshBasicMaterial({ map: textures[name] }) as unknown as THREE.MeshLambertMaterial;
    return new THREE.MeshLambertMaterial({ map: textures[name] });
  });
}

function getMaterials(): (THREE.MeshLambertMaterial | null)[] {
  if (!sharedMaterials) sharedMaterials = buildMaterials();
  return sharedMaterials;
}

/** The shared material for one block id (held-block viewmodel etc.). */
export function blockMaterial(id: number): THREE.MeshLambertMaterial | null {
  return getMaterials()[id] ?? null;
}

/** Minecraft-style mining crack decal stages (transparent, overlay a block).
 * Stage 0 = first hairlines, last stage = shattered. */
export function crackTextures(stages = 4): THREE.CanvasTexture[] {
  const out: THREE.CanvasTexture[] = [];
  for (let s = 0; s < stages; s++) {
    const canvas = document.createElement("canvas");
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext("2d")!;
    const rand = mulberry32(900 + s);
    ctx.strokeStyle = "rgba(15,15,15,0.9)";
    ctx.lineWidth = 1;
    const cracks = 2 + s * 2;
    for (let c = 0; c < cracks; c++) {
      let x = TEX_SIZE / 2 + (rand() * 6 - 3);
      let y = TEX_SIZE / 2 + (rand() * 6 - 3);
      const ang = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let seg = 0; seg < 3 + s; seg++) {
        x += Math.cos(ang + (rand() - 0.5) * 1.6) * (2 + rand() * 3);
        y += Math.sin(ang + (rand() - 0.5) * 1.6) * (2 + rand() * 3);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    out.push(tex);
  }
  return out;
}

// ---------------------------------------------------------------------------

export class VoxelRenderer {
  private meshes = new Map<string, THREE.InstancedMesh[]>();
  private centers = new Map<string, [number, number, number]>();

  /** Hide chunks on the FAR SIDE of the planet — they're fully occluded by
   * the planet itself but were still drawn (~half of all draw calls). 185 m
   * comfortably exceeds the farthest visible corner-to-corner sightline. */
  cull(camPos: THREE.Vector3): void {
    for (const [key, meshes] of this.meshes) {
      const c = this.centers.get(key);
      if (!c) continue;
      const dx = c[0] - camPos.x;
      const dy = c[1] - camPos.y;
      const dz = c[2] - camPos.z;
      const vis = dx * dx + dy * dy + dz * dz < 185 * 185;
      if (meshes[0] && meshes[0].visible !== vis) for (const m of meshes) m.visible = vis;
    }
  }

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
    this.centers.set(key, [bx + CHUNK / 2, by + CHUNK / 2, bz + CHUNK / 2]);

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
          // a neighbor hides this cell if it's solid OR the SAME block id —
          // the id check merges liquid bodies: without it every internal
          // water-water face rendered and being submerged was a wall of
          // stacked textures instead of clear water
          const covers = (nx: number, ny: number, nz: number) =>
            this.world.solid(nx, ny, nz) || this.world.get(nx, ny, nz) === b;
          const exposed =
            !covers(x + 1, y, z) ||
            !covers(x - 1, y, z) ||
            !covers(x, y + 1, z) ||
            !covers(x, y - 1, z) ||
            !covers(x, y, z + 1) ||
            !covers(x, y, z - 1);
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
