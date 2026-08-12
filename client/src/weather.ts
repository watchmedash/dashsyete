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
const FACE_PATTERNS: WState[][] = [
  ["clear", "clear", "rain", "fog"], // grassland
  ["fog", "clear", "fog", "clear"], // rocky
  ["clear", "clear", "clear", "fog"], // desert (rare haze)
  ["snow", "snow", "clear", "snow"], // antarctic
  ["rain", "clear", "rain", "fog"], // forest
  ["clear", "fog", "clear", "clear"], // badlands
];

const DENSITY: Record<WState, number> = { clear: 0.0028, fog: 0.030, rain: 0.011, snow: 0.015 };
const SKY: Record<WState, number> = { clear: 0x87b8e8, fog: 0x9aa4b0, rain: 0x6e7a8c, snow: 0xaab4c2 };

const COUNT = 900;
const RANGE = 26;

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
  private mat: THREE.PointsMaterial;
  private fog: THREE.FogExp2;
  private skyColor = new THREE.Color(0x87b8e8);
  private targetSky = new THREE.Color(0x87b8e8);
  private clouds: { group: THREE.Group; axis: THREE.Vector3; drift: THREE.Vector3 }[] = [];
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2(0x87b8e8, DENSITY.clear);
    scene.fog = this.fog;
    // precipitation particle field
    this.pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) this.pos[i] = (Math.random() * 2 - 1) * RANGE;
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
      for (let i = 0; i < 9; i++) {
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

  tick(dt: number, cam: THREE.Vector3, up: V3): void {
    this.t += dt;
    const st = this.state(up);
    // fade fog density + sky tint toward the local face's weather
    this.fog.density += (DENSITY[st] - this.fog.density) * Math.min(1, dt * 0.4);
    this.targetSky.setHex(SKY[st]);
    this.skyColor.lerp(this.targetSky, Math.min(1, dt * 0.4));
    this.fog.color.copy(this.skyColor);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.skyColor);

    // clouds drift slowly across their face
    for (const c of this.clouds) {
      c.group.position.addScaledVector(c.drift, dt);
      // wrap the whole deck when it has drifted a face-length
      if (c.group.position.length() > PLANET_R) c.group.position.setScalar(0);
    }

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
      p[ix] += (-up[0] * speed + Math.sin(this.t * 1.3 + i) * drift) * dt;
      p[ix + 1] += (-up[1] * speed + Math.cos(this.t * 1.1 + i * 2) * drift) * dt;
      p[ix + 2] += (-up[2] * speed + Math.sin(this.t * 0.9 + i * 3) * drift) * dt;
      const rx = p[ix] - cam.x;
      const ry = p[ix + 1] - cam.y;
      const rz = p[ix + 2] - cam.z;
      const along = rx * up[0] + ry * up[1] + rz * up[2];
      if (along < -10 || Math.abs(rx) > RANGE || Math.abs(ry) > RANGE || Math.abs(rz) > RANGE) {
        const ox = (Math.random() * 2 - 1) * RANGE;
        const oy = (Math.random() * 2 - 1) * RANGE;
        const oz = (Math.random() * 2 - 1) * RANGE;
        const oAlong = ox * up[0] + oy * up[1] + oz * up[2];
        p[ix] = cam.x + ox + up[0] * (12 - oAlong);
        p[ix + 1] = cam.y + oy + up[1] * (12 - oAlong);
        p[ix + 2] = cam.z + oz + up[2] * (12 - oAlong);
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
