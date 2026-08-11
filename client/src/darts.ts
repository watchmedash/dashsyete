import * as THREE from "three";
import type { DartSnap } from "../../shared/src/protocol";

const up = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();

/**
 * Renders the authoritative projectiles from snapshots: foam darts as bright
 * elongated bolts oriented along their velocity, grenades ("nade-" ids) as
 * dark spheres. Between snapshots (20 Hz) each projectile extrapolates along
 * its last velocity so flight looks continuous at 60 fps.
 */
export class DartVisuals {
  private scene: THREE.Scene;
  private live = new Map<string, { mesh: THREE.Mesh; v: THREE.Vector3; lastSync: number }>();
  private dartGeo = new THREE.CapsuleGeometry(0.05, 0.5, 3, 6);
  private dartMat = new THREE.MeshBasicMaterial({ color: 0xffd54a });
  private nadeGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private nadeMat = new THREE.MeshLambertMaterial({ color: 0x30343c });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Adopt the authoritative projectile set from a snapshot. */
  sync(darts: DartSnap[], now: number): void {
    const seen = new Set<string>();
    for (const d of darts) {
      seen.add(d.id);
      let entry = this.live.get(d.id);
      if (!entry) {
        const isNade = d.id.startsWith("nade-");
        const mesh = new THREE.Mesh(
          isNade ? this.nadeGeo : this.dartGeo,
          isNade ? this.nadeMat : this.dartMat,
        );
        entry = { mesh, v: new THREE.Vector3(), lastSync: now };
        this.live.set(d.id, entry);
        this.scene.add(mesh);
      }
      entry.mesh.position.set(d.p[0], d.p[1], d.p[2]);
      entry.v.set(d.v[0], d.v[1], d.v[2]);
      entry.lastSync = now;
      if (entry.v.lengthSq() > 1) {
        dir.copy(entry.v).normalize();
        entry.mesh.quaternion.setFromUnitVectors(up, dir); // capsule long axis = +y
      }
    }
    for (const [id, entry] of this.live) {
      if (!seen.has(id)) {
        this.scene.remove(entry.mesh);
        this.live.delete(id);
      }
    }
    (globalThis as unknown as { __darts?: number }).__darts = this.live.size; // debug hook
  }

  // Instant local feedback: a short-lived tracer + muzzle flash the moment
  // YOU click, bridging the ~100 ms until the authoritative dart arrives.
  private locals: { mesh: THREE.Mesh; v: THREE.Vector3; ttl: number }[] = [];
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true });

  localShot(p: [number, number, number], aimDir: [number, number, number], speed: number): void {
    const mesh = new THREE.Mesh(this.dartGeo, this.dartMat);
    mesh.position.set(p[0], p[1], p[2]);
    const v = new THREE.Vector3(aimDir[0], aimDir[1], aimDir[2]).multiplyScalar(speed);
    dir.copy(v).normalize();
    mesh.quaternion.setFromUnitVectors(up, dir);
    this.scene.add(mesh);
    this.locals.push({ mesh, v, ttl: 0.12 });
    // muzzle flash: an expanding fading sprite-ish quad
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), this.flashMat.clone());
    flash.position.set(p[0], p[1], p[2]);
    this.scene.add(flash);
    this.locals.push({ mesh: flash, v: new THREE.Vector3(), ttl: 0.07 });
  }

  /** Extrapolate between 20 Hz snapshots so darts fly smoothly. */
  tick(dt: number): void {
    for (const entry of this.live.values()) {
      entry.mesh.position.addScaledVector(entry.v, dt);
    }
    for (let i = this.locals.length - 1; i >= 0; i--) {
      const l = this.locals[i];
      l.ttl -= dt;
      l.mesh.position.addScaledVector(l.v, dt);
      l.mesh.scale.multiplyScalar(1 + dt * 6);
      const mat = l.mesh.material as THREE.MeshBasicMaterial;
      if (mat.transparent) mat.opacity = Math.max(0, l.ttl / 0.07);
      if (l.ttl <= 0) {
        this.scene.remove(l.mesh);
        this.locals.splice(i, 1);
      }
    }
  }
}
