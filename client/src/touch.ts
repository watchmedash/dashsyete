/**
 * Touch driving controls v2 (Kenney mobile-controls sprites):
 * - left joystick: push where you want to go (camera-relative; magnitude =
 *   throttle, pulling back reverses) — mapping lives in joystick.ts
 * - right pedals: explicit gas / brake overrides
 * Subtle styling: ~40% opacity idle, brighter while touched.
 * Active on coarse-pointer devices or with a ?touch query param.
 */
export class TouchInput {
  readonly active: boolean;
  /** Joystick deflection, each -1..1 (+jy = pulled down toward the player). */
  jx = 0;
  jy = 0;
  gas = false;
  brake = false;

  constructor() {
    this.active =
      window.matchMedia("(pointer: coarse)").matches ||
      new URLSearchParams(location.search).has("touch");
    if (this.active) {
      document.body.classList.add("touch"); // CSS hooks (rotate overlay etc.)
      this.build();
    }
  }

  private build(): void {
    const root = document.createElement("div");
    root.className = "touch-controls";
    root.innerHTML = `
      <div class="joystick">
        <img class="joystick-pad" src="/assets/ui/joystick_pad.png" alt="" draggable="false" />
        <img class="joystick-nub" src="/assets/ui/joystick_nub.png" alt="" draggable="false" />
      </div>
      <div class="pedals">
        <button class="pedal pedal-brake"><img src="/assets/ui/icon_brake.png" alt="brake" draggable="false" /></button>
        <button class="pedal pedal-gas"><img src="/assets/ui/icon_gas.png" alt="gas" draggable="false" /></button>
      </div>`;
    document.body.appendChild(root);

    const stick = root.querySelector<HTMLDivElement>(".joystick")!;
    const nub = root.querySelector<HTMLImageElement>(".joystick-nub")!;
    let pointerId: number | null = null;

    const setNub = (dx: number, dy: number) => {
      nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const radius = () => stick.clientWidth / 2 - 8;

    const update = (e: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const r = radius();
      const len = Math.hypot(dx, dy);
      if (len > r) {
        dx = (dx / len) * r;
        dy = (dy / len) * r;
      }
      setNub(dx, dy);
      this.jx = dx / r;
      this.jy = dy / r;
    };

    stick.addEventListener("pointerdown", (e) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      stick.classList.add("engaged");
      try {
        stick.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events have no active pointer to capture
      }
      update(e);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId === pointerId) update(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      stick.classList.remove("engaged");
      this.jx = 0;
      this.jy = 0;
      setNub(0, 0);
    };
    stick.addEventListener("pointerup", release);
    stick.addEventListener("pointercancel", release);

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
    bind(".pedal-gas", (v) => (this.gas = v));
    bind(".pedal-brake", (v) => (this.brake = v));
  }
}
