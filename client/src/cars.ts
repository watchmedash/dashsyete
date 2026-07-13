import * as THREE from "three";
import { CAR_MODEL_SCALE } from "../../shared/src/constants";
import type { PlayerInfo } from "../../shared/src/protocol";
import { TEAMS } from "../../shared/src/types";
import { MODEL_SCALES } from "../../shared/src/constants";
import { CHASSIS_HALF, WHEEL_RADIUS, WHEEL_REST } from "../../shared/src/vehicle";
import { loadModel } from "./assets";

interface CarEntry {
  root: THREE.Group;
}

/** Visual representation of every car: model + name label + team underglow. */
export class CarVisuals {
  private scene: THREE.Scene;
  private entries = new Map<string, CarEntry>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The cargo ship sailing the outer sea (no label). */
  async ensureShip(): Promise<void> {
    if (this.entries.has("ship")) return;
    const root = new THREE.Group();
    this.entries.set("ship", { root });
    const obj = await loadModel("watercraft", "ship-cargo-a");
    obj.scale.setScalar(MODEL_SCALES.watercraft);
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y = -(box.min.y + box.max.y) / 2; // center on the kinematic box
    root.add(obj);
    root.visible = false;
    this.scene.add(root);
  }

  /** A knockable prop (server-simulated); pose is the physics box CENTER. */
  async ensureProp(id: string, pack: string, model: string): Promise<void> {
    if (this.entries.has(id)) return;
    const root = new THREE.Group();
    this.entries.set(id, { root });
    const obj = await loadModel(pack, model);
    const scale = MODEL_SCALES[pack] ?? 1;
    obj.scale.setScalar(scale);
    // center the visual on the physics box center
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.set(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
    root.add(obj);
    root.visible = false;
    this.scene.add(root);
  }

  async ensure(info: PlayerInfo): Promise<void> {
    if (this.entries.has(info.id)) return;
    const root = new THREE.Group();
    this.entries.set(info.id, { root }); // reserve before await to avoid double-add

    const model = await loadModel("cars", info.car || "sedan");
    model.scale.setScalar(CAR_MODEL_SCALE);
    // The root tracks the physics chassis CENTER, which sits
    // WHEEL_REST + WHEEL_RADIUS + CHASSIS_HALF.y above the road; anchor the
    // visual so its wheels touch the road instead of clipping into it.
    const box = new THREE.Box3().setFromObject(model);
    model.position.y = -(WHEEL_REST + WHEEL_RADIUS + CHASSIS_HALF.y) - box.min.y;
    root.add(model);

    const color = TEAMS[info.team].color;

    // Name label sprite (outlined text in team color)
    const label = makeLabel(info.name, color);
    label.position.y = 2.6;
    root.add(label);

    root.visible = false; // until first transform arrives
    this.scene.add(root);
  }

  setTransform(id: string, p: [number, number, number], q: [number, number, number, number]): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.root.visible = true;
    e.root.position.set(p[0], p[1], p[2]);
    e.root.quaternion.set(q[0], q[1], q[2], q[3]);
  }

  setVisible(id: string, visible: boolean): void {
    const e = this.entries.get(id);
    if (e) e.root.visible = visible;
  }

  getPosition(id: string): THREE.Vector3 | null {
    const e = this.entries.get(id);
    return e ? e.root.position : null;
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.scene.remove(e.root);
    this.entries.delete(id);
  }
}

function makeLabel(name: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(10, 12, 18, 0.9)";
  ctx.strokeText(name, 128, 34, 240);
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 34, 240);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(4.0, 1.0, 1);
  return sprite;
}
