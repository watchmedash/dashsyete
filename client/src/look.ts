const SENSITIVITY = 1 / 450; // px -> radians
const TOUCH_SENSITIVITY = 1 / 220;
// nearly straight down/up (89°): aim at your own feet, build under yourself
const PITCH_MIN = -1.55;
const PITCH_MAX = 1.55;

/**
 * Aim state (shooter): absolute yaw/pitch driven by the mouse under Pointer
 * Lock (click the canvas to grab, Esc releases; drag fallback otherwise) or a
 * touch-drag on mobile outside the controls. Unlike the car-era free-look
 * this never eases back — your aim stays where you put it.
 */
export class AimLook {
  yaw = 0;
  pitch = 0;
  /** Sensitivity multiplier; set to 1/zoom while scoped so aim feel matches FOV. */
  scale = 1;
  /** User sensitivity preference (settings panel), 0.2..3, persisted. */
  userSens = 1;
  private touchId: number | null = null;
  private lastTouch = { x: 0, y: 0 };

  attach(canvas: HTMLCanvasElement): void {
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    if (!coarse) {
      let dragging = false;
      canvas.addEventListener("click", () => {
        if (document.pointerLockElement !== canvas)
          canvas.requestPointerLock()?.catch?.(() => {});
      });
      canvas.addEventListener("mousedown", () => (dragging = true));
      window.addEventListener("mouseup", () => (dragging = false));
      window.addEventListener("mousemove", (e) => {
        if (document.pointerLockElement === canvas || dragging) {
          this.apply(e.movementX * SENSITIVITY, e.movementY * SENSITIVITY);
        }
      });
      return;
    }

    // Touch: one finger dragging outside the controls aims.
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch" || this.touchId !== null) return;
        if ((e.target as HTMLElement).closest(".touch-controls, .hud, .overlay")) return;
        this.touchId = e.pointerId;
        this.lastTouch = { x: e.clientX, y: e.clientY };
      },
      { passive: true },
    );
    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerId !== this.touchId) return;
        this.apply(
          (e.clientX - this.lastTouch.x) * TOUCH_SENSITIVITY,
          (e.clientY - this.lastTouch.y) * TOUCH_SENSITIVITY,
        );
        this.lastTouch = { x: e.clientX, y: e.clientY };
      },
      { passive: true },
    );
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.touchId) this.touchId = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  private apply(dx: number, dy: number): void {
    dx *= this.scale * this.userSens;
    dy *= this.scale * this.userSens;
    // screen-right = yaw decrease (world +x appears left looking along +z)
    this.yaw -= dx;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch - dy));
    while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
  }
}
