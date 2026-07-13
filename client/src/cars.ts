import * as THREE from "three";
import { CAR_MODEL_SCALE } from "../../shared/src/constants";
import type { PlayerInfo } from "../../shared/src/protocol";
import { TEAMS } from "../../shared/src/types";
import { MODEL_SCALES } from "../../shared/src/constants";
import { CHASSIS_HALF, WHEEL_RADIUS, WHEEL_REST } from "../../shared/src/vehicle";
import { loadModel } from "./assets";

interface CarEntry {
  root: THREE.Group;
  hpFill?: THREE.Sprite;
}

const HP_BAR_WIDTH = 2.4;

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

  async ensure(info: PlayerInfo, isSelf = false): Promise<void> {
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

    // Name label + team-colored HP bar. You never see your own (the HUD bar
    // covers you), and buildings occlude others' (depth-tested sprites).
    if (!isSelf) {
      const label = makeLabel(info.name, TEAMS[info.team].color);
      label.position.y = 2.9;
      root.add(label);

      const bg = makeBarSprite("rgba(12, 16, 26, 0.65)");
      bg.scale.set(HP_BAR_WIDTH, 0.22, 1);
      bg.position.y = 2.3;
      root.add(bg);
      const fill = makeBarSprite(TEAMS[info.team].color);
      fill.center.set(0, 0.5); // grow from the left edge
      fill.scale.set(HP_BAR_WIDTH, 0.22, 1);
      fill.position.set(-HP_BAR_WIDTH / 2, 2.3, 0.001);
      root.add(fill);
      this.entries.get(info.id)!.hpFill = fill;
    }

    root.visible = false; // until first transform arrives
    this.scene.add(root);
  }

  setHp(id: string, frac: number): void {
    const fill = this.entries.get(id)?.hpFill;
    if (fill) fill.scale.x = Math.max(0.001, Math.min(1, frac)) * HP_BAR_WIDTH;
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

function makeBarSprite(color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 8);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: true }),
  );
  return sprite;
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
  sprite.scale.set(4.0, 1.0, 1);
  return sprite;
}
