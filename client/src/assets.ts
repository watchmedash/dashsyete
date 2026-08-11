import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const loader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const cache = new Map<string, Promise<GLTF>>();
const fbxCache = new Map<string, Promise<THREE.Group>>();

function load(pack: string, model: string): Promise<GLTF> {
  const key = `${pack}/${model}`;
  let p = cache.get(key);
  if (!p) {
    // downtown MegaKit ships loose .gltf files; everything else is .glb
    const ext = pack === "downtown" ? "gltf" : "glb";
    p = loader.loadAsync(`/assets/${pack}/${model}.${ext}`);
    cache.set(key, p);
  }
  return p;
}

/** The survival pack ships FBX; models are normalized to a target height so
 * callers never care about the pack's native unit scale. */
export async function loadSurvivalModel(model: string, targetHeight: number): Promise<THREE.Group> {
  const key = `survival/${model}`;
  let p = fbxCache.get(key);
  if (!p) {
    p = fbxLoader.loadAsync(`/assets/survival/${model}.fbx`).then((g) => g as unknown as THREE.Group);
    fbxCache.set(key, p);
  }
  const src = await p;
  const clone = src.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const h = box.max.y - box.min.y || 1;
  const s = targetHeight / h;
  clone.scale.setScalar(s);
  // rest on the ground at its own origin
  clone.position.y = -box.min.y * s;
  clone.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return clone;
}

/** Load a GLB and return a fresh clone (safe to add to the scene and mutate). */
export async function loadModel(pack: string, model: string): Promise<THREE.Group> {
  const gltf = await load(pack, model);
  const clone = gltf.scene.clone(true);
  clone.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // The MegaKit bakes WEAR MASKS into COLOR_0 (meant for a custom
      // engine shader). three.js multiplies vertex colors into base color,
      // which paints red wear gradients over every street edge — strip them.
      if (pack === "downtown" && o.geometry.attributes.color) {
        o.geometry.deleteAttribute("color");
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).vertexColors = false;
          m.needsUpdate = true;
        }
      }
    }
  });
  return clone;
}

/** Load a GLB clone plus its animation clips (blocky characters ship with
 * named node-transform clips: idle, walk, sprint, holding-right, die...).
 * The clips bind to the clone by node NAME, so a plain hierarchy clone works. */
export async function loadModelWithClips(
  pack: string,
  model: string,
): Promise<{ root: THREE.Group; clips: THREE.AnimationClip[] }> {
  const gltf = await load(pack, model);
  const clone = gltf.scene.clone(true);
  clone.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { root: clone, clips: gltf.animations };
}

/** Warm the cache for a set of models so instantiation doesn't stagger. */
export function preload(models: { pack: string; model: string }[]): Promise<unknown> {
  return Promise.all(models.map((m) => load(m.pack, m.model)));
}
