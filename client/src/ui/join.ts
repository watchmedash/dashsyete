import * as THREE from "three";
import { MODEL_SCALES, PLAYABLE_SKINS, SKIN_NAMES } from "../../../shared/src/constants";
import { loadModelWithClips } from "../assets";

export interface JoinChoice {
  name: string;
  skin: string;
  key: string;
}

/** Desktop (offline installer) or solo (mobile APK) build: no leaderboard,
 * and the first name you pick is yours for good — it only resets with an
 * uninstall/reinstall. */
import { isSolo } from "../mode";
export const isDesktop = new URLSearchParams(location.search).has("desktop") || isSolo;

/**
 * Join menu over the live face vista. Name + character only — no name keys
 * (an online name collision just auto-suffixes a number server-side).
 */
export function showJoinScreen(error?: string): Promise<JoinChoice> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="join-panel">
        <div class="join-left">
          <div class="char-stage"></div>
          <div class="char-nav">
            <button class="car-arrow" data-dir="-1" aria-label="previous character">◀</button>
            <p class="car-name"></p>
            <button class="car-arrow" data-dir="1" aria-label="next character">▶</button>
          </div>
        </div>
        <div class="join-right">
          <h1 class="join-title"><span>SIX</span><span>SIDES</span></h1>
          <input class="join-name" maxlength="16" placeholder="Your name" autocomplete="off" spellcheck="false" />
          <p class="join-error${error ? " show" : ""}">${error ?? ""}</p>
          <button class="join-play">DROP IN</button>
          <p class="join-continue" hidden>a saved world exists — DROP IN continues it</p>
        </div>
      </div>
      <span class="build-tag">build ${__BUILD_VERSION__}</span>`;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector<HTMLInputElement>(".join-name")!;
    const errorLine = overlay.querySelector<HTMLParagraphElement>(".join-error")!;
    const skinName = overlay.querySelector<HTMLParagraphElement>(".car-name")!;
    const stage = overlay.querySelector<HTMLDivElement>(".char-stage")!;

    nameInput.value = localStorage.getItem("dash-name") ?? "";
    if (isDesktop && nameInput.value) {
      // single-player: the name is permanent once chosen
      nameInput.readOnly = true;
      nameInput.classList.add("locked");
    }
    // saved world hint: DROP IN resumes where you left off
    if (localStorage.getItem("dash-exsave"))
      overlay.querySelector<HTMLParagraphElement>(".join-continue")!.hidden = false;

    // Floating character: transparent canvas over the city-orbit backdrop.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 1.35, 4.1);
    camera.lookAt(0, 0.92, 0);
    scene.add(new THREE.HemisphereLight(0xfff6e0, 0x3a4054, 1.9));
    const key = new THREE.DirectionalLight(0xffe9b8, 2.4);
    key.position.set(4, 7, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7db4ff, 1.6);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

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
      const w = stage.clientWidth || 300;
      const h = stage.clientHeight || 340;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    let lastT = performance.now();
    renderer.setAnimationLoop(() => {
      const dt = (performance.now() - lastT) / 1000;
      lastT = performance.now();
      if (current) current.rotation.y += dt * 0.55;
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
      // Mobile: go fullscreen landscape (must happen inside the tap gesture).
      if (window.matchMedia("(pointer: coarse)").matches) {
        document.documentElement.requestFullscreen?.().catch(() => {});
        (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })
          .lock?.("landscape")
          .catch(() => {});
      }
      localStorage.setItem("dash-skin", PLAYABLE_SKINS[index]);
      localStorage.setItem("dash-name", name);
      document.body.classList.add("playing");
      renderer.setAnimationLoop(null);
      renderer.dispose();
      window.removeEventListener("resize", resize);
      overlay.remove();
      resolve({ name, skin: PLAYABLE_SKINS[index], key: "" });
    }
    overlay.querySelector<HTMLButtonElement>(".join-play")!.addEventListener("click", play);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") play();
    });
    void errorLine; // filled inline above

    showSkin();
    nameInput.focus();
  });
}
