/**
 * Touch shooter controls (Kenney mobile-controls sprites):
 * - left joystick: run direction (camera-relative; mapping in joystick.ts)
 * - right buttons: FIRE (hold for auto weapons) and JUMP
 * - dragging anywhere else aims (see look.ts)
 * Subtle styling: ~40% opacity idle, brighter while touched.
 * Active on coarse-pointer devices or with a ?touch query param.
 */
export class TouchInput {
  readonly active: boolean;
  /** Joystick deflection, each -1..1 (+jy = pulled down toward the player). */
  jx = 0;
  jy = 0;
  fire = false;
  jump = false;
  swap = false;
  nade = false;
  /** Hold-to-zoom (sniper scope). */
  zooming = false;

  constructor() {
    this.active =
      window.matchMedia("(pointer: coarse)").matches ||
      new URLSearchParams(location.search).has("touch");
    if (this.active) {
      document.body.classList.add("touch"); // CSS hooks
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
      <div class="action-buttons">
        <button class="action-btn btn-swap" aria-label="swap weapon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 8h13M13 4l4 4-4 4" />
            <path d="M20 16H7M11 12l-4 4 4 4" />
          </svg>
        </button>
        <button class="action-btn btn-nade" aria-label="grenade">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <rect x="9.5" y="2.5" width="5" height="4" rx="1" />
            <circle cx="12" cy="14" r="7" />
          </svg>
        </button>
        <button class="action-btn btn-zoom" aria-label="zoom">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6" />
            <path d="M15 15l5.5 5.5" />
          </svg>
        </button>
        <button class="action-btn btn-jump" aria-label="jump"><span>⇧</span></button>
        <button class="action-btn btn-fire" aria-label="fire"><span>◎</span></button>
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
    bind(".btn-fire", (v) => (this.fire = v));
    bind(".btn-jump", (v) => (this.jump = v));
    bind(".btn-swap", (v) => (this.swap = v));
    bind(".btn-nade", (v) => (this.nade = v));
    bind(".btn-zoom", (v) => (this.zooming = v));
  }
}
