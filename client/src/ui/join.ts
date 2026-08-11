import * as THREE from "three";
import { MODEL_SCALES, PLAYABLE_SKINS, SKIN_NAMES } from "../../../shared/src/constants";
import { loadModelWithClips } from "../assets";

export interface JoinChoice {
  name: string;
  skin: string;
  pass: string;
}

/** Full-screen showroom join overlay; resolves with name/skin/password. */
export function showJoinScreen(error?: string): Promise<JoinChoice> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="join-panel">
        <h1 class="join-title">DASH CITY</h1>
        <p class="join-sub">Blasters out. Last one laughing wins.</p>
        <div class="car-picker">
          <button class="car-arrow" data-dir="-1" aria-label="previous character">◀</button>
          <div class="car-preview"></div>
          <button class="car-arrow" data-dir="1" aria-label="next character">▶</button>
        </div>
        <p class="car-name"></p>
        <div class="join-fields">
          <input class="join-name" maxlength="16" placeholder="Your name" autocomplete="off" />
          <input class="join-pass" type="password" minlength="4" maxlength="64" placeholder="Password" autocomplete="new-password" />
        </div>
        <p class="join-error"></p>
        <button class="join-play">PLAY</button>
      </div>`;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector<HTMLInputElement>(".join-name")!;
    const passInput = overlay.querySelector<HTMLInputElement>(".join-pass")!;
    const errorLine = overlay.querySelector<HTMLParagraphElement>(".join-error")!;
    const skinName = overlay.querySelector<HTMLParagraphElement>(".car-name")!;
    const previewHost = overlay.querySelector<HTMLDivElement>(".car-preview")!;

    const setError = (msg: string) => {
      errorLine.textContent = msg;
      errorLine.classList.toggle("show", !!msg);
    };
    if (error) setError(error);

    // Showroom preview: bright studio, idling character on a pedestal
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    previewHost.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f6);
    const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 100);
    camera.position.set(0, 1.6, 3.6);
    camera.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde6, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 7, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 1.2);
    fill.position.set(-5, 3, -4);
    scene.add(fill);
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.25, 0.16, 48),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }),
    );
    pedestal.position.y = -0.09;
    scene.add(pedestal);

    let index = Math.max(0, PLAYABLE_SKINS.indexOf(localStorage.getItem("dash-skin") ?? ""));
    let current: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let generation = 0;

    async function showSkin() {
      const gen = ++generation;
      const { root: model, clips } = await loadModelWithClips("characters", PLAYABLE_SKINS[index]);
      if (gen !== generation) return; // stale load
      if (current) scene.remove(current);
      model.scale.setScalar(MODEL_SCALES.characters);
      current = model;
      scene.add(model);
      mixer = new THREE.AnimationMixer(model);
      const idle = THREE.AnimationClip.findByName(clips, "idle");
      if (idle) mixer.clipAction(idle).play();
      skinName.textContent = SKIN_NAMES[PLAYABLE_SKINS[index]] ?? PLAYABLE_SKINS[index];
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
      const dt = clock.getDelta();
      if (current) current.rotation.y += dt * 0.6;
      mixer?.update(dt);
      renderer.render(scene, camera);
    });

    overlay.querySelectorAll<HTMLButtonElement>(".car-arrow").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        index = (index + dir + PLAYABLE_SKINS.length) % PLAYABLE_SKINS.length;
        showSkin();
      });
    });

    function play() {
      const name = nameInput.value.trim().slice(0, 16) || "Player";
      const pass = passInput.value;
      if (pass.length < 4) {
        setError("password must be at least 4 characters");
        return;
      }
      // Mobile: go fullscreen landscape (must happen inside the tap gesture).
      if (window.matchMedia("(pointer: coarse)").matches) {
        document.documentElement.requestFullscreen?.().catch(() => {});
        (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
          .lock?.("landscape")
          .catch(() => {});
      }
      localStorage.setItem("dash-skin", PLAYABLE_SKINS[index]);
      document.body.classList.add("playing");
      renderer.setAnimationLoop(null);
      renderer.dispose();
      window.removeEventListener("resize", resize);
      overlay.remove();
      resolve({ name, skin: PLAYABLE_SKINS[index], pass });
    }
    overlay.querySelector<HTMLButtonElement>(".join-play")!.addEventListener("click", play);
    for (const input of [nameInput, passInput])
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") play();
      });

    showSkin();
    nameInput.focus();
  });
}
