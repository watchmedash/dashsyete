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
  }

  /** Extrapolate between 20 Hz snapshots so darts fly smoothly. */
  tick(dt: number): void {
    for (const entry of this.live.values()) {
      entry.mesh.position.addScaledVector(entry.v, dt);
    }
  }
}
