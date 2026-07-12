import type { InputState } from "../../shared/src/protocol";

/** Keyboard driving input: WASD/arrows + Space handbrake. */
export class KeyboardInput {
  private keys = new Set<string>();
  private seq = 0;

  constructor() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  current(): InputState {
    const k = this.keys;
    const forward = k.has("KeyW") || k.has("ArrowUp");
    const back = k.has("KeyS") || k.has("ArrowDown");
    const left = k.has("KeyA") || k.has("ArrowLeft");
    const right = k.has("KeyD") || k.has("ArrowRight");
    return {
      seq: ++this.seq,
      throttle: (forward ? 1 : 0) + (back ? -1 : 0),
      // Rapier steering: positive angle = left turn, so A (left) is +1.
      steer: (left ? 1 : 0) + (right ? -1 : 0),
      brake: 0,
      handbrake: k.has("Space"),
    };
  }
}
