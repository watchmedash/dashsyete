import * as THREE from "three";
import { CAR_MODEL_SCALE, PLAYABLE_CARS } from "../../../shared/src/constants";
import { loadModel } from "../assets";

/** Full-screen join overlay; resolves with the chosen name and car. */
export function showJoinScreen(): Promise<{ name: string; car: string }> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="join-panel">
        <h1 class="join-title">DASH CITY</h1>
        <p class="join-sub">Knock out rival teams. Don't get wrecked.</p>
        <input class="join-name" maxlength="16" placeholder="Your name" autocomplete="off" />
        <div class="car-picker">
          <button class="car-arrow" data-dir="-1" aria-label="previous car">◀</button>
          <div class="car-preview"></div>
          <button class="car-arrow" data-dir="1" aria-label="next car">▶</button>
        </div>
        <p class="car-name"></p>
        <button class="join-play">PLAY</button>
      </div>`;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector<HTMLInputElement>(".join-name")!;
    const carName = overlay.querySelector<HTMLParagraphElement>(".car-name")!;
    const previewHost = overlay.querySelector<HTMLDivElement>(".car-preview")!;

    // Mini 3D preview
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    previewHost.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101625);
    const camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 100);
    camera.position.set(0, 3.2, 8.5);
    camera.lookAt(0, 0.9, 0);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x37405a, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    scene.add(key);
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.4, 0.35, 40),
      new THREE.MeshStandardMaterial({ color: 0x1b2439, roughness: 0.8 }),
    );
    pedestal.position.y = -0.18;
    scene.add(pedestal);

    let index = 0;
    let current: THREE.Group | null = null;
    let generation = 0;

    async function showCar() {
      const gen = ++generation;
      const model = await loadModel("cars", PLAYABLE_CARS[index]);
      if (gen !== generation) return; // stale load
      if (current) scene.remove(current);
      model.scale.setScalar(CAR_MODEL_SCALE);
      current = model;
      scene.add(model);
      carName.textContent = PLAYABLE_CARS[index].replace(/-/g, " ");
    }

    function resize() {
      const w = previewHost.clientWidth || 320;
      const h = previewHost.clientHeight || 200;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      if (current) current.rotation.y += clock.getDelta() * 0.9;
      else clock.getDelta();
      renderer.render(scene, camera);
    });

    overlay.querySelectorAll<HTMLButtonElement>(".car-arrow").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        index = (index + dir + PLAYABLE_CARS.length) % PLAYABLE_CARS.length;
        showCar();
      });
    });

    function play() {
      const name = nameInput.value.trim().slice(0, 16) || "Player";
      renderer.setAnimationLoop(null);
      renderer.dispose();
      window.removeEventListener("resize", resize);
      overlay.remove();
      resolve({ name, car: PLAYABLE_CARS[index] });
    }
    overlay.querySelector<HTMLButtonElement>(".join-play")!.addEventListener("click", play);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") play();
    });

    showCar();
    nameInput.focus();
  });
}
