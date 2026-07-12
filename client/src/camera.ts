import * as THREE from "three";

const back = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const forward = new THREE.Vector3();

/** Damped chase camera: 9 m behind, 4.5 m above, looking ahead of the car. */
export class ChaseCamera {
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion): void {
    forward.set(0, 0, 1).applyQuaternion(carQuat);
    forward.y = 0;
    forward.normalize();

    back.copy(forward).multiplyScalar(-9);
    target.copy(carPos).add(back);
    target.y = carPos.y + 4.5;

    const k = 1 - Math.pow(0.001, dt);
    this.camera.position.lerp(target, k);

    lookAt.copy(carPos).addScaledVector(forward, 2);
    lookAt.y += 1;
    this.camera.lookAt(lookAt);
  }

  jumpTo(carPos: THREE.Vector3, carQuat: THREE.Quaternion): void {
    forward.set(0, 0, 1).applyQuaternion(carQuat);
    back.copy(forward).multiplyScalar(-9);
    this.camera.position.copy(carPos).add(back);
    this.camera.position.y = carPos.y + 4.5;
  }
}
