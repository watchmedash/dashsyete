// Planet weather + clouds. Each face (biome) has its own weather pattern:
// snow on the antarctic face, rain in the forest, clear desert skies... Fog
// is exponential and animated; precipitation falls along the LOCAL face up.
// Clouds hover a fixed height above every face — a constant "which way is
// up" cue when crossing edges. Purely visual.
import * as THREE from "three";
import { PLANET_R, type V3 } from "../../shared/src/gravity";

type WState = "clear" | "fog" | "rain" | "snow";
const CYCLE_S = 90;

// face order matches skyMap FACES/BIOMES: +Y -Y +X -X +Z -Z
// every face gets at least one REAL fog phase (vision-blocking weather)
const FACE_PATTERNS: WState[][] = [
  ["clear", "fog", "rain", "clear"], // grassland
  ["fog", "clear", "fog", "fog"], // volcanic (ash haze most of the time)
  ["clear", "fog", "clear", "clear"], // desert (sandstorm haze)
  ["snow", "fog", "snow", "clear"], // antarctic (whiteout)
  ["rain", "fog", "rain", "clear"], // forest
  ["clear", "fog", "clear", "fog"], // rocky
];

// fog 0.055 = genuine vision blocker: ~30 m of useful sight, whiteout past it
const DENSITY: Record<WState, number> = { clear: 0.0028, fog: 0.055, rain: 0.011, snow: 0.018 };
const SKY: Record<WState, number> = { clear: 0x87b8e8, fog: 0x9aa4b0, rain: 0x6e7a8c, snow: 0xaab4c2 };
const NIGHT_SKY = new THREE.Color(0x0b1226);

/** Full sun orbit around the cube: each face gets ~30 min of day and ~30 min
 * of night. The MOON rides the opposite side so night is never pitch black. */
export const DAY_CYCLE_S = 3600;
// sun orbit axis (1,1,1)/√3 with start dir ⊥ to it: every face's normal sees
// the SAME day/night amplitude, just phase-shifted — no favored face
const ORBIT_U = new THREE.Vector3(1, -1, 0).normalize();
const ORBIT_W = new THREE.Vector3(1, 1, -2).normalize();

const COUNT = 900;
const RANGE = 26;
const AMBIENT_COUNT = 320;

const FACE_NORMALS: V3[] = [
  [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];

function faceIndexOfUp(up: V3): number {
  if (up[1] === 1) return 0;
  if (up[1] === -1) return 1;
  if (up[0] === 1) return 2;
  if (up[0] === -1) return 3;
  if (up[2] === 1) return 4;
  return 5;
}

export class Weather {
  private scene: THREE.Scene;
  private points: THREE.Points;
  private pos: Float32Array;
  private speedMul!: Float32Array;
  private mat: THREE.PointsMaterial;
  // per-face AMBIENT particles: volcanic embers rise, desert dust drifts
  private ambient!: THREE.Points;
  private ambientPos!: Float32Array;
  private ambientMat!: THREE.PointsMaterial;
  private fog: THREE.FogExp2;
  private skyColor = new THREE.Color(0x87b8e8);
  private targetSky = new THREE.Color(0x87b8e8);
  private clouds: { group: THREE.Group; axis: THREE.Vector3; drift: THREE.Vector3 }[] = [];
  private t = 0;
  // day/night celestials (see DAY_CYCLE_S)
  private sunLight!: THREE.DirectionalLight;
  private moonLight!: THREE.DirectionalLight;
  private sunMesh!: THREE.Mesh;
  private moonMesh!: THREE.Mesh;
  private sunDir = new THREE.Vector3(1, 0, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2(0x87b8e8, DENSITY.clear);
    scene.fog = this.fog;
    // precipitation particle field — per-particle fall-speed factors so the
    // rain reads as random streaks, not synchronized waves
    this.pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) this.pos[i] = (Math.random() * 2 - 1) * RANGE;
    this.speedMul = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) this.speedMul[i] = 0.65 + Math.random() * 0.7;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0xdfe8f2,
      size: 0.09,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // ambient face particles (embers / dust), faded in per biome
    this.ambientPos = new Float32Array(AMBIENT_COUNT * 3);
    for (let i = 0; i < AMBIENT_COUNT * 3; i++) this.ambientPos[i] = (Math.random() * 2 - 1) * RANGE;
    const ageo = new THREE.BufferGeometry();
    ageo.setAttribute("position", new THREE.BufferAttribute(this.ambientPos, 3));
    this.ambientMat = new THREE.PointsMaterial({
      color: 0xff8a3c,
      size: 0.11,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.ambient = new THREE.Points(ageo, this.ambientMat);
    this.ambient.frustumCulled = false;
    scene.add(this.ambient);
    // SUN + MOON: one directional each, orbiting opposite each other, plus
    // visible glow spheres so you can watch them cross the sky
    this.sunLight = new THREE.DirectionalLight(0xfff2d8, 1.5);
    scene.add(this.sunLight);
    this.moonLight = new THREE.DirectionalLight(0x9fb6e8, 0.5);
    scene.add(this.moonLight);
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(16, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false }),
    );
    scene.add(this.sunMesh);
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(11, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }),
    );
    scene.add(this.moonMesh);
    // CLOUD DECKS: flat blocky puffs ~16 m above every face — an always-
    // visible orientation cue (clouds are overhead on whichever face you're on)
    // unlit: clouds read soft-white from every face, including from below
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xf6f9fc,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    for (const n of FACE_NORMALS) {
      const group = new THREE.Group();
      const nv = new THREE.Vector3(n[0], n[1], n[2]);
      // face tangents for placement
      const ref = Math.abs(n[1]) > 0.5 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const ta = new THREE.Vector3().crossVectors(nv, ref).normalize();
      const tb = new THREE.Vector3().crossVectors(ta, nv).normalize();
      // puff count scales with face area so big planets keep their cloud cover
      const puffs = Math.max(9, Math.round((PLANET_R * PLANET_R) / 350));
      for (let i = 0; i < puffs; i++) {
        const puff = new THREE.Group();
        const parts = 2 + Math.floor(Math.random() * 3);
        for (let j = 0; j < parts; j++) {
          const w = 4 + Math.random() * 6;
          const d = 3 + Math.random() * 5;
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), cloudMat);
          m.position.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 6);
          puff.add(m);
        }
        const a = (Math.random() * 2 - 1) * (PLANET_R - 6);
        const b = (Math.random() * 2 - 1) * (PLANET_R - 6);
        puff.position
          .copy(nv)
          .multiplyScalar(PLANET_R + 15 + Math.random() * 5)
          .addScaledVector(ta, a)
          .addScaledVector(tb, b);
        puff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nv);
        group.add(puff);
      }
      scene.add(group);
      this.clouds.push({ group, axis: nv, drift: ta.clone().multiplyScalar(0.35 + Math.random() * 0.3) });
    }
  }

  state(up: V3): WState {
    const pattern = FACE_PATTERNS[faceIndexOfUp(up)];
    return pattern[Math.floor(this.t / CYCLE_S) % pattern.length];
  }

  /** Local day factor for a face up: 1 = high noon, 0 = deep night. */
  dayFactor(up: V3): number {
    const d = this.sunDir.x * up[0] + this.sunDir.y * up[1] + this.sunDir.z * up[2];
    return Math.max(0, Math.min(1, d * 1.6 + 0.5));
  }

  tick(dt: number, cam: THREE.Vector3, up: V3, worldT = 0, underwater = false): void {
    this.t += dt;
    // SUN ORBIT (server-synced worldT so every player shares the same time
    // of day): rotate the start dir about the (1,1,1) axis — all six faces
    // get equal 30 min days and 30 min nights, phase-shifted
    const th = (2 * Math.PI * (worldT % DAY_CYCLE_S)) / DAY_CYCLE_S;
    this.sunDir
      .copy(ORBIT_U)
      .multiplyScalar(Math.cos(th))
      .addScaledVector(ORBIT_W, Math.sin(th));
    this.sunLight.position.copy(this.sunDir).multiplyScalar(500);
    this.moonLight.position.copy(this.sunDir).multiplyScalar(-500);
    this.sunMesh.position.copy(this.sunDir).multiplyScalar(PLANET_R * 3.2);
    this.moonMesh.position.copy(this.sunDir).multiplyScalar(-PLANET_R * 3.2);
    const f = this.dayFactor(up);

    const st = this.state(up);
    // fade fog density + sky tint toward the local face's weather, darkened
    // toward the night sky as the sun sets on THIS face. Underwater: deep
    // blue murk, fast fade (submerged eyes adapt quickly).
    const targetDensity = underwater ? 0.14 : DENSITY[st];
    const fadeRate = underwater ? 4 : 0.4;
    this.fog.density += (targetDensity - this.fog.density) * Math.min(1, dt * fadeRate);
    if (underwater) this.targetSky.setHex(0x123a5e);
    else this.targetSky.setHex(SKY[st]).lerp(NIGHT_SKY, 1 - f);
    this.skyColor.lerp(this.targetSky, Math.min(1, dt * 0.4));
    this.fog.color.copy(this.skyColor);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.skyColor);

    // clouds drift slowly across their face
    for (const c of this.clouds) {
      c.group.position.addScaledVector(c.drift, dt);
      // wrap the whole deck when it has drifted a face-length
      if (c.group.position.length() > PLANET_R) c.group.position.setScalar(0);
    }

    this.ambientTick(dt, cam, up);

    // precipitation
    const raining = st === "rain";
    const snowing = st === "snow";
    const targetOpacity = raining ? 0.75 : snowing ? 0.9 : 0;
    this.mat.opacity += (targetOpacity - this.mat.opacity) * Math.min(1, dt * 1.5);
    this.mat.size = snowing ? 0.14 : 0.09;
    this.mat.color.setHex(snowing ? 0xffffff : 0xcfdcec);
    if (this.mat.opacity < 0.02) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    const speed = raining ? 22 : 3.2;
    const drift = snowing ? 1.6 : 0.3;
    const p = this.pos;
    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      // per-particle speed factor + randomized respawn height: without both
      // the whole field falls in lockstep and reads as synchronized "waves"
      const sp = speed * this.speedMul[i];
      p[ix] += (-up[0] * sp + Math.sin(this.t * 1.3 + i) * drift) * dt;
      p[ix + 1] += (-up[1] * sp + Math.cos(this.t * 1.1 + i * 2) * drift) * dt;
      p[ix + 2] += (-up[2] * sp + Math.sin(this.t * 0.9 + i * 3) * drift) * dt;
      const rx = p[ix] - cam.x;
      const ry = p[ix + 1] - cam.y;
      const rz = p[ix + 2] - cam.z;
      const along = rx * up[0] + ry * up[1] + rz * up[2];
      if (along < -10 || Math.abs(rx) > RANGE || Math.abs(ry) > RANGE || Math.abs(rz) > RANGE) {
        const ox = (Math.random() * 2 - 1) * RANGE;
        const oy = (Math.random() * 2 - 1) * RANGE;
        const oz = (Math.random() * 2 - 1) * RANGE;
        const oAlong = ox * up[0] + oy * up[1] + oz * up[2];
        const h = 6 + Math.random() * 12; // staggered, never one flat sheet
        p[ix] = cam.x + ox + up[0] * (h - oAlong);
        p[ix + 1] = cam.y + oy + up[1] * (h - oAlong);
        p[ix + 2] = cam.z + oz + up[2] * (h - oAlong);
        this.speedMul[i] = 0.65 + Math.random() * 0.7;
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Ambient face particles: embers rising over the volcano, dust drifting
   * across the desert. Fades out everywhere else. */
  private ambientTick(dt: number, cam: THREE.Vector3, up: V3): void {
    const face = faceIndexOfUp(up);
    const embers = face === 1; // volcanic
    const dust = face === 2; // desert
    const target = embers ? 0.8 : dust ? 0.45 : 0;
    this.ambientMat.opacity += (target - this.ambientMat.opacity) * Math.min(1, dt * 1.2);
    if (this.ambientMat.opacity < 0.02) {
      this.ambient.visible = false;
      return;
    }
    this.ambient.visible = true;
    this.ambientMat.color.setHex(embers ? 0xff8a3c : 0xd8c48a);
    this.ambientMat.size = embers ? 0.12 : 0.1;
    const rise = embers ? 2.6 : 0.15; // embers float UP, dust hangs
    const sway = embers ? 0.8 : 3.4; // dust streams sideways
    const p = this.ambientPos;
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const ix = i * 3;
      p[ix] += (up[0] * rise + Math.sin(this.t * 0.9 + i * 1.7) * sway) * dt;
      p[ix + 1] += (up[1] * rise + Math.cos(this.t * 0.8 + i * 2.3) * sway) * dt;
      p[ix + 2] += (up[2] * rise + Math.sin(this.t * 1.1 + i * 0.9) * sway) * dt;
      const rx = p[ix] - cam.x;
      const ry = p[ix + 1] - cam.y;
      const rz = p[ix + 2] - cam.z;
      const along = rx * up[0] + ry * up[1] + rz * up[2];
      if (along > 16 || Math.abs(rx) > RANGE || Math.abs(ry) > RANGE || Math.abs(rz) > RANGE) {
        const ox = (Math.random() * 2 - 1) * RANGE;
        const oy = (Math.random() * 2 - 1) * RANGE;
        const oz = (Math.random() * 2 - 1) * RANGE;
        const oAlong = ox * up[0] + oy * up[1] + oz * up[2];
        // embers respawn LOW (they rise), dust anywhere in the shell
        const h = embers ? -2 + Math.random() * 4 : (Math.random() * 2 - 1) * 10;
        p[ix] = cam.x + ox + up[0] * (h - oAlong);
        p[ix + 1] = cam.y + oy + up[1] * (h - oAlong);
        p[ix + 2] = cam.z + oz + up[2] * (h - oAlong);
      }
    }
    (this.ambient.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
