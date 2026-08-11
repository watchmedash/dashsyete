import * as THREE from "three";

const pivot = new THREE.Vector3();
const dir = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Vector3();

/** Camera boom, over the right shoulder. */
const DIST = 3.4;
const SHOULDER_X = 0.55; // world-left offset = screen-right of the character
const PIVOT_Y = 0.65; // eye height above the CAPSULE-CENTER pose (~1.55 above feet)

export type CameraMode = "third-back" | "first" | "third-front";
export const CAMERA_MODES: CameraMode[] = ["third-back", "first", "third-front"];

/**
 * Aim camera with three perspectives (V key cycles):
 * - third-back: over the right shoulder, behind the character
 * - first: through the character's eyes (the model is hidden by main.ts)
 * - third-front: in front, looking back (selfie view — aim still turns you)
 * Rigidly attached to the aim yaw/pitch — aim must be 1:1; any smoothing on
 * rotation reads as floaty gunplay.
 */
export class ShooterCamera {
  private camera: THREE.PerspectiveCamera;
  mode: CameraMode = "third-back";

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  cycleMode(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  update(charPos: THREE.Vector3, yaw: number, pitch: number): void {
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const cosP = Math.cos(pitch);
    // aim direction (matches the server muzzle math)
    dir.set(sinY * cosP, Math.sin(pitch), cosY * cosP);
    // shoulder pivot: screen-right looking along +forward is (-cosY, 0, sinY)
    // — see joystick.ts. First/front views center on the head instead.
    const shoulder = this.mode === "third-back" ? SHOULDER_X : 0;
    pivot.set(
      charPos.x + -cosY * shoulder,
      charPos.y + PIVOT_Y,
      charPos.z + sinY * shoulder,
    );
    if (this.mode === "first") {
      this.camera.position.copy(pivot).addScaledVector(dir, 0.15);
      lookAt.copy(pivot).addScaledVector(dir, 20);
    } else if (this.mode === "third-front") {
      this.camera.position.copy(pivot).addScaledVector(dir, DIST);
      lookAt.copy(pivot);
    } else {
      target.copy(pivot).addScaledVector(dir, -DIST);
      this.camera.position.copy(target);
      lookAt.copy(pivot).addScaledVector(dir, 20);
    }
    this.camera.lookAt(lookAt);
  }

  jumpTo(charPos: THREE.Vector3, yaw: number): void {
    this.update(charPos, yaw, 0);
  }
}
