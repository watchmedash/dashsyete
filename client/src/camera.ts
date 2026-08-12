import * as THREE from "three";

const pivot = new THREE.Vector3();
const dir = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const upV = new THREE.Vector3(0, 1, 0);
const t1V = new THREE.Vector3();
const t2V = new THREE.Vector3();
const rightV = new THREE.Vector3();

import { EYE_HEIGHT } from "../../shared/src/character";
import { basis, type V3 } from "../../shared/src/gravity";

/** Camera boom, over the right shoulder (scaled with the 1.5 m character). */
const DIST = 2.9;
const SHOULDER_X = 0.45; // world-left offset = screen-right of the character
const PIVOT_Y = EYE_HEIGHT; // eye height above the CAPSULE-CENTER pose

export type CameraMode = "third-back" | "first" | "third-front";
export const CAMERA_MODES: CameraMode[] = ["first", "third-back", "third-front"];

/**
 * Aim camera with three perspectives (V key cycles). All offsets run in the
 * character's FACE FRAME (up + tangents) so the camera works on every side
 * of the cube planet; the up vector itself is smoothed so 90° edge crossings
 * roll the horizon instead of snapping it.
 */
export class ShooterCamera {
  private camera: THREE.PerspectiveCamera;
  mode: CameraMode = "first"; // first person is the default view
  /** Smoothed world-up for the view (chases the physics face up). */
  private viewUp = new THREE.Vector3(0, 1, 0);
  private lastT = performance.now();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  cycleMode(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  update(
    charPos: THREE.Vector3,
    yaw: number,
    pitch: number,
    clearance?: (from: [number, number, number], d: [number, number, number], dist: number) => number | null,
    up: V3 = [0, 1, 0],
  ): void {
    // smooth the VIEW up toward the physics up: edge crossings roll the
    // horizon over ~0.5 s (time-based, framerate independent)
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    upV.set(up[0], up[1], up[2]);
    const { t1, t2 } = basis(up);
    // ANTIPODAL GUARD: lerping toward the exact opposite up is degenerate —
    // the blend stays collinear and normalize() pins it right back, so a
    // spawn on the far face left the camera upside down forever. Nudge
    // through a face tangent so the roll has a path to follow.
    if (this.viewUp.dot(upV) < -0.9) {
      this.viewUp.addScaledVector(t2V.set(t2[0], t2[1], t2[2]), 0.25).normalize();
    }
    this.viewUp.lerp(upV, 1 - Math.exp(-dt * 6)).normalize();

    t1V.set(t1[0], t1[1], t1[2]);
    t2V.set(t2[0], t2[1], t2[2]);
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    // aim direction in the face frame (matches the server muzzle math)
    dir
      .set(0, 0, 0)
      .addScaledVector(t1V, sinY * cosP)
      .addScaledVector(t2V, cosY * cosP)
      .addScaledVector(upV, sinP);
    // screen-right of the character = -(right) in wire convention
    rightV.set(0, 0, 0).addScaledVector(t1V, cosY).addScaledVector(t2V, -sinY);
    const shoulder = this.mode === "third-back" ? SHOULDER_X : 0;
    pivot
      .copy(charPos)
      .addScaledVector(rightV, -shoulder)
      .addScaledVector(upV, PIVOT_Y);
    if (this.mode === "first") {
      this.camera.position.copy(pivot).addScaledVector(dir, 0.15);
      lookAt.copy(pivot).addScaledVector(dir, 20);
    } else {
      const sign = this.mode === "third-front" ? 1 : -1;
      let boom = DIST;
      if (clearance) {
        const hit = clearance(
          [pivot.x, pivot.y, pivot.z],
          [dir.x * sign, dir.y * sign, dir.z * sign],
          DIST + 0.3,
        );
        if (hit !== null) boom = Math.max(0.4, hit - 0.25);
      }
      this.camera.position.copy(pivot).addScaledVector(dir, sign * boom);
      lookAt.copy(pivot);
      if (this.mode === "third-back") lookAt.addScaledVector(dir, 20);
    }
    this.camera.up.copy(this.viewUp);
    this.camera.lookAt(lookAt);
  }

  jumpTo(charPos: THREE.Vector3, yaw: number): void {
    this.update(charPos, yaw, 0);
  }

  /** Hard-set the view up (spawns/respawns: no cinematic roll from the old
   * face — you arrive standing the right way up). */
  snapUp(up: V3): void {
    this.viewUp.set(up[0], up[1], up[2]);
  }
}
