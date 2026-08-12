/**
 * Keyboard + mouse shooter input: WASD/arrows move, Space jump, Shift sprint,
 * left mouse fires, right mouse zooms (snipers), Q swaps weapons, G throws a
 * grenade. Fire only registers while the pointer is locked to the canvas (or
 * held down on it) so UI clicks never shoot.
 */
export class KeyboardInput {
  private keys = new Set<string>();
  private mouseDown = false;
  /** Right mouse held (sniper zoom — client-side only). */
  zooming = false;
  /** Build tool equipped (B toggles, v5 voxel mode — client-side only). */
  buildMode = false;
  /** Right mouse held (block placement while the build tool is out). */
  rightDown = false;
  private canvas: HTMLCanvasElement;
  seq = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", (e) => {
      if (!e.code) return; // some synthetic events carry no code
      this.keys.add(e.code);
      if (e.code === "KeyB") this.buildMode = !this.buildMode;
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseDown = false;
      this.zooming = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousedown", (e) => {
      const onCanvas = document.pointerLockElement === canvas || e.target === canvas;
      if (e.button === 0 && onCanvas) this.mouseDown = true;
      if (e.button === 2 && onCanvas) {
        this.zooming = true;
        this.rightDown = true;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) {
        this.zooming = false;
        this.rightDown = false;
      }
    });
  }

  /** Raw movement/action state; yaw+pitch are merged in by the caller. */
  current(): {
    moveX: number; moveZ: number; jump: boolean; sprint: boolean;
    fire: boolean; nade: boolean; swap: boolean;
  } {
    const k = this.keys;
    const forward = k.has("KeyW") || k.has("ArrowUp");
    const back = k.has("KeyS") || k.has("ArrowDown");
    const left = k.has("KeyA") || k.has("ArrowLeft");
    const right = k.has("KeyD") || k.has("ArrowRight");
    return {
      // screen-right is world -x looking along the camera (see joystick.ts)
      moveX: (left ? 1 : 0) + (right ? -1 : 0),
      moveZ: (forward ? 1 : 0) + (back ? -1 : 0),
      jump: k.has("Space"),
      sprint: k.has("ShiftLeft") || k.has("ShiftRight"),
      fire: this.mouseDown,
      nade: k.has("KeyG"),
      swap: k.has("KeyQ"),
    };
  }
}
