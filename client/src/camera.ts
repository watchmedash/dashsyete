import * as THREE from "three";

const pivot = new THREE.Vector3();
const dir = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Vector3();

/** Camera boom, over the right shoulder. */
const DIST = 3.4;
const SHOULDER_X = 0.55; // world-left offset = screen-right of the character
const PIVOT_Y = 0.65; // eye height above the CAPSULE-CENTER pose (~1.55 above feet)

/**
 * Over-shoulder aim camera: rigidly attached to the aim yaw/pitch (aim must
 * be 1:1 — any smoothing on rotation reads as floaty gunplay). The camera
 * orbits a shoulder pivot; pitch tilts the boom, yaw spins it.
 */
export class ShooterCamera {
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(charPos: THREE.Vector3, yaw: number, pitch: number): void {
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const cosP = Math.cos(pitch);
    // aim direction (matches the server muzzle math)
    dir.set(sinY * cosP, Math.sin(pitch), cosY * cosP);
    // shoulder pivot: screen-right of the character is world (-cos, 0, sin)·yaw...
    // screen-right looking along +forward is (-cosY, 0, sinY) — see joystick.ts.
    pivot.set(
      charPos.x + -cosY * SHOULDER_X,
      charPos.y + PIVOT_Y,
      charPos.z + sinY * SHOULDER_X,
    );
    target.copy(pivot).addScaledVector(dir, -DIST);
    this.camera.position.copy(target);
    lookAt.copy(pivot).addScaledVector(dir, 20);
    this.camera.lookAt(lookAt);
  }

  jumpTo(charPos: THREE.Vector3, yaw: number): void {
    this.update(charPos, yaw, 0);
  }
}
