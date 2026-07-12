import * as THREE from "three";
import { buildCity } from "./city";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 300, 700);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function start() {
  await buildCity(scene);

  // Temporary fly-around until the game loop lands (Task 9)
  const clock = new THREE.Clock();
  let angle = 0;
  (window as unknown as { __cam?: unknown }).__cam = camera; // debug hook
  let manual = false;
  (window as unknown as { __manual?: (v: boolean) => void }).__manual = (v) => (manual = v);
  renderer.setAnimationLoop(() => {
    if (!manual) {
      angle += clock.getDelta() * 0.1;
      camera.position.set(Math.cos(angle) * 220, 150, Math.sin(angle) * 220);
      camera.lookAt(0, 0, 0);
    }
    renderer.render(scene, camera);
  });
}

start();
