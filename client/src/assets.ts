import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

function load(pack: string, model: string): Promise<GLTF> {
  const key = `${pack}/${model}`;
  let p = cache.get(key);
  if (!p) {
    p = loader.loadAsync(`/assets/${pack}/${model}.glb`);
    cache.set(key, p);
  }
  return p;
}

/** Load a GLB and return a fresh clone (safe to add to the scene and mutate). */
export async function loadModel(pack: string, model: string): Promise<THREE.Group> {
  const gltf = await load(pack, model);
  const clone = gltf.scene.clone(true);
  clone.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return clone;
}

/** Warm the cache for a set of models so instantiation doesn't stagger. */
export function preload(models: { pack: string; model: string }[]): Promise<unknown> {
  return Promise.all(models.map((m) => load(m.pack, m.model)));
}
