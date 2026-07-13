import * as THREE from "three";

const back = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const forward = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const DIST = 9;
const HEIGHT = 4.5;

/**
 * Damped chase camera. `look` offsets the orbit around the car: yaw spins
 * the camera any direction around it, pitch raises/lowers it.
 */
export class ChaseCamera {
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(
    dt: number,
    carPos: THREE.Vector3,
    carQuat: THREE.Quaternion,
    look: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 },
  ): void {
    forward.set(0, 0, 1).applyQuaternion(carQuat);
    forward.y = 0;
    forward.normalize();

    back.copy(forward).multiplyScalar(-DIST).applyAxisAngle(UP, look.yaw);
    target.copy(carPos).add(back);
    target.y = carPos.y + HEIGHT + Math.sin(look.pitch) * DIST;

    // Stiff follow (~35 ms): a lazy lerp here lags along the velocity vector,
    // so the follow distance breathes with every speed change — reads as the
    // camera "zooming in and out" while driving.
    const k = 1 - Math.exp(-dt / 0.035);
    this.camera.position.lerp(target, k);

    lookAt.copy(carPos).addScaledVector(forward, 2);
    lookAt.y += 1;
    this.camera.lookAt(lookAt);
  }

  jumpTo(carPos: THREE.Vector3, carQuat: THREE.Quaternion): void {
    forward.set(0, 0, 1).applyQuaternion(carQuat);
    back.copy(forward).multiplyScalar(-DIST);
    this.camera.position.copy(carPos).add(back);
    this.camera.position.y = carPos.y + HEIGHT;
  }

  /** World yaw of the camera's viewing direction (for camera-relative input). */
  yaw(): number {
    this.camera.getWorldDirection(forward);
    return Math.atan2(forward.x, forward.z);
  }
}
