/**
 * Keyboard + mouse shooter input: WASD/arrows move, Space jump, Shift sprint,
 * left mouse fires, G throws a grenade. Fire only registers while the pointer
 * is locked to the canvas (or held down on it) so UI clicks never shoot.
 */
export class KeyboardInput {
  private keys = new Set<string>();
  private mouseDown = false;
  private canvas: HTMLCanvasElement;
  seq = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", (e) => {
      if (!e.code) return; // some synthetic events carry no code
      this.keys.add(e.code);
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    window.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement === canvas || e.target === canvas) this.mouseDown = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
  }

  /** Raw movement/action state; yaw+pitch are merged in by the caller. */
  current(): { moveX: number; moveZ: number; jump: boolean; sprint: boolean; fire: boolean; nade: boolean } {
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
    };
  }
}
