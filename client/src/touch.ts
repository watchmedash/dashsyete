import type { InputState } from "../../shared/src/protocol";

/**
 * Touch driving controls: left 45% of the screen is a horizontal steering
 * drag zone (full lock at 70 px); right side has GAS / BRAKE / DRIFT buttons.
 * Active on coarse-pointer devices or with a ?touch query param.
 */
export class TouchInput {
  readonly active: boolean;
  private steerValue = 0;
  private gas = false;
  private reverse = false;
  private drift = false;

  constructor() {
    this.active =
      window.matchMedia("(pointer: coarse)").matches ||
      new URLSearchParams(location.search).has("touch");
    if (this.active) this.build();
  }

  /** Merged into the keyboard input when active. */
  current(): Pick<InputState, "throttle" | "steer" | "brake" | "handbrake"> {
    return {
      throttle: (this.gas ? 1 : 0) + (this.reverse ? -1 : 0),
      // Positive rapier steer turns toward -x on screen (left), so dragging
      // left (negative px) maps to positive steer.
      steer: -this.steerValue,
      brake: 0,
      handbrake: this.drift,
    };
  }

  private build(): void {
    const root = document.createElement("div");
    root.className = "touch-controls";
    root.innerHTML = `
      <div class="steer-zone"><div class="steer-hint">◀ steer ▶</div></div>
      <div class="touch-buttons">
        <button class="tbtn tbtn-drift">DRIFT</button>
        <button class="tbtn tbtn-brake">BRAKE</button>
        <button class="tbtn tbtn-gas">GAS</button>
      </div>`;
    document.body.appendChild(root);

    const zone = root.querySelector<HTMLDivElement>(".steer-zone")!;
    let startX: number | null = null;
    let pointerId: number | null = null;
    zone.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      pointerId = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events have no active pointer to capture
      }
    });
    zone.addEventListener("pointermove", (e) => {
      if (startX === null || e.pointerId !== pointerId) return;
      this.steerValue = Math.max(-1, Math.min(1, (e.clientX - startX) / 70));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      startX = null;
      pointerId = null;
      this.steerValue = 0;
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);

    const bind = (sel: string, set: (v: boolean) => void) => {
      const btn = root.querySelector<HTMLButtonElement>(sel)!;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          // synthetic events have no active pointer to capture
        }
        set(true);
      });
      const off = () => set(false);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointercancel", off);
    };
    bind(".tbtn-gas", (v) => (this.gas = v));
    bind(".tbtn-brake", (v) => (this.reverse = v));
    bind(".tbtn-drift", (v) => (this.drift = v));
  }
}
