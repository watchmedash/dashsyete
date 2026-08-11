import * as THREE from "three";
import { loadModel } from "../assets";

/** Lazy model thumbnail renderer: ONE shared offscreen WebGL renderer, models
 * framed by bounding box from a 3/4 view, rendered once to a PNG dataURL. */

const W = 96;
const H = 72;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let holder: THREE.Group;

const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve(); // serialize renders on the shared renderer

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(W, H, false);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9099, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(3, 5, 2);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 500);
  holder = new THREE.Group();
  scene.add(holder);
}

async function renderThumb(model: string): Promise<string> {
  ensureRenderer();
  const obj = await loadModel("downtown", model);
  holder.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const dir = new THREE.Vector3(1, 0.8, 1).normalize();
  const dist = (radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  renderer!.render(scene, camera);
  // toDataURL in the same task as render() — no preserveDrawingBuffer needed
  const url = renderer!.domElement.toDataURL("image/png");
  holder.remove(obj);
  return url;
}

/** Cached; returns "" on load/render failure so callers can skip setting src. */
export function getThumb(model: string): Promise<string> {
  let p = cache.get(model);
  if (!p) {
    p = queue.then(() => renderThumb(model)).catch(() => "");
    queue = p;
    cache.set(model, p);
  }
  return p;
}
