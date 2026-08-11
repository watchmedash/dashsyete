import * as THREE from "three";
import type { DartSnap } from "../../shared/src/protocol";
import { loadModel } from "./assets";

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
  private live = new Map<string, { mesh: THREE.Mesh; v: THREE.Vector3; lastSync: number; voff?: THREE.Vector3 }>();
  private dartGeo = new THREE.CapsuleGeometry(0.05, 0.5, 3, 6);
  private dartMat = new THREE.MeshBasicMaterial({ color: 0xffd54a });
  private nadeGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private nadeMat = new THREE.MeshLambertMaterial({ color: 0x30343c });

  /** Fired when a projectile vanishes from the snapshot (impact or expiry). */
  onDartGone: ((p: THREE.Vector3) => void) | null = null;
  onNadeGone: ((p: THREE.Vector3) => void) | null = null;
  /** Where a shooter's gun muzzle is (visual dart origin — the authoritative
   * dart flies the camera ray, which reads as shooting from the eyes). */
  muzzleOf: ((ownerId: string) => THREE.Vector3 | null) | null = null;

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
        if (isNade) {
          // swap the placeholder sphere for the real grenade model when loaded
          loadModel("blasters", "grenade-a").then((g) => {
            if (!this.live.has(d.id)) return;
            g.scale.setScalar(2);
            g.position.y = -0.12; // model rests on its base; center it
            // hide the placeholder's own surface; children still render
            mesh.material = new THREE.MeshBasicMaterial({ visible: false });
            mesh.add(g);
          });
        }
        entry = { mesh, v: new THREE.Vector3(), lastSync: now };
        // spawn the VISUAL at the shooter's gun; the offset from the true
        // ray decays over the first ~150 ms of flight
        const m = this.muzzleOf?.(d.owner);
        if (m && !d.id.startsWith("nade-")) {
          entry.voff = m.clone().sub(new THREE.Vector3(d.p[0], d.p[1], d.p[2]));
          if (entry.voff.length() > 3) entry.voff = undefined; // sanity
        }
        this.live.set(d.id, entry);
        this.scene.add(mesh);
      }
      entry.mesh.position.set(d.p[0], d.p[1], d.p[2]);
      if (entry.voff) entry.mesh.position.add(entry.voff);
      entry.v.set(d.v[0], d.v[1], d.v[2]);
      entry.lastSync = now;
      if (entry.v.lengthSq() > 1) {
        dir.copy(entry.v).normalize();
        entry.mesh.quaternion.setFromUnitVectors(up, dir); // capsule long axis = +y
      }
    }
    for (const [id, entry] of this.live) {
      if (!seen.has(id)) {
        if (id.startsWith("nade-")) {
          this.explosion(entry.mesh.position);
          this.onNadeGone?.(entry.mesh.position);
        } else {
          this.puff(entry.mesh.position, 0.14, 0xf3efe2);
          this.onDartGone?.(entry.mesh.position);
        }
        this.scene.remove(entry.mesh);
        this.live.delete(id);
      }
    }
    (globalThis as unknown as { __darts?: number }).__darts = this.live.size; // debug hook
  }

  /** Small expanding fading sphere at an impact point. */
  private puff(p: THREE.Vector3, size: number, color: number, ttl = 0.22): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    mesh.position.copy(p);
    this.scene.add(mesh);
    this.locals.push({ mesh, v: new THREE.Vector3(0, 0.6, 0), ttl });
  }

  /** Grenade blast: flash core + expanding ground ring + smoke puffs. */
  private explosion(p: THREE.Vector3): void {
    this.puff(p, 0.5, 0xffd54a, 0.3);
    this.puff(p, 0.3, 0xffffff, 0.2);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const off = new THREE.Vector3(Math.cos(a) * 0.6, 0.3 + (i % 2) * 0.4, Math.sin(a) * 0.6);
      this.puff(off.add(p), 0.32, 0x8b8f99, 0.5);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.62, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, Math.max(0.06, p.y - 0.3), p.z);
    this.scene.add(ring);
    this.locals.push({ mesh: ring, v: new THREE.Vector3(), ttl: 0.45 });
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
      if (entry.voff) {
        // slide the visual from the gun onto the true ray over ~150 ms
        entry.mesh.position.sub(entry.voff);
        entry.voff.multiplyScalar(Math.max(0, 1 - dt * 7));
        entry.mesh.position.add(entry.voff);
        if (entry.voff.lengthSq() < 0.0004) entry.voff = undefined;
      }
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
