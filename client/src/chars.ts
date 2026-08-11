import * as THREE from "three";
import { MODEL_SCALES } from "../../shared/src/constants";
import { CHAR_CENTER_Y } from "../../shared/src/character";
import type { PlayerInfo } from "../../shared/src/protocol";
import { WEAPONS } from "../../shared/src/weapons";
import { loadModel, loadModelWithClips, loadSurvivalModel } from "./assets";

interface CharEntry {
  root: THREE.Group;
  hpFill?: THREE.Sprite;
  mixer?: THREE.AnimationMixer;
  actions?: Record<string, THREE.AnimationAction>;
  activeAction?: string;
  armRight?: THREE.Object3D;
  weaponModel?: THREE.Object3D;
  weaponId?: string;
  aimPitch?: number;
  lastPos?: THREE.Vector3;
  smoothedSpeed: number;
  /** First-person: keep the own model invisible even as transforms arrive. */
  hidden?: boolean;
}

const HP_BAR_WIDTH = 1.4;
const LABEL_COLOR = "#ffd166";
const HP_COLOR = "#7ae582";

/**
 * Every character in the scene: skin model + Kenney node animations
 * (idle/walk/sprint crossfaded by observed speed), a blaster parented to the
 * right arm, and for remotes a depth-tested name label + HP bar.
 */
export class CharVisuals {
  private scene: THREE.Scene;
  private entries = new Map<string, CharEntry>();
  private crates = new Map<string, { root: THREE.Group; weapon: THREE.Object3D | null }>();
  private clock = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  async ensure(info: PlayerInfo, isSelf = false): Promise<void> {
    if (this.entries.has(info.id)) return;
    const root = new THREE.Group();
    const entry: CharEntry = { root, smoothedSpeed: 0 };
    this.entries.set(info.id, entry); // reserve before await to avoid double-add

    const { root: model, clips } = await loadModelWithClips("characters", info.skin || "character-a");
    const scale = MODEL_SCALES.characters;
    model.scale.setScalar(scale);
    // Physics pose is the capsule CENTER; the model's origin is at its feet.
    model.position.y = -CHAR_CENTER_Y;
    root.add(model);

    entry.mixer = new THREE.AnimationMixer(model);
    entry.actions = {};
    for (const name of ["idle", "walk", "sprint", "die"]) {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (clip) entry.actions[name] = entry.mixer.clipAction(clip);
    }
    entry.actions.idle?.play();
    entry.activeAction = "idle";
    entry.armRight = model.getObjectByName("arm-right") ?? undefined;
    entry.aimPitch = 0; // every armed character holds the blaster at ready

    if (!isSelf) {
      const label = makeLabel(info.name, LABEL_COLOR);
      label.position.y = 1.55;
      root.add(label);

      const bg = makeBarSprite("rgba(12, 16, 26, 0.65)");
      bg.scale.set(HP_BAR_WIDTH, 0.13, 1);
      bg.position.y = 1.28;
      root.add(bg);
      const fill = makeBarSprite(HP_COLOR);
      fill.center.set(0, 0.5); // grow from the left edge
      fill.scale.set(HP_BAR_WIDTH, 0.13, 1);
      fill.position.set(-HP_BAR_WIDTH / 2, 1.28, 0.001);
      root.add(fill);
      entry.hpFill = fill;
    }

    root.visible = false; // until first transform arrives
    this.scene.add(root);
    this.setWeapon(info.id, "blaster");
  }

  /** Attach (or swap) the held blaster under the right arm. */
  async setWeapon(id: string, weaponId: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.weaponId === weaponId) return;
    entry.weaponId = weaponId;
    const w = WEAPONS[weaponId];
    const gun = await loadModel("blasters", w?.model ?? "blaster-a");
    if (entry.weaponId !== weaponId) return; // superseded while loading
    if (entry.weaponModel) entry.weaponModel.parent?.remove(entry.weaponModel);
    // Snipers carry their scope perched on the barrel.
    if (w?.scopeModel) {
      const scope = await loadModel("blasters", w.scopeModel);
      scope.position.set(0, 0.16, 0.05);
      gun.add(scope);
    }
    // The arm pivot is the shoulder; hang the blaster near the hand. The arm
    // meshes are in the model's NATIVE scale space (parented under the
    // scaled root), so offsets here are native units (model is 2.7 tall).
    gun.scale.setScalar(1 / MODEL_SCALES.characters); // counter the root scale
    gun.position.set(0, -0.85, 0.35);
    gun.rotation.x = -Math.PI / 2; // muzzle points away from the body when the arm raises
    entry.weaponModel = gun;
    (entry.armRight ?? entry.root).add(gun);
  }

  setHp(id: string, frac: number): void {
    const fill = this.entries.get(id)?.hpFill;
    if (fill) fill.scale.x = Math.max(0.001, Math.min(1, frac)) * HP_BAR_WIDTH;
  }

  /** Own aim pitch (raises/lowers the shooting arm). */
  setAimPitch(id: string, pitch: number): void {
    const e = this.entries.get(id);
    if (e) e.aimPitch = pitch;
  }

  setTransform(id: string, p: [number, number, number], q: [number, number, number, number]): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.root.visible = !e.hidden;
    e.root.position.set(p[0], p[1], p[2]);
    e.root.quaternion.set(q[0], q[1], q[2], q[3]);
  }

  /** Hide/show regardless of incoming transforms (first-person own model). */
  setHidden(id: string, hidden: boolean): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.hidden = hidden;
    if (hidden) e.root.visible = false;
  }

  /** Advance animations; call once per frame. Speed drives idle/walk/sprint. */
  tick(dt: number): void {
    this.clock += dt;
    for (const e of this.entries.values()) {
      if (!e.mixer || !e.root.visible) continue;
      // observed horizontal speed (m/s) from frame-to-frame movement
      if (!e.lastPos) e.lastPos = e.root.position.clone();
      const dist = Math.hypot(e.root.position.x - e.lastPos.x, e.root.position.z - e.lastPos.z);
      e.lastPos.copy(e.root.position);
      const speed = dt > 0 ? dist / dt : 0;
      e.smoothedSpeed += (speed - e.smoothedSpeed) * Math.min(1, dt * 10);

      const want = e.smoothedSpeed > 6.5 ? "sprint" : e.smoothedSpeed > 0.6 ? "walk" : "idle";
      if (want !== e.activeAction && e.actions?.[want]) {
        const from = e.actions[e.activeAction ?? "idle"];
        const to = e.actions[want];
        to.reset().play();
        from?.crossFadeTo(to, 0.18, false);
        e.activeAction = want;
      }
      e.mixer.update(dt);
      // Aim overrides the animated right arm AFTER the mixer writes it:
      // raise the arm level and tilt it with the aim pitch.
      if (e.armRight && e.aimPitch !== undefined) {
        e.armRight.rotation.x = -Math.PI / 2 - e.aimPitch;
      }
    }
    // weapon crates: spin + bob the floating pickup
    for (const c of this.crates.values()) {
      if (c.weapon) {
        c.weapon.rotation.y = this.clock * 1.5;
        c.weapon.position.y = 0.9 + Math.sin(this.clock * 2) * 0.08;
      }
    }
  }

  /** The cargo ship sailing the open sea (no label). */
  async ensureShip(): Promise<void> {
    if (this.entries.has("ship")) return;
    const root = new THREE.Group();
    this.entries.set("ship", { root, smoothedSpeed: 0 });
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
    this.entries.set(id, { root, smoothedSpeed: 0 });
    const obj = await loadModel(pack, model);
    const scale = MODEL_SCALES[pack] ?? 1;
    obj.scale.setScalar(scale);
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.set(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
    root.add(obj);
    root.visible = false;
    this.scene.add(root);
  }

  /** Pickup point: crate base + the item floating above (gun / grenade /
   * survival-pack ammo cell / first-aid kit). */
  async ensureCrate(id: string, x: number, z: number, itemId: string): Promise<void> {
    if (this.crates.has(id)) return;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    this.crates.set(id, { root, weapon: null });
    this.scene.add(root);
    const crate = await loadModel("blasters", "crate-wide");
    crate.scale.setScalar(1.4);
    root.add(crate);
    let item: THREE.Object3D;
    if (itemId === "ammo") item = await loadSurvivalModel("Battery_Big", 0.55);
    else if (itemId === "health") item = await loadSurvivalModel("FirstAidKit", 0.5);
    else if (itemId === "grenade") {
      item = await loadModel("blasters", "grenade-a");
      item.scale.setScalar(2.2);
    } else {
      item = await loadModel("blasters", WEAPONS[itemId]?.model ?? "blaster-a");
      item.scale.setScalar(1.3);
    }
    const holder = new THREE.Group();
    holder.add(item);
    holder.position.y = 0.9;
    root.add(holder);
    this.crates.get(id)!.weapon = holder;
  }

  /** Armed crates show the floating weapon; rearming ones hide it. */
  setCrateArmed(id: string, armed: boolean): void {
    const c = this.crates.get(id);
    if (c?.weapon) c.weapon.visible = armed;
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
  return new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: true }),
  );
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: true }));
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}
