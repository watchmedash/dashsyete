import * as THREE from "three";
import { WEAPONS } from "../../shared/src/weapons";
import { loadModel } from "./assets";

/**
 * Renders each blaster model (with its scope) into a small transparent PNG
 * once, so the HUD can show the actual gun instead of a text label.
 */
const cache = new Map<string, Promise<string>>();

export function weaponIcon(weaponId: string): Promise<string> {
  let p = cache.get(weaponId);
  if (!p) {
    p = render(weaponId);
    cache.set(weaponId, p);
  }
  return p;
}

async function render(weaponId: string): Promise<string> {
  const w = WEAPONS[weaponId];
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(128, 72);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x778199, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 3, 4);
  scene.add(key);

  const gun = await loadModel("blasters", weaponId === "grenade" ? "grenade-a" : w?.model ?? "blaster-a");
  if (w?.scopeModel) {
    const scope = await loadModel("blasters", w.scopeModel);
    scope.position.set(0, 0.16, 0.05);
    gun.add(scope);
  }
  // frame the gun side-on (barrel -z points screen-left)
  const box = new THREE.Box3().setFromObject(gun);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  gun.position.sub(center);
  scene.add(gun);
  const span = Math.max(size.z, size.y * (128 / 72));
  const camera = new THREE.OrthographicCamera(
    (-span * 0.62) * (128 / 72) * (72 / 128) * (128 / 72), (span * 0.62) * (128 / 72) * (72 / 128) * (128 / 72),
    span * 0.62, -span * 0.62, 0.01, 20,
  );
  camera.left = -span * 0.62 * (128 / 72);
  camera.right = span * 0.62 * (128 / 72);
  camera.position.set(5, 0.6, 0); // side view: +x looks at the gun's flank
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
}
