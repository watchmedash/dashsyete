import * as THREE from "three";
import { CAR_MODEL_SCALE, PLAYABLE_CARS } from "../../../shared/src/constants";
import { loadModel } from "../assets";

export interface JoinChoice {
  name: string;
  car: string;
  pass: string;
}

/** Full-screen showroom join overlay; resolves with name/car/password. */
export function showJoinScreen(error?: string): Promise<JoinChoice> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="join-panel">
        <h1 class="join-title">DASH CITY</h1>
        <p class="join-sub">Don't get wrecked.</p>
        <div class="car-picker">
          <button class="car-arrow" data-dir="-1" aria-label="previous car">◀</button>
          <div class="car-preview"></div>
          <button class="car-arrow" data-dir="1" aria-label="next car">▶</button>
        </div>
        <p class="car-name"></p>
        <div class="join-fields">
          <input class="join-name" maxlength="16" placeholder="Your name" autocomplete="off" />
          <input class="join-pass" type="password" minlength="4" maxlength="64" placeholder="Password" autocomplete="off" />
        </div>
        <p class="join-error"></p>
        <button class="join-play">PLAY</button>
      </div>`;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector<HTMLInputElement>(".join-name")!;
    const passInput = overlay.querySelector<HTMLInputElement>(".join-pass")!;
    const errorLine = overlay.querySelector<HTMLParagraphElement>(".join-error")!;
    const carName = overlay.querySelector<HTMLParagraphElement>(".car-name")!;
    const previewHost = overlay.querySelector<HTMLDivElement>(".car-preview")!;

    const setError = (msg: string) => {
      errorLine.textContent = msg;
      errorLine.classList.toggle("show", !!msg);
    };
    if (error) setError(error);

    // Showroom preview: bright studio so the car colors pop
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    previewHost.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f6);
    const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 100);
    camera.position.set(0, 3.4, 9);
    camera.lookAt(0, 0.9, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde6, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 7, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 1.2);
    fill.position.set(-5, 3, -4);
    scene.add(fill);
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.5, 0.3, 48),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }),
    );
    pedestal.position.y = -0.16;
    scene.add(pedestal);
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xc9cfda, transparent: true, opacity: 0.6 }),
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.005;
    scene.add(shadowDisc);

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
      const w = previewHost.clientWidth || 360;
      const h = previewHost.clientHeight || 220;
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
      const pass = passInput.value;
      if (pass.length < 4) {
        setError("password must be at least 4 characters");
        return;
      }
      // Mobile: go fullscreen landscape (must happen inside the tap gesture;
      // failures are fine — the portrait overlay covers unsupported browsers).
      if (window.matchMedia("(pointer: coarse)").matches) {
        document.documentElement.requestFullscreen?.().catch(() => {});
        (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
          .lock?.("landscape")
          .catch(() => {});
      }
      document.body.classList.add("playing");
      renderer.setAnimationLoop(null);
      renderer.dispose();
      window.removeEventListener("resize", resize);
      overlay.remove();
      resolve({ name, car: PLAYABLE_CARS[index], pass });
    }
    overlay.querySelector<HTMLButtonElement>(".join-play")!.addEventListener("click", play);
    for (const input of [nameInput, passInput])
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") play();
      });

    showCar();
    nameInput.focus();
  });
}
