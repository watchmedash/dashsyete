import * as THREE from "three";
import { MODEL_SCALES, PLAYABLE_SKINS, SKIN_NAMES } from "../../../shared/src/constants";
import { loadModelWithClips } from "../assets";
import { settingsPanel } from "../settings";

export interface JoinChoice {
  name: string;
  skin: string;
  key: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
          <button class="join-lb" type="button">LEADERBOARD</button>
          <button class="join-settings" type="button">SETTINGS</button>
          <div class="menu-lb" hidden><h3>ALL-TIME LEADERBOARD</h3><div class="menu-lb-rows">loading…</div></div>
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

    // ALL-TIME LEADERBOARD (persistent account scores from the server)
    const lbPanel = overlay.querySelector<HTMLDivElement>(".menu-lb")!;
    const lbRows = overlay.querySelector<HTMLDivElement>(".menu-lb-rows")!;
    if (isDesktop) overlay.querySelector<HTMLButtonElement>(".join-lb")!.hidden = true;
    overlay.querySelector<HTMLButtonElement>(".join-lb")!.addEventListener("click", async () => {
      lbPanel.hidden = !lbPanel.hidden;
      if (lbPanel.hidden) return;
      // dev client runs on :5173 while the game server owns :8080
      const api = location.port && location.port !== "8080"
        ? `http://${location.hostname}:8080/api/leaderboard`
        : "/api/leaderboard";
      try {
        const top = (await (await fetch(api)).json()) as { name: string; score: number }[];
        lbRows.innerHTML = top.length
          ? top
              .map(
                (r, i) =>
                  `<div class="menu-lb-row"><span>${i + 1}. ${escapeHtml(r.name)}</span><b>${r.score}</b></div>`,
              )
              .join("")
          : "<div class='menu-lb-row'><span>no knockouts recorded yet</span></div>";
      } catch {
        lbRows.textContent = "leaderboard unavailable";
      }
    });

    // SETTINGS panel: shared sliders card (same one the pause overlay uses)
    const setPanel = settingsPanel();
    setPanel.hidden = true;
    overlay.querySelector<HTMLDivElement>(".join-right")!.appendChild(setPanel);
    overlay.querySelector<HTMLButtonElement>(".join-settings")!.addEventListener("click", () => {
      setPanel.hidden = !setPanel.hidden;
      if (!setPanel.hidden) lbPanel.hidden = true;
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
