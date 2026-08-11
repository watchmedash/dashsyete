import * as THREE from "three";
import { MODEL_SCALES, PLAYABLE_SKINS, SKIN_NAMES } from "../../../shared/src/constants";
import { loadModelWithClips } from "../assets";

export interface JoinChoice {
  name: string;
  skin: string;
  key: string;
}

const storedKey = (name: string) => localStorage.getItem(`dash-key:${name.trim().toLowerCase()}`) ?? "";

export function rememberKey(name: string, key: string): void {
  localStorage.setItem(`dash-key:${name.trim().toLowerCase()}`, key);
}

/**
 * Join menu floating over the live city orbit. Name + character only — the
 * server mints a name key on first join; the key field appears when a name
 * is already registered (or via the "have a key?" toggle).
 */
export function showJoinScreen(error?: string): Promise<JoinChoice> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const needKey = !!error && /key/i.test(error);
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
          <h1 class="join-title"><span>DASH</span><span>CITY</span></h1>
          <p class="join-sub">Grab a blaster. Tag 'em all.</p>
          <input class="join-name" maxlength="16" placeholder="Your name" autocomplete="off" spellcheck="false" />
          <div class="join-keyrow${needKey ? " show" : ""}">
            <input class="join-key" maxlength="64" placeholder="Name key (XXXX-XXXX-XXXX)" autocomplete="off" spellcheck="false" />
          </div>
          <button class="join-keytoggle" type="button">have a name key?</button>
          <p class="join-error${error ? " show" : ""}">${error ?? ""}</p>
          <button class="join-play">DROP IN</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector<HTMLInputElement>(".join-name")!;
    const keyInput = overlay.querySelector<HTMLInputElement>(".join-key")!;
    const keyRow = overlay.querySelector<HTMLDivElement>(".join-keyrow")!;
    const errorLine = overlay.querySelector<HTMLParagraphElement>(".join-error")!;
    const skinName = overlay.querySelector<HTMLParagraphElement>(".car-name")!;
    const stage = overlay.querySelector<HTMLDivElement>(".char-stage")!;

    nameInput.value = localStorage.getItem("dash-name") ?? "";

    overlay.querySelector<HTMLButtonElement>(".join-keytoggle")!.addEventListener("click", () => {
      keyRow.classList.toggle("show");
      if (keyRow.classList.contains("show")) keyInput.focus();
    });

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

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
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
      const typedKey = keyInput.value.trim();
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
      resolve({ name, skin: PLAYABLE_SKINS[index], key: typedKey || storedKey(name) });
    }
    overlay.querySelector<HTMLButtonElement>(".join-play")!.addEventListener("click", play);
    for (const input of [nameInput, keyInput])
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") play();
      });
    void errorLine; // filled inline above

    showSkin();
    nameInput.focus();
  });
}

/** One-time key reveal after the server mints a name. */
export function showKeyCard(name: string, key: string): void {
  rememberKey(name, key);
  const card = document.createElement("div");
  card.className = "key-card";
  card.innerHTML = `
    <p class="key-eyebrow">NAME CLAIMED</p>
    <p class="key-name">${name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</p>
    <p class="key-value">${key}</p>
    <p class="key-hint">This key unlocks your name on any device. It's saved on this one.</p>
    <div class="key-actions">
      <button class="key-copy">Copy key</button>
      <button class="key-done">Got it</button>
    </div>`;
  document.body.appendChild(card);
  card.querySelector<HTMLButtonElement>(".key-copy")!.addEventListener("click", () => {
    navigator.clipboard?.writeText(key).catch(() => {});
    card.querySelector<HTMLButtonElement>(".key-copy")!.textContent = "Copied";
  });
  card.querySelector<HTMLButtonElement>(".key-done")!.addEventListener("click", () => card.remove());
}
