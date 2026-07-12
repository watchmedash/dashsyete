import * as THREE from "three";
import { CAR_MODEL_SCALE } from "../../shared/src/constants";
import type { PlayerInfo } from "../../shared/src/protocol";
import { TEAMS } from "../../shared/src/types";
import { MODEL_SCALES } from "../../shared/src/constants";
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

  /** The decorative perimeter train: locomotive + a trailing carriage, no label. */
  async ensureTrain(): Promise<void> {
    if (this.entries.has("train")) return;
    const root = new THREE.Group();
    this.entries.set("train", { root });
    const scale = MODEL_SCALES.train;
    const loco = await loadModel("train", "train-locomotive-a");
    loco.scale.setScalar(scale);
    loco.position.y = -2.5; // body pose is the collider center, models sit on rails
    root.add(loco);
    const carriage = await loadModel("train", "train-carriage-box");
    carriage.scale.setScalar(scale);
    carriage.position.set(0, -2.5, -8.5);
    root.add(carriage);
    root.visible = false;
    this.scene.add(root);
  }

  async ensure(info: PlayerInfo): Promise<void> {
    if (this.entries.has(info.id)) return;
    const root = new THREE.Group();
    this.entries.set(info.id, { root }); // reserve before await to avoid double-add

    const model = await loadModel("cars", info.car || "sedan");
    model.scale.setScalar(CAR_MODEL_SCALE);
    root.add(model);

    const color = TEAMS[info.team].color;

    // Team underglow ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.2, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    root.add(ring);

    // Name label sprite
    const label = makeLabel(info.name, color);
    label.position.y = 3.2;
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
  ctx.fillStyle = color;
  roundRect(ctx, 0, 0, 256, 64, 16);
  ctx.fill();
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, 128, 34, 236);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(4.5, 1.15, 1);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
