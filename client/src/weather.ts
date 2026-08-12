// Planet weather: a slow cycle of clear / fog / rain / snow. Fog is
// exponential and animated; precipitation is a recycled particle field
// falling along the LOCAL face up (so rain falls "down" on every side of
// the cube). Purely visual — no gameplay effect.
import * as THREE from "three";
import type { V3 } from "../../shared/src/gravity";

type WState = "clear" | "fog" | "rain" | "snow";
const CYCLE_S = 100; // one weather state lasts this long
const PATTERN: WState[] = ["clear", "fog", "rain", "clear", "snow", "clear", "rain", "fog"];

const DENSITY: Record<WState, number> = { clear: 0.0028, fog: 0.028, rain: 0.010, snow: 0.014 };
const SKY: Record<WState, number> = { clear: 0x87b8e8, fog: 0x9aa4b0, rain: 0x6e7a8c, snow: 0xaab4c2 };

const COUNT = 900;
const RANGE = 26; // particles live in a box this size around the camera

export class Weather {
  private scene: THREE.Scene;
  private points: THREE.Points;
  private pos: Float32Array;
  private mat: THREE.PointsMaterial;
  private fog: THREE.FogExp2;
  private skyColor = new THREE.Color(0x87b8e8);
  private targetSky = new THREE.Color(0x87b8e8);
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2(0x87b8e8, DENSITY.clear);
    scene.fog = this.fog;
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
  }

  state(): WState {
    return PATTERN[Math.floor(this.t / CYCLE_S) % PATTERN.length];
  }

  tick(dt: number, cam: THREE.Vector3, up: V3): void {
    this.t += dt;
    const st = this.state();
    // fade fog density + sky tint toward the state targets
    this.fog.density += (DENSITY[st] - this.fog.density) * Math.min(1, dt * 0.4);
    this.targetSky.setHex(SKY[st]);
    this.skyColor.lerp(this.targetSky, Math.min(1, dt * 0.4));
    this.fog.color.copy(this.skyColor);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.skyColor);

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
      // fall along -up, with a little tangential drift
      p[ix] += (-up[0] * speed + Math.sin(this.t * 1.3 + i) * drift) * dt;
      p[ix + 1] += (-up[1] * speed + Math.cos(this.t * 1.1 + i * 2) * drift) * dt;
      p[ix + 2] += (-up[2] * speed + Math.sin(this.t * 0.9 + i * 3) * drift) * dt;
      // recycle particles that fell too far below (or drifted out of range)
      const rx = p[ix] - cam.x;
      const ry = p[ix + 1] - cam.y;
      const rz = p[ix + 2] - cam.z;
      const along = rx * up[0] + ry * up[1] + rz * up[2];
      if (along < -10 || Math.abs(rx) > RANGE || Math.abs(ry) > RANGE || Math.abs(rz) > RANGE) {
        // respawn above the camera in the local frame
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
