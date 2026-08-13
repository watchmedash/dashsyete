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
  shield?: THREE.Mesh;
  shieldUntil?: number;
  /** Name + HP-bar sprites (distance-faded in tick). */
  overhead?: THREE.Sprite[];
  /** Accumulated un-stepped animation time (distance LOD batches it). */
  animLag?: number;
  /** Submerged: overhead label/HP hidden (underwater is a HIDING spot). */
  underwater?: boolean;
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
  private crates = new Map<string, { root: THREE.Group; weapon: THREE.Object3D | null; itemId?: string; beacon?: THREE.Mesh }>();
  /** Shared open-ended cylinder for pickup beacons. */
  private beaconGeo = new THREE.CylinderGeometry(0.2, 0.34, 5, 8, 1, true);
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
    // Sink an extra 5 cm (the controller's hover offset) so feet PLANT on
    // the ground instead of reading as floating.
    model.position.y = -CHAR_CENTER_Y - 0.05;
    root.add(model);

    entry.mixer = new THREE.AnimationMixer(model);
    entry.actions = {};
    for (const name of ["idle", "walk", "sprint", "die"]) {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) continue;
      // STRIP ROOT MOTION from movement clips: walk/sprint carry a
      // "root.position" translation track that shoves the whole body around
      // on top of the network-driven position — reads as run shake. Legs and
      // arms still animate; the body stays glued to the capsule.
      if (name === "walk" || name === "sprint") {
        clip.tracks = clip.tracks.filter((t) => t.name !== "root.position");
      }
      entry.actions[name] = entry.mixer.clipAction(clip);
    }
    entry.actions.idle?.play();
    entry.activeAction = "idle";
    entry.armRight = model.getObjectByName("arm-right") ?? undefined;
    entry.aimPitch = 0; // every armed character holds the blaster at ready

    if (!isSelf) {
      const label = makeLabel(info.name, LABEL_COLOR);
      label.position.y = 1.75; // above the 1.9 m character (root = capsule center)
      root.add(label);

      const bg = makeBarSprite("rgba(12, 16, 26, 0.65)");
      bg.scale.set(HP_BAR_WIDTH, 0.13, 1);
      bg.position.y = 1.48;
      root.add(bg);
      const fill = makeBarSprite(HP_COLOR);
      fill.center.set(0, 0.5); // grow from the left edge
      fill.scale.set(HP_BAR_WIDTH, 0.13, 1);
      fill.position.set(-HP_BAR_WIDTH / 2, 1.48, 0.001);
      root.add(fill);
      entry.hpFill = fill;
      entry.overhead = [label, bg, fill];
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
    // grip sits IN the hand at the arm's end (arm pivot = shoulder; the
    // blocky arm is ~1.1 native units long)
    gun.position.set(0, -1.1, 0.2);
    // muzzle (-z) along the raised arm, then rolled 180° so the scope/top
    // faces up — without the roll the gun hangs upside down
    gun.rotation.set(-Math.PI / 2, 0, Math.PI);
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

  /** Play the one-shot death animation (holds the final pose). */
  playDeath(id: string): void {
    const e = this.entries.get(id);
    const die = e?.actions?.die;
    if (!e || !die) return;
    die.reset();
    die.setLoop(THREE.LoopOnce, 1);
    die.clampWhenFinished = true;
    die.play();
    e.actions?.[e.activeAction ?? "idle"]?.crossFadeTo(die, 0.1, false);
    e.activeAction = "die";
  }

  setTransform(id: string, p: [number, number, number], q: [number, number, number, number]): void {
    const e = this.entries.get(id);
    if (!e) return;
    // Respawn: a hidden dead character coming back should stand up again.
    if (e.activeAction === "die" && !e.root.visible && !e.hidden && e.actions?.idle) {
      const idle = e.actions.idle;
      idle.reset().play();
      e.actions.die?.crossFadeTo(idle, 0.1, false);
      e.activeAction = "idle";
    }
    e.root.visible = !e.hidden;
    e.root.position.set(p[0], p[1], p[2]);
    e.root.quaternion.set(q[0], q[1], q[2], q[3]);
  }

  /** Spawn-protection shimmer: a translucent bubble for `seconds`. */
  showSpawnShield(id: string, seconds: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (!e.shield) {
      // own material instance per character — never tint a shared skin material
      e.shield = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.62, 2),
        new THREE.MeshBasicMaterial({
          color: 0x7fd0ff,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      e.root.add(e.shield);
    }
    e.shield.visible = true;
    e.shieldUntil = this.clock + seconds;
  }

  /** Flying characters hold the idle pose — no running legs in mid-air. */
  setFlying(id: string, flying: boolean): void {
    const e = this.entries.get(id) as { flying?: boolean } | undefined;
    if (e) e.flying = flying;
  }

  /** Hide/show regardless of incoming transforms (first-person own model). */
  setHidden(id: string, hidden: boolean): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.hidden = hidden;
    if (hidden) e.root.visible = false;
  }

  /** Advance animations; call once per frame. Speed drives idle/walk/sprint.
   * `camPos` fades name labels / HP bars with distance (full ≤22 m, gone
   * ≥38 m) so far-off nameplates don't clutter the whole face. */
  tick(dt: number, camPos?: THREE.Vector3): void {
    this.clock += dt;
    for (const e of this.entries.values()) {
      if (!e.mixer || !e.root.visible) continue;
      let stepDt = dt;
      if (camPos) {
        const d = e.root.position.distanceTo(camPos);
        if (e.overhead) {
          const a = e.underwater ? 0 : Math.max(0, Math.min(1, (38 - d) / 16));
          for (const s of e.overhead) {
            s.visible = a > 0.02;
            s.material.opacity = a;
          }
        }
        // ANIMATION LOD: characters past 60 m are a few pixels — advance
        // their mixers in ~8 Hz batches instead of every frame (49 bots of
        // full-rate node animation was pure wasted CPU)
        if (d > 60) {
          e.animLag = (e.animLag ?? 0) + dt;
          if (e.animLag < 0.12) continue;
          stepDt = e.animLag;
          e.animLag = 0;
        }
      }
      // observed horizontal speed (m/s) from frame-to-frame movement
      if (!e.lastPos) e.lastPos = e.root.position.clone();
      const dist = Math.hypot(e.root.position.x - e.lastPos.x, e.root.position.z - e.lastPos.z);
      e.lastPos.copy(e.root.position);
      const speed = stepDt > 0 ? dist / stepDt : 0;
      e.smoothedSpeed += (speed - e.smoothedSpeed) * Math.min(1, stepDt * 10);

      const flying = (e as { flying?: boolean }).flying;
      const want = flying ? "idle" : e.smoothedSpeed > 6.5 ? "sprint" : e.smoothedSpeed > 0.6 ? "walk" : "idle";
      if (e.activeAction !== "die" && want !== e.activeAction && e.actions?.[want]) {
        const from = e.actions[e.activeAction ?? "idle"];
        const to = e.actions[want];
        to.reset().play();
        from?.crossFadeTo(to, 0.18, false);
        e.activeAction = want;
      }
      e.mixer.update(stepDt);
      // Aim overrides the animated right arm AFTER the mixer writes it.
      // Replace the FULL rotation: the walk clip writes quaternions, and
      // overriding only .x leaves its y/z components thrashing every frame
      // (the "gun glitching while running").
      if (e.armRight && e.aimPitch !== undefined) {
        e.armRight.rotation.set(-Math.PI / 2 - e.aimPitch, 0, 0);
      }
    }
    // spawn-protection bubbles: gentle pulse, fade out over the last 0.5 s
    for (const e of this.entries.values()) {
      if (!e.shield || !e.shield.visible) continue;
      const left = (e.shieldUntil ?? 0) - this.clock;
      if (left <= 0) {
        e.shield.visible = false;
        continue;
      }
      const s = 1 + Math.sin(this.clock * 7) * 0.05;
      e.shield.scale.setScalar(s);
      (e.shield.material as THREE.MeshBasicMaterial).opacity = 0.22 * Math.min(1, left / 0.5);
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

  /** Pickup point: the item alone, floating and spinning — no crate box
   * (user decision: guns and items just float). */
  async ensureCrate(id: string, x: number, y: number, z: number, itemId: string): Promise<void> {
    if (this.crates.has(id)) return;
    const root = new THREE.Group();
    root.position.set(x, y, z);
    this.crates.set(id, { root, weapon: null });
    this.scene.add(root);
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
    holder.position.y = 0.6;
    root.add(holder);
    // faint beacon column so pickups read from across the field — color says
    // what's inside (health green / ammo blue / grenades red / guns gold)
    const beaconColor =
      itemId === "health" ? 0x7ae582 : itemId === "ammo" ? 0x6db4ff : itemId === "grenade" ? 0xff6b5e : 0xffd166;
    const beacon = new THREE.Mesh(
      this.beaconGeo,
      new THREE.MeshBasicMaterial({
        color: beaconColor,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    beacon.position.y = 2.9;
    root.add(beacon);
    const entry = this.crates.get(id);
    if (!entry) {
      this.scene.remove(root); // crate vanished while the model streamed in
      return;
    }
    entry.weapon = holder;
    entry.beacon = beacon;
  }

  /** DROPPED gun: just the floating weapon, hovering low — no crate box
   * (crate boxes mean rearming stations; a drop is a loose gun). */
  async ensureDrop(id: string, x: number, y: number, z: number, weaponId: string): Promise<void> {
    const prev = this.crates.get(id);
    if (prev) {
      if (prev.itemId === weaponId) return;
      this.scene.remove(prev.root); // swapped-in-place drop: rebuild the model
      this.crates.delete(id);
    }
    const root = new THREE.Group();
    root.position.set(x, y, z);
    this.crates.set(id, { root, weapon: null, itemId: weaponId });
    this.scene.add(root);
    const item = await loadModel("blasters", WEAPONS[weaponId]?.model ?? "blaster-a");
    item.scale.setScalar(1.3);
    const holder = new THREE.Group();
    holder.add(item);
    holder.position.y = 0.35;
    root.add(holder);
    // slimmer, fainter beacon than crates — a dropped gun is a brief window
    const beacon = new THREE.Mesh(
      this.beaconGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    beacon.scale.set(0.6, 0.6, 0.6);
    beacon.position.y = 1.8;
    root.add(beacon);
    const entry = this.crates.get(id);
    if (!entry) {
      this.scene.remove(root); // drop expired/was taken while the model streamed in
      return;
    }
    entry.weapon = holder;
    entry.beacon = beacon;
  }

  /** Armed crates show the floating weapon; rearming ones hide it. */
  /** Fired when a crate flips from rearming back to armed (with its position). */
  onCrateRearmed: ((p: THREE.Vector3) => void) | null = null;

  /** Submerged characters hide their label + HP bar (water = hiding spot). */
  setUnderwater(id: string, under: boolean): void {
    const e = this.entries.get(id);
    if (e) e.underwater = under;
  }

  setCrateArmed(id: string, armed: boolean): void {
    const c = this.crates.get(id);
    if (!c?.weapon) return;
    if (armed && !c.weapon.visible) this.onCrateRearmed?.(c.root.position);
    c.weapon.visible = armed;
    if (c.beacon) c.beacon.visible = armed;
  }

  /** Align a crate with its planet face (crates on walls/ceilings). */
  orientCrate(id: string, q: [number, number, number, number]): void {
    const c = this.crates.get(id);
    if (c) c.root.quaternion.set(q[0], q[1], q[2], q[3]);
  }

  /** World position of a character's gun muzzle (dart visual origin). */
  private gunTip = new THREE.Vector3();
  getGunTip(id: string): THREE.Vector3 | null {
    const e = this.entries.get(id);
    if (!e?.weaponModel || !e.root.visible) return null;
    return e.weaponModel.getWorldPosition(this.gunTip);
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
    // crates/drops live in their own map (models are loader-cache shared)
    const c = this.crates.get(id);
    if (c) {
      this.scene.remove(c.root);
      this.crates.delete(id);
    }
    const e = this.entries.get(id);
    if (!e) return;
    this.scene.remove(e.root);
    // Free per-entry GPU resources. Model geometry/materials are SHARED with
    // the loader cache (never dispose those); only the label/HP sprites (a
    // fresh CanvasTexture each) and the shield bubble are ours alone.
    e.root.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    if (e.shield) {
      e.shield.geometry.dispose();
      (e.shield.material as THREE.Material).dispose();
    }
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
