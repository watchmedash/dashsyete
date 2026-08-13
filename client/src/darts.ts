import * as THREE from "three";
import type { DartSnap } from "../../shared/src/protocol";
import { faceUp } from "../../shared/src/gravity";
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
  private live = new Map<string, { mesh: THREE.Mesh; v: THREE.Vector3; lastSync: number; voff?: THREE.Vector3; nade?: boolean; spin?: THREE.Vector3 }>();
  private dartGeo = new THREE.CapsuleGeometry(0.05, 0.5, 3, 6);
  private dartMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
  private nadeGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private nadeMat = new THREE.MeshLambertMaterial({ color: 0x30343c });
  // LASER LOOK — additive glow shells shared by every tracer (never disposed)
  private glowMat = new THREE.MeshBasicMaterial({
    color: 0xffb648, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private tailGeo = new THREE.CapsuleGeometry(0.028, 1.7, 3, 6);
  private tailMat = new THREE.MeshBasicMaterial({
    color: 0xff9330, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private fuseMat = new THREE.MeshBasicMaterial({
    color: 0xff3b30, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private sparkGeo = new THREE.CapsuleGeometry(0.035, 0.5, 2, 5);
  private time = 0;

  /** Core capsule + additive glow shell + long faded tail = energy-bolt look. */
  private makeTracer(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.dartGeo, this.dartMat);
    const glow = new THREE.Mesh(this.dartGeo, this.glowMat);
    glow.scale.set(2.6, 1.25, 2.6);
    mesh.add(glow);
    const tail = new THREE.Mesh(this.tailGeo, this.tailMat);
    tail.position.y = -1.05; // trails behind (capsule long axis = +y = velocity)
    mesh.add(tail);
    return mesh;
  }

  /** Fired when a new dart appears in the snapshot (someone fired). */
  onDartNew: ((owner: string, p: THREE.Vector3) => void) | null = null;
  /** Fired when a grenade's fall reverses between snapshots (a bounce). */
  onNadeBounce: ((p: THREE.Vector3) => void) | null = null;
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
        const mesh = isNade
          ? new THREE.Mesh(this.nadeGeo, this.nadeMat)
          : this.makeTracer();
        if (isNade) {
          // blinking fuse glow: says LIVE EXPLOSIVE from across the map
          const fuse = new THREE.Mesh(this.puffGeo, this.fuseMat);
          fuse.scale.setScalar(0.24);
          fuse.name = "fuse";
          mesh.add(fuse);
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
        entry = {
          mesh, v: new THREE.Vector3(), lastSync: now, nade: isNade,
          spin: isNade
            ? new THREE.Vector3(2.5 + Math.random() * 3, 1 + Math.random() * 2, 1.5 + Math.random() * 2)
            : undefined,
        };
        // spawn the VISUAL at the shooter's gun; the offset from the true
        // ray decays over the first ~150 ms of flight
        const m = this.muzzleOf?.(d.owner);
        if (m && !d.id.startsWith("nade-")) {
          entry.voff = m.clone().sub(new THREE.Vector3(d.p[0], d.p[1], d.p[2]));
          if (entry.voff.length() > 3) entry.voff = undefined; // sanity
        }
        this.live.set(d.id, entry);
        this.scene.add(mesh);
        if (!isNade) this.onDartNew?.(d.owner, new THREE.Vector3(d.p[0], d.p[1], d.p[2]));
      }
      entry.mesh.position.set(d.p[0], d.p[1], d.p[2]);
      if (entry.voff) entry.mesh.position.add(entry.voff);
      // falling → rising between snapshots = the grenade hit something
      if (d.id.startsWith("nade-") && entry.v.y < -1 && d.v[1] > 0.5)
        this.onNadeBounce?.(entry.mesh.position);
      entry.v.set(d.v[0], d.v[1], d.v[2]);
      entry.lastSync = now;
      if (!entry.nade && entry.v.lengthSq() > 1) {
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

  /** Brief star of light at a gun muzzle when a shot leaves it. */
  muzzleFlash(p: THREE.Vector3): void {
    this.puff(p, 0.11, 0xfff3b0, 0.07);
    this.flashLight(p);
  }

  // POOLED explosion lights: big orange blast glow, longer fade than muzzle
  // flashes (pool of 2 — explosions are rarer and each dominates its area).
  private boomPool: { l: THREE.PointLight; ttl: number }[] = [];
  private boomLight(p: THREE.Vector3): void {
    let slot = this.boomPool.find((s) => s.ttl <= 0);
    if (!slot && this.boomPool.length < 2) {
      const l = new THREE.PointLight(0xff9a3d, 0, 18, 2);
      this.scene.add(l);
      slot = { l, ttl: 0 };
      this.boomPool.push(slot);
    }
    if (!slot) return;
    slot.ttl = 0.35;
    slot.l.position.copy(p);
    slot.l.intensity = 14;
  }

  // POOLED muzzle point lights: brief warm glow that lights the surroundings
  // (reads best on the night faces). A fixed pool of 4 keeps the per-frame
  // light count bounded no matter how many blasters go off at once.
  private lightPool: { l: THREE.PointLight; ttl: number }[] = [];
  private flashLight(p: THREE.Vector3): void {
    let slot = this.lightPool.find((s) => s.ttl <= 0);
    if (!slot && this.lightPool.length < 4) {
      const l = new THREE.PointLight(0xffd9a0, 0, 9, 2);
      this.scene.add(l);
      slot = { l, ttl: 0 };
      this.lightPool.push(slot);
    }
    if (!slot) return; // pool saturated — skip, plenty of flashes already lit
    slot.ttl = 0.09;
    slot.l.position.copy(p);
    slot.l.intensity = 6;
  }

  /** Small expanding fading sphere at an impact point. One shared unit
   * geometry, scaled per effect — puffs fire constantly and per-puff
   * geometries would leak GPU buffers (scene.remove does not free them). */
  private puffGeo = new THREE.SphereGeometry(1, 8, 6);
  private puff(p: THREE.Vector3, size: number, color: number, ttl = 0.22, rise?: THREE.Vector3, additive = false): void {
    const mesh = new THREE.Mesh(
      this.puffGeo,
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: !additive,
      }),
    );
    mesh.scale.setScalar(size);
    mesh.position.copy(p);
    this.scene.add(mesh);
    this.locals.push({ mesh, v: rise ?? new THREE.Vector3(0, 0.6, 0), ttl, ttl0: ttl });
  }

  /** Grenade blast: additive fireball core, expanding shockwave shell, ground
   * ring + smoke crown + glowing sparks — ALL oriented to the local face's up
   * (an explosion on a side face must not paint its ring sideways). */
  private explosion(p: THREE.Vector3): void {
    this.boomLight(p);
    const n = faceUp([p.x, p.y, p.z], null, true);
    const nUp = new THREE.Vector3(n[0], n[1], n[2]);
    // fireball: white-hot core inside an additive orange bloom
    this.puff(p, 1.1, 0xffffff, 0.22, new THREE.Vector3(), true);
    this.puff(p, 1.9, 0xff9d3c, 0.34, nUp.clone().multiplyScalar(0.8), true);
    this.puff(p, 2.6, 0xff5a1f, 0.3, new THREE.Vector3(), true);
    // shockwave: a fast translucent shell racing to the 8 m blast edge
    const wave = new THREE.Mesh(
      this.puffGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffe9c0, transparent: true, opacity: 0.35, side: THREE.BackSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    wave.scale.setScalar(1.2);
    wave.position.copy(p);
    this.scene.add(wave);
    this.locals.push({ mesh: wave, v: new THREE.Vector3(), ttl: 0.4, ttl0: 0.4, grow: 9 });
    // smoke crown rises along the FACE up, ringed around the blast
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    if (Math.abs(nUp.x) < 0.9) t1.set(1, 0, 0).cross(nUp).normalize();
    else t1.set(0, 1, 0).cross(nUp).normalize();
    t2.crossVectors(nUp, t1);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const off = t1.clone().multiplyScalar(Math.cos(a) * 1.5)
        .addScaledVector(t2, Math.sin(a) * 1.5)
        .addScaledVector(nUp, 0.5 + (i % 3) * 0.6);
      this.puff(off.add(p), 0.7, 0x8b8f99, 0.8, nUp.clone().multiplyScalar(1.4));
    }
    // sparks: glowing debris streaks thrown up the blast hemisphere, pulled
    // back down by face gravity
    for (let i = 0; i < 12; i++) {
      const spark = new THREE.Mesh(this.sparkGeo, this.tailMat.clone());
      spark.position.copy(p);
      const v = t1.clone().multiplyScalar((Math.random() - 0.5) * 12)
        .addScaledVector(t2, (Math.random() - 0.5) * 12)
        .addScaledVector(nUp, 4 + Math.random() * 8);
      dir.copy(v).normalize();
      spark.quaternion.setFromUnitVectors(up, dir);
      this.scene.add(spark);
      this.locals.push({
        mesh: spark, v, ttl: 0.5 + Math.random() * 0.35, ttl0: 0.85,
        grav: nUp.clone().multiplyScalar(-22), noGrow: true,
      });
    }
    // scorch ring hugs the ground plane of the face
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nUp);
    ring.position.copy(p).addScaledVector(nUp, -0.25);
    ring.scale.setScalar(1.6);
    this.scene.add(ring);
    this.locals.push({ mesh: ring, v: new THREE.Vector3(), ttl: 0.6, ttl0: 0.6 });
  }

  // Instant local feedback: a short-lived tracer + muzzle flash the moment
  // YOU click, bridging the ~100 ms until the authoritative dart arrives.
  private locals: { mesh: THREE.Mesh; v: THREE.Vector3; ttl: number; ttl0?: number; grav?: THREE.Vector3; grow?: number; noGrow?: boolean }[] = [];
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true });

  localShot(p: [number, number, number], aimDir: [number, number, number], speed: number): void {
    const mesh = this.makeTracer();
    mesh.position.set(p[0], p[1], p[2]);
    const v = new THREE.Vector3(aimDir[0], aimDir[1], aimDir[2]).multiplyScalar(speed);
    dir.copy(v).normalize();
    mesh.quaternion.setFromUnitVectors(up, dir);
    this.scene.add(mesh);
    this.locals.push({ mesh, v, ttl: 0.12 });
    // muzzle flash: an expanding fading sphere (shared geometry, scaled)
    const flash = new THREE.Mesh(this.puffGeo, this.flashMat.clone());
    flash.scale.setScalar(0.09);
    flash.position.set(p[0], p[1], p[2]);
    this.scene.add(flash);
    this.locals.push({ mesh: flash, v: new THREE.Vector3(), ttl: 0.07 });
  }

  /** Extrapolate between 20 Hz snapshots so darts fly smoothly. */
  tick(dt: number): void {
    this.time += dt;
    // fuse blink shared by every live grenade (2.5 Hz pulse)
    this.fuseMat.opacity = 0.45 + 0.4 * Math.sin(this.time * 16);
    for (const s of this.lightPool) {
      if (s.ttl <= 0) continue;
      s.ttl -= dt;
      s.l.intensity = Math.max(0, (s.ttl / 0.09) * 6);
    }
    for (const s of this.boomPool) {
      if (s.ttl <= 0) continue;
      s.ttl -= dt;
      s.l.intensity = Math.max(0, (s.ttl / 0.35) * 14);
    }
    for (const entry of this.live.values()) {
      entry.mesh.position.addScaledVector(entry.v, dt);
      if (entry.spin) {
        // grenades tumble end over end while airborne
        entry.mesh.rotation.x += entry.spin.x * dt;
        entry.mesh.rotation.y += entry.spin.y * dt;
        entry.mesh.rotation.z += entry.spin.z * dt;
      }
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
      if (l.grav) l.v.addScaledVector(l.grav, dt);
      l.mesh.position.addScaledVector(l.v, dt);
      if (!l.noGrow) l.mesh.scale.multiplyScalar(1 + dt * (l.grow ?? 6));
      const mat = l.mesh.material as THREE.MeshBasicMaterial;
      if (mat.transparent) mat.opacity = Math.max(0, Math.min(1, l.ttl / (l.ttl0 ?? 0.07)) * 0.9);
      if (l.ttl <= 0) {
        this.scene.remove(l.mesh);
        // free GPU resources — but never the SHARED geometries/materials
        // (tracers, puffs and sparks all reuse them)
        const g = l.mesh.geometry;
        if (g !== this.dartGeo && g !== this.puffGeo && g !== this.sparkGeo && g !== this.tailGeo) g.dispose();
        const m = l.mesh.material as THREE.Material;
        if (m !== this.dartMat && m !== this.tailMat && m !== this.glowMat) m.dispose();
        this.locals.splice(i, 1);
      }
    }
  }
}
