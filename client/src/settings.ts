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
}

const KEY = "dash-settings";

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      sens: Math.max(0.2, Math.min(3, Number(raw.sens) || 1)),
      vol: raw.vol === 0 ? 0 : Math.max(0, Math.min(1, Number(raw.vol) || 1)),
      fov: Math.max(60, Math.min(110, Number(raw.fov) || 70)),
    };
  } catch {
    return { sens: 1, vol: 1, fov: 70 };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("dash-settings", { detail: s }));
}
