/** Player preferences (settings panel on the menu), persisted per browser.
 * Changes broadcast a "dash-settings" window event so live systems
 * (look sensitivity, sfx volume) apply them immediately. */
export interface Settings {
  /** Mouse/touch aim sensitivity multiplier, 0.2..3. */
  sens: number;
  /** Master volume 0..1. */
  vol: number;
  /** Base field of view in degrees, 60..110. */
  fov: number;
  /** Show the FPS meter (bottom-right). */
  fps: boolean;
}

const KEY = "dash-settings";

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      sens: Math.max(0.2, Math.min(3, Number(raw.sens) || 1)),
      vol: raw.vol === 0 ? 0 : Math.max(0, Math.min(1, Number(raw.vol) || 1)),
      fov: Math.max(60, Math.min(110, Number(raw.fov) || 70)),
      fps: !!raw.fps,
    };
  } catch {
    return { sens: 1, vol: 1, fov: 70, fps: false };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("dash-settings", { detail: s }));
}

/** Build the shared settings sliders card (menu + in-game pause overlay).
 * Fully wired: live labels, persistence, and the "dash-settings" event. */
export function settingsPanel(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "menu-settings";
  div.innerHTML = `
    <label>MOUSE SENSITIVITY <b class="set-sens-val"></b>
      <input class="set-sens" type="range" min="0.2" max="3" step="0.1" />
    </label>
    <label>VOLUME <b class="set-vol-val"></b>
      <input class="set-vol" type="range" min="0" max="1" step="0.05" />
    </label>
    <label>FIELD OF VIEW <b class="set-fov-val"></b>
      <input class="set-fov" type="range" min="60" max="110" step="1" />
    </label>
    <label class="set-check">SHOW FPS
      <input class="set-fps" type="checkbox" />
    </label>`;
  const sens = div.querySelector<HTMLInputElement>(".set-sens")!;
  const vol = div.querySelector<HTMLInputElement>(".set-vol")!;
  const fov = div.querySelector<HTMLInputElement>(".set-fov")!;
  const fps = div.querySelector<HTMLInputElement>(".set-fps")!;
  const cur = loadSettings();
  sens.value = String(cur.sens);
  vol.value = String(cur.vol);
  fov.value = String(cur.fov);
  fps.checked = cur.fps;
  const labels = () => {
    div.querySelector(".set-sens-val")!.textContent = `${Number(sens.value).toFixed(1)}x`;
    div.querySelector(".set-vol-val")!.textContent = `${Math.round(Number(vol.value) * 100)}%`;
    div.querySelector(".set-fov-val")!.textContent = `${fov.value}°`;
  };
  labels();
  const push = () => {
    labels();
    saveSettings({ sens: Number(sens.value), vol: Number(vol.value), fov: Number(fov.value), fps: fps.checked });
  };
  sens.addEventListener("input", push);
  vol.addEventListener("input", push);
  fov.addEventListener("input", push);
  fps.addEventListener("change", push);
  return div;
}
