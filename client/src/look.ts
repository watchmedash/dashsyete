const SENSITIVITY = 1 / 450; // px -> radians
const TOUCH_SENSITIVITY = 1 / 220;
const IDLE_AFTER_S = 1.5;    // no look input for this long -> ease back behind the car
const EASE_RATE = 3;         // rad/s-ish exponential return
const PITCH_MIN = -0.25;
const PITCH_MAX = 0.9;

/**
 * Free-look orbit state. Desktop: click the canvas to grab the pointer
 * (Pointer Lock), mouse moves orbit; Esc releases. Mobile: drag anywhere
 * that isn't a touch control. When idle, yaw/pitch ease back to 0 (camera
 * settles behind the car again).
 */
export class FreeLook {
  yaw = 0;
  pitch = 0;
  private lastInputAt = -Infinity;
  private touchId: number | null = null;
  private lastTouch = { x: 0, y: 0 };

  get active(): boolean {
    return performance.now() / 1000 - this.lastInputAt < IDLE_AFTER_S;
  }

  attach(canvas: HTMLCanvasElement): void {
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    if (!coarse) {
      // Preferred: pointer lock (click the canvas, Esc to release).
      // Fallback (lock unavailable/denied): hold left mouse button and drag.
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

    // Touch: one finger dragging outside the controls orbits the camera.
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
    this.yaw -= dx;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + dy));
    while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
    this.lastInputAt = performance.now() / 1000;
  }

  /** Ease back behind the car when idle and driving. */
  tick(dt: number, driving: boolean): void {
    if (this.active || !driving) return;
    const k = 1 - Math.exp(-EASE_RATE * dt);
    this.yaw -= this.yaw * k;
    this.pitch -= this.pitch * k;
  }
}
