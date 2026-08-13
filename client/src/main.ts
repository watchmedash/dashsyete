import * as THREE from "three";
import { MAX_HP, SPAWN_PROTECTION_S, TICK_DT } from "../../shared/src/constants";
import { WEAPONS, DEFAULT_WEAPON, GRENADE } from "../../shared/src/weapons";
import { segmentCapsuleHit } from "../../shared/src/projectiles";
import { EYE_HEIGHT, GRAVITY } from "../../shared/src/character";
import { tileToWorld } from "../../shared/src/cityMap";
import { buildSkyWorld, BUILD_REACH, B_BUILD, B_WATER, PLANET_R } from "../../shared/src/skyMap";
import { HARDNESS, VoxelWorld } from "../../shared/src/voxel";
import { basis, carryYaw, dirFromYawPitch, faceUp, quatFace, type V3 } from "../../shared/src/gravity";
import type { InputState, PlayerInfo } from "../../shared/src/protocol";
import { buildCity } from "./city";
import { VoxelRenderer, blockMaterial, crackTextures } from "./voxelRender";
import { Weather, faceIndexOfUp } from "./weather";
import { CharVisuals } from "./chars";
import { DartVisuals } from "./darts";
import { ShooterCamera } from "./camera";
import { KeyboardInput } from "./input";
import { TouchInput } from "./touch";
import { Interpolator } from "./interp";
import { stickToMove } from "./joystick";
import { AimLook } from "./look";
import { Net } from "./net";
import { LocalPrediction } from "./prediction";
import { Sfx } from "./sfx";
import { Hud } from "./ui/hud";
import { showJoinScreen } from "./ui/join";
import "./ui/style.css";

/** Block id → footstep timbre (unlisted ids read as hard stone). */
const FOOT_SURFACE: Record<number, "grass" | "dirt" | "sand" | "snow" | "ice" | "hard"> = {
  1: "grass", 14: "grass", 5: "grass", 16: "grass", 17: "grass",
  2: "dirt", 7: "sand", 8: "snow", 9: "ice",
};

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// Filmic response curve: rolls highlights off gently instead of clipping,
// deepens midtone contrast — the single cheapest "looks like a real game" win.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 400, 1200);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 150, 220);
camera.lookAt(0, 0, 0);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function start() {
  // Map builder: ?editor opens the interactive MegaKit map editor.
  if (new URLSearchParams(location.search).has("editor")) {
    const { startEditor } = await import("./editor/editor");
    startEditor(renderer, camera);
    return;
  }

  // Debug cast sheet: ?skins renders all 18 characters in a row for naming/QA.
  if (new URLSearchParams(location.search).has("skins")) {
    const { PLAYABLE_SKINS, MODEL_SCALES } = await import("../../shared/src/constants");
    const { loadModel } = await import("./assets");
    scene.background = new THREE.Color(0xeef1f6);
    scene.fog = null;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde6, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    scene.add(key);
    for (let i = 0; i < PLAYABLE_SKINS.length; i++) {
      const m = await loadModel("characters", PLAYABLE_SKINS[i]);
      m.scale.setScalar(MODEL_SCALES.characters);
      m.position.set((i % 9) * 1.5 - 6, i < 9 ? 2.4 : 0, 0);
      scene.add(m);
    }
    // three blasters at the left edge, rot 0: +z faces the camera
    for (const [i, b] of ["blaster-a", "blaster-f", "blaster-r"].entries()) {
      const g = await loadModel("blasters", b);
      g.scale.setScalar(2);
      g.position.set(-8 + i * 1.6, 4.6, 2);
      g.rotation.y = Math.PI / 4; // quarter-view so the barrel direction is visible
      scene.add(g);
    }
    camera.position.set(0, 2.1, 10.5);
    camera.lookAt(0, 2.1, 0);
    renderer.setAnimationLoop(() => renderer.render(scene, camera));
    return;
  }

  // Debug fly-over: ?fly renders just the city with a high orbit camera
  // (?fly=x,z,h,d parks the camera at x,z from height h looking down at distance d).
  const fly = new URLSearchParams(location.search).get("fly");
  if (fly !== null) {
    const flyMap = await buildCity(scene);
    if (flyMap.vox) {
      const { buildSkyWorld: bsw } = await import("../../shared/src/skyMap");
      const { VoxelRenderer: VR } = await import("./voxelRender");
      new VR(scene, bsw(flyMap.vox.seed).world).buildAll();
    }
    // debug hook: render from a viewpoint and copy the frame into a DOM image
    // so screenshots work in occluded windows (compositor never presents there)
    (window as unknown as { __cap?: unknown }).__cap = (
      x: number, y: number, z: number, tx = 0, ty = 0, tz = 0,
    ) => {
      camera.position.set(x, y, z);
      camera.lookAt(tx, ty, tz);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL("image/png");
      let img = document.getElementById("__capimg") as HTMLImageElement | null;
      if (!img) {
        img = document.createElement("img");
        img.id = "__capimg";
        img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;object-fit:cover";
        document.body.appendChild(img);
      }
      img.src = url;
      return "captured";
    };
    const [fx, fz, fh, fd] = fly.split(",").map(Number);
    const clock = new THREE.Clock();
    let angle = 0;
    renderer.setAnimationLoop(() => {
      if (Number.isFinite(fx)) {
        camera.position.set(fx, fh || 60, fz + (fd || 60));
        camera.lookAt(fx, 0, fz);
      } else {
        angle += clock.getDelta() * 0.08;
        camera.position.set(Math.cos(angle) * 420, 300, Math.sin(angle) * 420);
        camera.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
    });
    return;
  }

  const net = new Net();
  const visuals = new CharVisuals(scene);
  const dartsFx = new DartVisuals(scene);
  const interp = new Interpolator();
  const keyboard = new KeyboardInput(renderer.domElement);
  const touch = new TouchInput();
  const shooterCam = new ShooterCamera(camera);
  const look = new AimLook();
  look.attach(renderer.domElement);
  const hud = new Hud();
  hud.onUnstuck = () => net.sendUnstuck();
  const sfx = new Sfx();

  // V cycles the perspective: 3rd-back → 1st-person → 3rd-front (selfie).
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyV" && myId) {
      const mode = shooterCam.cycleMode();
      visuals.setHidden(myId, mode === "first");
      viewmodel.visible = mode === "first";
      hud.setCrosshairVisible(mode !== "third-front"); // no aiming at yourself
    }
  });
  (window as unknown as { __cam?: unknown }).__cam = () => shooterCam.mode; // debug hook

  if (touch.active) {
    // Lighter rendering on touch devices
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  let seq = 0;
  // Converged aim (kept in sync with what the last input sent): darts leave
  // the right hand, so firing PARALLEL to the camera ray lands 0.3 m beside
  // the crosshair forever. Instead, cast the camera ray into the (predicted)
  // world and aim the dart from the muzzle AT that point — the wire yaw/pitch
  // carry the converged direction, so the server needs no camera knowledge.
  const aim = { yaw: 0, pitch: 0 };
  const convergeAim = (): void => {
    aim.yaw = look.yaw;
    aim.pitch = look.pitch;
    const t = prediction.getTransform();
    if (!t) return;
    // everything in the local FACE FRAME (identical to before off the planet)
    const up = myUp;
    const { t1, t2 } = basis(up);
    const d = dirFromYawPitch(look.yaw, look.pitch, up);
    // camera-ray origin: the ACTUAL pivot of the current camera mode
    // (first person = center eye; third-back = over the right shoulder)
    const shoulder = shooterCam.mode === "third-back" ? 0.45 : 0;
    const cosY = Math.cos(look.yaw);
    const sinY = Math.sin(look.yaw);
    // -right (screen-right of the character), see camera.ts
    const sx = -(t1[0] * cosY - t2[0] * sinY) * shoulder;
    const sy = -(t1[1] * cosY - t2[1] * sinY) * shoulder;
    const sz = -(t1[2] * cosY - t2[2] * sinY) * shoulder;
    const px = t.p[0] + sx + up[0] * EYE_HEIGHT;
    const py = t.p[1] + sy + up[1] * EYE_HEIGHT;
    const pz = t.p[2] + sz + up[2] * EYE_HEIGHT;
    let hitDist = prediction.cameraBlock([px, py, pz], d, 120) ?? 120;
    // players under the crosshair take priority over the wall behind them
    for (const [id] of players) {
      if (id === myId) continue;
      const rp = visuals.getPosition(id);
      if (!rp) continue;
      const rup = faceUp([rp.x, rp.y, rp.z], null, planetMode);
      const hc = segmentCapsuleHit([px, py, pz], d, hitDist, [rp.x, rp.y, rp.z], rup);
      if (hc !== null && hc < hitDist) hitDist = hc;
    }
    if (hitDist < 1.0) return; // melee range
    const target: [number, number, number] = [px + d[0] * hitDist, py + d[1] * hitDist, pz + d[2] * hitDist];
    // server muzzle = center eye (mirror of handleFire)
    const vx = target[0] - (t.p[0] + up[0] * EYE_HEIGHT);
    const vy = target[1] - (t.p[1] + up[1] * EYE_HEIGHT);
    const vz = target[2] - (t.p[2] + up[2] * EYE_HEIGHT);
    if (vx * d[0] + vy * d[1] + vz * d[2] < 0.3) return;
    // decompose the corrected ray back into face-local yaw/pitch
    const upAmt = vx * up[0] + vy * up[1] + vz * up[2];
    const a1 = vx * t1[0] + vy * t1[1] + vz * t1[2];
    const a2 = vx * t2[0] + vy * t2[1] + vz * t2[2];
    aim.yaw = Math.atan2(a1, a2);
    aim.pitch = Math.max(-1.55, Math.min(1.55, Math.atan2(upAmt, Math.hypot(a1, a2))));
  };

  const readInput = (): InputState => {
    const kb = keyboard.current();
    let { moveX, moveZ } = kb;
    let { jump, fire } = kb;
    if (touch.active) {
      const stick = stickToMove(touch.jx, touch.jy);
      if (stick.moveX !== 0 || stick.moveZ !== 0) {
        moveX = stick.moveX;
        moveZ = stick.moveZ;
      }
      jump = jump || touch.jump;
      fire = fire || touch.fire;
    }
    // hotbar selection: number keys, mouse wheel, B toggles tool <-> gun
    // (4 slots: 1 gun, 2 destroy tool, 3 throwables, 4 blocks)
    if (kb.hotbar) selectHotbar(kb.hotbar);
    const wheel = keyboard.takeWheel();
    if (wheel !== 0) selectHotbar(((hotbarSel - 1 + Math.sign(wheel) + 4) % 4) + 1);
    if (kb.buildKey && !prevBuildKey) selectHotbar(hotbarSel === 2 || hotbarSel === 4 ? 1 : 2);
    prevBuildKey = kb.buildKey;
    convergeAim();
    return {
      seq: ++seq,
      moveX,
      moveZ,
      yaw: aim.yaw,
      aimPitch: aim.pitch,
      jump,
      sprint: kb.sprint || (touch.active && Math.hypot(touch.jx, touch.jy) > 0.95),
      // the gun only fires from its slot; tool/throwable/block use clicks
      fire: fire && hotbarSel === 1,
      nade: kb.nade || touch.nade || (hotbarSel === 3 && fire),
      swap: false, // single gun slot — nothing to swap
      sel: hotbarSel,
    };
  };
  (window as unknown as { __input?: unknown }).__input = readInput; // debug hook
  (window as unknown as { __pos?: unknown }).__pos = () => prediction.getTransform()?.p; // debug hook
  (window as unknown as { __ri?: unknown }).__ri = () => ({ ...renderer.info.render }); // debug hook
  (window as unknown as { __sceneStats?: unknown }).__sceneStats = () => {
    const byType: Record<string, number> = {};
    scene.traverse((o) => {
      byType[o.type] = (byType[o.type] ?? 0) + 1;
    });
    return byType;
  }; // debug hook
  (window as unknown as { __deep?: unknown }).__deep = () => {
    let draws = 0;
    let shadowDraws = 0;
    const worst: [string, number][] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
      if (!m.visible) return;
      const groups = (m.geometry?.groups?.length || 1) * (Array.isArray(m.material) ? 1 : 1);
      const g = Math.max(1, m.geometry?.groups?.length ?? 0);
      draws += g;
      if (m.castShadow) shadowDraws += g;
      if (g > 5) worst.push([m.name || o.parent?.name || "?", g]);
    });
    worst.sort((a, b) => b[1] - a[1]);
    return { draws, shadowDraws, estTotal: draws + shadowDraws, worst: worst.slice(0, 8) };
  }; // debug hook
  (window as unknown as { __scene?: unknown }).__scene = scene; // debug hook
  (window as unknown as { __aim?: unknown }).__aim = () => ({
    look: [+look.yaw.toFixed(3), +look.pitch.toFixed(3)],
    sent: [+aim.yaw.toFixed(3), +aim.pitch.toFixed(3)],
  }); // debug hook
  (window as unknown as { __look?: unknown }).__look = (yaw: number, pitch: number) => {
    look.yaw = yaw;
    look.pitch = pitch;
  }; // debug hook: drive the aim without pointer lock (headless testing)
  (window as unknown as { __vel?: unknown }).__vel = () => prediction.getVelocity(); // debug hook
  (window as unknown as { __pred?: unknown }).__pred = () => prediction.getDebug(); // debug hook

  let myId: string | null = null;
  // DROP-IN overlay: covers the gap between joining and the first
  // authoritative spawn snapshot (removed in the snapshot handler).
  let dropOverlay: HTMLDivElement | null = null;
  // Snap the camera up to the current face on the next frame (spawns).
  let snapCamUp = false;
  // Server game clock (drives the shared day/night cycle for all players).
  let srvTime = 0;
  let srvTimeAt = 0;
  let dropShownAt = 0; // overlay shows at least ~1 s so it reads as a screen
  const lookTmp = new THREE.Vector3();
  let myWeapon = DEFAULT_WEAPON;
  let myNades = 0;
  let myAmmo = -1;
  const players = new Map<string, PlayerInfo>();

  // First-person VIEWMODEL: your blaster in the bottom-right of the screen
  // (children of the camera render with it; the camera must be in the scene).
  scene.add(camera);
  const viewmodel = new THREE.Group();
  viewmodel.position.set(0.2, -0.22, -0.48);
  viewmodel.rotation.y = -0.18; // inward cant; muzzle (-z) recedes toward the dot
  viewmodel.scale.setScalar(0.55);
  viewmodel.visible = false; // hidden on the join menu — shown at spawn
  camera.add(viewmodel);
  let vmWeapon = "";
  let vmDip = 0; // 1 = fully lowered (draw animation), decays to 0
  let vmBobPhase = 0;
  let vmBobAmp = 0; // SMOOTHED bob amplitude — landings flicker the grounded
  // flag for a few frames, and a hard on/off amplitude reads as gun shake
  let vmKick = 0; // recoil impulse; purely visual, aim stays exact
  const updateViewmodel = async (weaponId: string) => {
    if (vmWeapon === weaponId) return;
    const isSwap = vmWeapon !== ""; // first load isn't a draw
    vmWeapon = weaponId;
    if (isSwap) {
      vmDip = 1;
      sfx.draw();
    }
    const { loadModel } = await import("./assets");
    const w = WEAPONS[weaponId] ?? WEAPONS[DEFAULT_WEAPON];
    const gun = await loadModel("blasters", w.model);
    if (vmWeapon !== weaponId) return; // superseded
    if (w.scopeModel) {
      const scope = await loadModel("blasters", w.scopeModel);
      scope.position.set(0, 0.16, 0.05);
      gun.add(scope);
    }
    gun.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    viewmodel.clear();
    viewmodel.add(gun);
  };
  void updateViewmodel(DEFAULT_WEAPON);

  const [prediction, cityMap] = await Promise.all([LocalPrediction.create(), buildCity(scene)]);
  hud.initMinimap(cityMap, tileToWorld);

  // v5 voxel sky world: seeded base for the menu backdrop, replaced by the
  // server's authoritative RLE (base + live edits) in the welcome.
  let voxWorld: VoxelWorld | null = null;
  let voxRenderer: VoxelRenderer | null = null;
  const planetMode = !!cityMap.vox?.planet;
  // my face up (chases my predicted position; +Y off the planet)
  let myUp: V3 = [0, 1, 0];
  const weather = planetMode ? new Weather(scene) : null;
  if (cityMap.vox) {
    voxWorld = buildSkyWorld(cityMap.vox.seed).world;
    voxRenderer = new VoxelRenderer(scene, voxWorld);
    voxRenderer.buildAll();
  }
  const syncVoxelsFromServer = (rle: string) => {
    if (!cityMap.vox) return;
    voxRenderer?.dispose();
    voxWorld = VoxelWorld.deserialize(rle);
    voxRenderer = new VoxelRenderer(scene, voxWorld);
    voxRenderer.buildAll();
    prediction.syncVoxels(rle);
  };

  let joinResolve: ((reason: string | null) => void) | null = null;

  net.onMsg = (msg) => {
    switch (msg.t) {
      case "reject":
        if (joinResolve) {
          joinResolve(msg.reason);
          joinResolve = null;
        } else {
          // unsolicited reject = a reconnect re-hello failed; don't leave a
          // zombie world running
          const b = document.createElement("div");
          b.className = "reconnect-banner";
          b.textContent = `Rejoin failed (${msg.reason}) — refresh the page`;
          document.body.appendChild(b);
        }
        break;
      case "welcome":
        // STALE-TAB GUARD: a tab that loaded an older bundle silently plays
        // old code (old physics, old HUD) no matter what ships. If the
        // server's build differs from ours, reload into the new one.
        // Dev exception: Vite bakes the hash at dev-server START, so after a
        // commit the dev client "mismatches" forever while HMR keeps its code
        // perfectly fresh — reloading/warning there is pure noise.
        if (msg.v && msg.v !== __BUILD_VERSION__ && !import.meta.env.DEV) {
          if (!sessionStorage.getItem("dash-reloaded-" + msg.v)) {
            sessionStorage.setItem("dash-reloaded-" + msg.v, "1");
            // seamless: rejoin automatically after the refresh
            sessionStorage.setItem("dash-rejoin", JSON.stringify(lastJoinChoice));
            location.reload();
            return;
          }
          // Reload didn't converge (cached bundle, CDN, old dist): the player
          // would silently play old physics/visuals. Say it out loud instead.
          const warn = document.createElement("div");
          warn.className = "stale-warn";
          warn.textContent = `Outdated game build (${__BUILD_VERSION__} vs server ${msg.v}) — press Ctrl+Shift+R to hard-refresh`;
          document.body.appendChild(warn);
        }
        joinResolve?.(null);
        joinResolve = null;
        // Reconnect welcome: drop players who left while we were gone (our
        // own old id included — the server minted us a new one).
        for (const id of [...players.keys()]) {
          if (!msg.players.some((p) => p.id === id)) {
            players.delete(id);
            visuals.remove(id);
            hud.removePlayer(id);
          }
        }
        myId = msg.id;
        hud.setMyId(myId);
        if (msg.vox) syncVoxelsFromServer(msg.vox);
        for (const p of msg.players) {
          players.set(p.id, p);
          visuals.ensure(p, p.id === myId);
        }
        visuals.setHidden(myId, shooterCam.mode === "first"); // default view
        hud.setCrosshairVisible(shooterCam.mode !== "third-front");
        hud.setPlayers([...players.values()]);
        hud.setScores(msg.scores);
        break;
      case "join":
        players.set(msg.player.id, msg.player);
        void visuals.ensure(msg.player).then(() => visuals.showSpawnShield(msg.player.id, SPAWN_PROTECTION_S));
        hud.upsertPlayer(msg.player);
        break;
      case "leave":
        players.delete(msg.id);
        visuals.remove(msg.id);
        hud.removePlayer(msg.id);
        break;
      case "snapshot": {
        interp.push(msg.time, msg.chars);
        srvTime = msg.time;
        srvTimeAt = performance.now();
        dartsFx.sync(msg.darts, performance.now() / 1000);
        // Props sync BEFORE correct(): the replay resimulates them alongside
        // our character, so the mirror stays coherent with the authoritative
        // state.
        prediction.syncProps(msg.chars);
        for (const c of msg.chars) {
          if (players.has(c.id)) lastHpById.set(c.id, c.hp);
          if (pendingSpawnFx.has(c.id) && players.has(c.id)) {
            pendingSpawnFx.delete(c.id);
            spawnBeam(c.p);
          }
          if (c.id === myId) {
            prediction.correct(c.p, c.q, c.v, msg.lastSeq, !!c.fly);
            visuals.setFlying(c.id, !!c.fly);
            if (dropOverlay) {
              // first authoritative spawn state: we're standing — reveal,
              // with the camera up SNAPPED to the spawn face (no upside-down
              // roll-in when the random spawn is on the far side)
              const el = dropOverlay;
              dropOverlay = null;
              // hold the screen ≥1 s so it reads as a real loading page
              const wait = Math.max(0, 1000 - (performance.now() - dropShownAt));
              setTimeout(() => {
                el.classList.add("hidden");
                setTimeout(() => el.remove(), 500);
              }, wait);
              snapCamUp = true;
              hud.show(); // the HUD belongs to the match, not the menu
              viewmodel.visible = shooterCam.mode === "first";
            }
            hud.setHp(c.hp);
            sfx.setCritical(c.hp > 0 && c.hp < 30); // heartbeat while near death
            visuals.setWeapon(c.id, c.weapon);
            // chirp on upgrades only (respawn resets to the default — no chirp)
            if ((c.weapon !== myWeapon && c.weapon !== DEFAULT_WEAPON) || (c.nades ?? 0) > myNades) sfx.pickup();
            myWeapon = c.weapon;
            myNades = c.nades ?? 0;
            myAmmo = c.ammo ?? -1;
            myBlocks = c.blocks ?? 0;
            void updateViewmodel(c.weapon);
          } else if (players.has(c.id)) {
            visuals.setHp(c.id, c.hp / MAX_HP);
            visuals.setWeapon(c.id, c.weapon);
            visuals.setFlying(c.id, !!c.fly);
            remoteWeapons.set(c.id, c.weapon);
          } else if (c.id.startsWith("crate-")) {
            visuals.ensureCrate(c.id, c.p[0], c.p[1], c.p[2], c.weapon);
            visuals.setCrateArmed(c.id, c.hp > 0);
            if (planetMode)
              visuals.orientCrate(c.id, quatFace(faceUp([c.p[0], c.p[1], c.p[2]], null, true)));
          } else if (c.id.startsWith("drop-")) {
            // loose gun on the ground — NO crate box
            visuals.ensureDrop(c.id, c.p[0], c.p[1], c.p[2], c.weapon);
            if (planetMode)
              visuals.orientCrate(c.id, quatFace(faceUp([c.p[0], c.p[1], c.p[2]], null, true)));
            seenDrops.add(c.id);
          }
        }
        // dropped guns vanish once grabbed/expired — remove their visuals
        for (const id of [...knownDrops]) {
          if (!seenDrops.has(id)) {
            visuals.remove(id);
            knownDrops.delete(id);
          }
        }
        for (const id of seenDrops) knownDrops.add(id);
        seenDrops.clear();
        break;
      }
      case "knockout":
        visuals.playDeath(msg.victimId);
        setTimeout(() => visuals.setVisible(msg.victimId, false), 900);
        hud.addKill(msg.attackerId, msg.victimId);
        hud.setScores(msg.scores);
        sfx.knockout(msg.victimId === myId || msg.attackerId === myId);
        if (msg.attackerId === myId && msg.victimId !== myId) {
          myStreak++;
          const label =
            myStreak === 2 ? "DOUBLE KNOCKOUT!"
            : myStreak === 3 ? "TRIPLE KNOCKOUT!"
            : myStreak === 4 ? "RAMPAGE!"
            : myStreak >= 5 ? "UNSTOPPABLE!" : null;
          if (label) {
            hud.showStreak(label);
            sfx.streak(Math.min(myStreak, 5));
          }
        }
        if (msg.victimId === myId) {
          myStreak = 0;
          deathCam = { pos: charPos.clone().setY(charPos.y + 0.5), killer: msg.attackerId || null, angle: look.yaw };
          prediction.reset();
          const kName = msg.attackerId && msg.attackerId !== myId ? players.get(msg.attackerId)?.name : undefined;
          const kWeapon = msg.attackerId ? remoteWeapons.get(msg.attackerId) : undefined;
          hud.showRespawnCountdown(kName, kName ? kWeapon : undefined);
        }
        break;
      case "respawn":
        if (msg.id === myId) {
          hud.hideRespawnCountdown();
          deathCam = null;
          viewmodel.visible = shooterCam.mode === "first";
          snapCamUp = true; // respawn face can be ANY side — arrive upright
        }
        visuals.showSpawnShield(msg.id, SPAWN_PROTECTION_S);
        pendingSpawnFx.add(msg.id); // materialize beam once the position arrives
        break;
      case "block": {
        // authoritative terrain edits: world + visuals + prediction physics
        if (!voxWorld) break;
        const touched = new Set<string>();
        for (const [x, y, z, b] of msg.e) {
          touched.add(voxWorld.set(x, y, z, b));
          prediction.applyBlock(x, y, z, b);
          // an edit EXPOSES neighbor cells — if they live in an adjacent
          // chunk, that chunk's mesh must rebuild too or the hole shows the
          // void ("transparent core" when mining across a chunk seam)
          touched.add(VoxelWorld.chunkOf(x + 1, y, z));
          touched.add(VoxelWorld.chunkOf(x - 1, y, z));
          touched.add(VoxelWorld.chunkOf(x, y + 1, z));
          touched.add(VoxelWorld.chunkOf(x, y - 1, z));
          touched.add(VoxelWorld.chunkOf(x, y, z + 1));
          touched.add(VoxelWorld.chunkOf(x, y, z - 1));
        }
        for (const k of touched) voxRenderer?.rebuildChunk(k);
        break;
      }
      case "damage":
        if (msg.attackerId === myId) {
          hud.hitMarker(msg.headshot);
          sfx.hitConfirm(msg.headshot);
          // floating DAMAGE NUMBER over the victim (delta vs last known hp)
          const prev = lastHpById.get(msg.id);
          const dmg = prev !== undefined ? Math.max(0, Math.round(prev - msg.hp)) : 0;
          const vp = visuals.getPosition(msg.id);
          if (dmg > 0 && vp) spawnDmgNumber(vp, dmg, !!msg.headshot);
        }
        lastHpById.set(msg.id, msg.hp);
        if (msg.id === myId) {
          sfx.hurt();
          // red arc toward the attacker (screen-up = camera yaw)
          const ap = msg.attackerId ? visuals.getPosition(msg.attackerId) : null;
          const mp = prediction.getTransform();
          if (ap && mp) {
            const bearing = Math.atan2(ap.x - mp.p[0], ap.z - mp.p[2]);
            hud.showDamageFrom(look.yaw - bearing);
          }
        }
        break;
    }
  };
  // AUTO-RECONNECT: a dropped socket silently freezes the world otherwise.
  // Show a banner, redial with backoff, and rejoin with the remembered key.
  let reconnecting = false;
  net.onClose = async () => {
    console.warn("disconnected");
    if (reconnecting || !myId) return; // menu-phase failures handled by join flow
    reconnecting = true;
    const banner = document.createElement("div");
    banner.className = "reconnect-banner";
    banner.textContent = "Connection lost — reconnecting…";
    document.body.appendChild(banner);
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
      try {
        await net.connect();
        const c = lastJoinChoice as { name: string; skin: string; key: string };
        net.sendHello(c.name, c.skin, c.key);
        banner.remove();
        reconnecting = false;
        return; // the welcome handler reconciles state
      } catch {
        banner.textContent = `Connection lost — reconnecting… (attempt ${attempt + 2})`;
      }
    }
    banner.textContent = "Connection lost — refresh the page to rejoin";
  };

  await net.connect();

  // Menu backdrop: a slow ground-level drift over ONE RANDOM FACE (a
  // different side every visit) instead of staring at the whole cube.
  {
    const menuClock = new THREE.Clock();
    const faces: V3[] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    const fn = faces[Math.floor(Math.random() * faces.length)];
    const { t1, t2 } = basis(fn);
    const nV = new THREE.Vector3(fn[0], fn[1], fn[2]);
    const t1V = new THREE.Vector3(t1[0], t1[1], t1[2]);
    const t2V = new THREE.Vector3(t2[0], t2[1], t2[2]);
    let drift = 0;
    renderer.setAnimationLoop(() => {
      drift += menuClock.getDelta();
      camera.up.copy(nV);
      camera.position
        .copy(nV)
        .multiplyScalar(PLANET_R + 20)
        .addScaledVector(t1V, Math.sin(drift * 0.05) * 62)
        .addScaledVector(t2V, Math.cos(drift * 0.038) * 62);
      lookTmp
        .copy(camera.position)
        .addScaledVector(nV, -14)
        .addScaledVector(t2V, 55);
      camera.lookAt(lookTmp);
      renderer.render(scene, camera);
    });
  }

  // Join loop: keep showing the join screen until the server accepts us
  // (a taken name without its key comes back as a reject message).
  let joinError: string | undefined;
  let lastJoinName = "";
  let lastJoinChoice: unknown = null;
  for (;;) {
    // a version-handshake reload mid-join resubmits automatically
    const pending = sessionStorage.getItem("dash-rejoin");
    let choice;
    if (pending && !joinError) {
      sessionStorage.removeItem("dash-rejoin");
      choice = JSON.parse(pending);
    } else {
      choice = await showJoinScreen(joinError);
    }
    lastJoinName = choice.name;
    lastJoinChoice = choice;
    // Loading screen goes up the moment DROP IN is pressed — it covers the
    // hello/welcome round-trip AND the pre-spawn limbo, and fades only once
    // the first authoritative spawn snapshot lands.
    if (!dropOverlay) {
      const tips = [
        "Double-jump on the grassland face to FLY. Sprint to boost.",
        "No health regen: health packs and knockouts (+50) heal you.",
        "The moon face: half gravity, huge jumps, soft landings.",
        "Grenades only cook AFTER they land. Lob them far.",
        "Underwater is a hiding spot, but you can't breathe forever.",
        "Every block you mine becomes a building block. Cap: 99.",
        "The desert never sleeps: eternal noon. The moon face: eternal night.",
        "Snipers hit full damage at ANY range. Watch the long rifles.",
      ];
      dropOverlay = document.createElement("div");
      dropOverlay.className = "drop-overlay";
      dropOverlay.innerHTML = `
        <div class="drop-stars"></div><div class="drop-stars drop-stars2"></div>
        <div class="drop-center">
          <div class="drop-cube-wrap"><div class="drop-cube">
            <i class="dc-f dc-top"></i><i class="dc-f dc-bottom"></i>
            <i class="dc-f dc-front"></i><i class="dc-f dc-back"></i>
            <i class="dc-f dc-left"></i><i class="dc-f dc-right"></i>
          </div></div>
          <h1 class="drop-title"><span>SIX</span><span>SIDES</span></h1>
          <div class="drop-label">DROPPING IN</div>
          <div class="drop-bar"><i></i></div>
        </div>
        <div class="drop-tip"><b>TIP</b>${tips[Math.floor(Math.random() * tips.length)]}</div>`;
      document.body.appendChild(dropOverlay);
      dropShownAt = performance.now();
    }
    const reason = await new Promise<string | null>((resolve) => {
      joinResolve = resolve;
      net.sendHello(choice.name, choice.skin, choice.key);
    });
    if (reason === null) break;
    joinError = reason;
  }

  const charPos = new THREE.Vector3();
  // stereo pan of a world point: project onto the CAMERA's screen-right —
  // face-frame agnostic, works on every side of the planet
  const panOf = (p: THREE.Vector3): number => {
    const e = camera.matrixWorld.elements;
    const dx = p.x - charPos.x;
    const dy = p.y - charPos.y;
    const dz = p.z - charPos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1) return 0;
    return (dx * e[0] + dy * e[1] + dz * e[2]) / dist;
  };
  const remoteWeapons = new Map<string, string>();
  // last known hp per entity (drives the damage-number deltas)
  const lastHpById = new Map<string, number>();
  // Floating damage numbers: sprite + drift, faded out in the render loop.
  const dmgNums: { s: THREE.Sprite; ttl: number; v: THREE.Vector3 }[] = [];
  const spawnDmgNumber = (p: THREE.Vector3, amount: number, headshot: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = `900 ${headshot ? 46 : 38}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(10,10,14,0.9)";
    ctx.strokeText(String(amount), 64, 32);
    ctx.fillStyle = headshot ? "#ff5d4a" : "#ffd54a";
    ctx.fillText(String(amount), 64, 32);
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }),
    );
    s.scale.set(headshot ? 1.5 : 1.1, headshot ? 0.75 : 0.55, 1);
    s.position.copy(p).addScaledVector(new THREE.Vector3(myUp[0], myUp[1], myUp[2]), 1.3);
    s.renderOrder = 20;
    scene.add(s);
    dmgNums.push({
      s,
      ttl: 0.8,
      v: new THREE.Vector3(myUp[0], myUp[1], myUp[2])
        .multiplyScalar(1.7)
        .addScaledVector(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5), 0.8),
    });
  };
  // SPAWN-IN BEAM: a brief additive column of light where someone (re)spawns
  // — triggered by the respawn message, placed by the next snapshot.
  const pendingSpawnFx = new Set<string>();
  const spawnBeams: { m: THREE.Mesh; ttl: number }[] = [];
  const beamGeo = new THREE.CylinderGeometry(0.7, 0.9, 7, 12, 1, true);
  const spawnBeam = (p: [number, number, number]) => {
    const up = faceUp(p, null, planetMode);
    const m = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: 0x9fd8ff,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up[0], up[1], up[2]));
    m.position.set(p[0] + up[0] * 2.5, p[1] + up[1] * 2.5, p[2] + up[2] * 2.5);
    m.renderOrder = 15;
    scene.add(m);
    spawnBeams.push({ m, ttl: 0.7 });
  };
  // dropped-gun pseudo-entities seen this / previous snapshot (for cleanup)
  const seenDrops = new Set<string>();
  const knownDrops = new Set<string>();
  let myStreak = 0; // consecutive knockouts without dying (session-local)
  let deathCam: { pos: THREE.Vector3; killer: string | null; angle: number } | null = null;
  let myBlocks = 0; // build-block stock (v5, from snapshots)
  let lastBuildAt = -Infinity;
  let buildTarget: THREE.LineSegments | null = null;
  let heldBlock: THREE.Mesh | null = null;
  // Timed mining (Minecraft-style): hold LMB on a block until it breaks.
  let mineKey = ""; // "x,y,z" of the block being mined
  let mineProg = 0; // 0..1
  let mineOverlay: THREE.Mesh | null = null;
  let mineCracks: THREE.CanvasTexture[] | null = null;
  // Grenade LANDING marker (slot 4): the crosshair for arched throws — a
  // lit, pulsing spot where the full-power grenade will come to rest.
  let nadeMark: THREE.Mesh | null = null;
  // HOTBAR (4 slots): 1 the gun, 2 destroy tool, 3 grenades, 4 blocks
  let hotbarSel = 1;
  let prevBuildKey = false;
  const selectHotbar = (n: number) => {
    if (n === hotbarSel || n < 1 || n > 4) return;
    hotbarSel = n;
    sfx.draw();
  };
  hud.onHotbarSelect = selectHotbar; // tap-to-select (mobile parity)
  dartsFx.onNadeGone = (p) => sfx.boom(p.distanceTo(charPos), panOf(p));
  dartsFx.onNadeBounce = (p) => sfx.thock(p.distanceTo(charPos), panOf(p));
  visuals.onCrateRearmed = (p) => sfx.rearm(p.distanceTo(charPos), panOf(p));
  dartsFx.onDartNew = (owner, p) => {
    if (owner === myId) return; // own shots pew at fire time
    sfx.pew(remoteWeapons.get(owner) ?? "blaster", p.distanceTo(charPos), panOf(p));
    const m = dartsFx.muzzleOf?.(owner);
    if (m) dartsFx.muzzleFlash(m);
  };
  dartsFx.muzzleOf = (owner) => {
    if (owner === myId && shooterCam.mode === "first")
      return camera.localToWorld(new THREE.Vector3(0.26, -0.18, -0.95));
    return visuals.getGunTip(owner);
  };
  dartsFx.onDartGone = (p) => {
    // debug hook: where did the last dart end, and how far off screen-center?
    const ndc = p.clone().project(camera);
    (window as unknown as { __lastDartEnd?: unknown }).__lastDartEnd = {
      p: [p.x, p.y, p.z],
      ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3)],
    };
  };

  // ?debug=1 — live smoothness overlay: frame-to-frame displayed speed, its
  // wobble, the worst single-frame jump in the last second, and correction
  // stats. Read it at the moment movement feels bumpy.
  let dbg: HTMLDivElement | null = null;
  if (new URLSearchParams(location.search).has("debug")) {
    dbg = document.createElement("div");
    dbg.style.cssText =
      "position:fixed;bottom:8px;left:8px;z-index:99;background:rgba(0,0,0,.7);color:#8f8;" +
      "font:12px/1.5 monospace;padding:6px 10px;border-radius:6px;pointer-events:none;white-space:pre";
    document.body.appendChild(dbg);
  }
  const dbgFrames: { t: number; x: number; z: number }[] = [];
  let dbgPrevErrBig = 0;
  let accumulator = 0;
  let lastTick = performance.now();
  const clock = new THREE.Clock();

  // Fixed-step local prediction + input send (both 60 Hz — every input must
  // reach the server for rewind+replay reconciliation to line up). The pump
  // is driven from BOTH the rAF loop (vsync-phased: steps land right before
  // rendering, so the accumulator remainder is a clean interpolation alpha)
  // and a timer (rAF is throttled in occluded/background tabs, which would
  // starve the input stream and freeze prediction).
  const pump = () => {
    const now = performance.now();
    accumulator += Math.min((now - lastTick) / 1000, 1); // catch up after timer throttling
    lastTick = now;
    while (accumulator >= TICK_DT) {
      accumulator -= TICK_DT;
      const input = readInput();
      prediction.step(input);
      net.sendInput(input);
      fireFeedback(input.fire);
    }
  };

  // Instant tracer + muzzle flash on the fire input, throttled by the held
  // weapon's cooldown (mirrors the server; the authoritative dart replaces
  // the tracer within ~100 ms).
  let lastShotAt = -Infinity;
  let prevFire = false;
  const fireFeedback = (fire: boolean) => {
    const w = WEAPONS[myWeapon] ?? WEAPONS[DEFAULT_WEAPON];
    const want = w.auto ? fire : fire && !prevFire;
    prevFire = fire;
    if (!want || !myId) return;
    const now = performance.now() / 1000;
    if (now - lastShotAt < w.cooldownTicks * TICK_DT) return;
    lastShotAt = now;
    if (myAmmo === 0) {
      sfx.dryClick(); // empty mag — the server won't fire either
      return;
    }
    sfx.pew(myWeapon);
    const t = prediction.getTransform();
    if (!t) return;
    const d = dirFromYawPitch(aim.yaw, aim.pitch, myUp);
    // tracer starts at the VIEWMODEL muzzle in first person, the visible gun
    // tip in third — the authoritative ray is center-eye either way
    let start: [number, number, number];
    if (shooterCam.mode === "first") {
      const m = camera.localToWorld(new THREE.Vector3(0.26, -0.18, -0.95));
      start = [m.x, m.y, m.z];
    } else {
      const tip = myId ? visuals.getGunTip(myId) : null;
      start = tip
        ? [tip.x, tip.y, tip.z]
        : [
            t.p[0] + myUp[0] * EYE_HEIGHT + d[0] * 0.4,
            t.p[1] + myUp[1] * EYE_HEIGHT + d[1] * 0.4,
            t.p[2] + myUp[2] * EYE_HEIGHT + d[2] * 0.4,
          ];
    }
    dartsFx.localShot(start, d, w.dartSpeed);
    dartsFx.muzzleFlash(new THREE.Vector3(start[0], start[1], start[2]));
    vmKick = Math.min(1, vmKick + (w.zoom ? 0.9 : 0.5)); // snipers kick harder
  };
  setInterval(pump, 1000 / 60);

  let strideDist = 0; // meters traveled since the last footstep sound
  let prevAirborneFrame = false; // for the landing-thud edge
  let lastAirVUp = 0; // vertical speed carried into the landing

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    pump(); // step physics in-phase with the frame (see pump above)

    // Remote characters from the interpolation buffer
    const sampled = interp.sample();
    for (const [id] of players) {
      if (id === myId) continue;
      const s = sampled.get(id);
      if (s) visuals.setTransform(id, s.p, s.q);
    }
    for (const [id, s] of sampled) {
      if (id === "ship") {
        visuals.ensureShip();
        visuals.setTransform(id, s.p, s.q);
      }
    }
    // Props render from the PREDICTION mirror, not the interp buffer: our own
    // character renders ~100 ms ahead of interp, so an interp-rendered prop
    // being pushed sits visually inside us (the "passing through" glitch).
    cityMap.props.forEach((spawn, i) => {
      const id = `prop-${i}`;
      const s = prediction.getProp(id);
      visuals.ensureProp(id, spawn.pack, spawn.model);
      visuals.setTransform(id, s.p, s.q);
    });

    // Own character from prediction, interpolated between the last two
    // physics states ("Fix Your Timestep") — see the pump comment.
    if (myId) {
      const alpha = Math.min(accumulator / TICK_DT, 1);
      const t = prediction.getTransform(alpha);
      if (t) {
        charPos.set(t.p[0], t.p[1], t.p[2]);
        visuals.setTransform(myId, t.p, t.q);
        visuals.setAimPitch(myId, look.pitch);
        const tr = (window as unknown as { __trace?: number[][] }).__trace;
        if (tr) tr.push([performance.now(), charPos.x, charPos.z]); // debug: frame-pace trace
        if (dbg) {
          const now = performance.now();
          dbgFrames.push({ t: now, x: charPos.x, z: charPos.z });
          while (dbgFrames.length && dbgFrames[0].t < now - 1000) dbgFrames.shift();
          if (dbgFrames.length > 10) {
            const sp: number[] = [];
            let slow = 0;
            for (let i = 1; i < dbgFrames.length; i++) {
              const fdt = (dbgFrames[i].t - dbgFrames[i - 1].t) / 1000;
              if (fdt <= 0) continue;
              if (fdt > 0.025) slow++;
              sp.push(Math.hypot(dbgFrames[i].x - dbgFrames[i - 1].x, dbgFrames[i].z - dbgFrames[i - 1].z) / fdt);
            }
            const mean = sp.reduce((a, b) => a + b, 0) / sp.length;
            let jump = 0;
            for (let i = 1; i < sp.length; i++) jump = Math.max(jump, Math.abs(sp[i] - sp[i - 1]));
            const err = (globalThis as unknown as { __predErr?: { big: number; max: number } }).__predErr;
            const newBig = (err?.big ?? 0) - dbgPrevErrBig;
            if (newBig > 0) dbgPrevErrBig = err?.big ?? 0;
            dbg.textContent =
              `spd ${mean.toFixed(1)} m/s  fps ${sp.length}\n` +
              `jump ${jump.toFixed(1)} m/s  slow ${slow}\n` +
              `corr>0.2m total ${err?.big ?? 0} (max ${err?.max?.toFixed(2) ?? "0"})`;
          }
        }
        // FOV: sniper zoom on right-click beats the sprint kick
        const vel = prediction.getVelocity();
        const speed = Math.hypot(vel[0], vel[2]);
        // Footsteps: one quiet tap every ~2.2 m of GROUND travel — silence
        // while flying or airborne.
        const airborne = prediction.getFly() || !prediction.getGrounded();
        // LANDING THUD: touching down from a real fall gets a body impact
        const vUpNow = vel[0] * myUp[0] + vel[1] * myUp[1] + vel[2] * myUp[2];
        if (prevAirborneFrame && !airborne && lastAirVUp < -11) sfx.thock(0, 0);
        if (airborne) lastAirVUp = vUpNow;
        prevAirborneFrame = airborne;
        if (speed > 1 && !airborne) {
          strideDist += speed * dt;
          if (strideDist >= 2.2) {
            strideDist = 0;
            // timbre follows the block underfoot (grass thud / sand shuffle /
            // snow crunch / ice click / hard stone tap)
            let surf: "grass" | "dirt" | "sand" | "snow" | "ice" | "hard" = "hard";
            const mp = voxWorld ? prediction.getTransform() : null;
            if (voxWorld && mp) {
              const fx = mp.p[0] - myUp[0] * 0.95;
              const fy = mp.p[1] - myUp[1] * 0.95;
              const fz = mp.p[2] - myUp[2] * 0.95;
              const id =
                voxWorld.get(Math.floor(fx), Math.floor(fy), Math.floor(fz)) ||
                voxWorld.get(Math.floor(fx - myUp[0]), Math.floor(fy - myUp[1]), Math.floor(fz - myUp[2]));
              surf = FOOT_SURFACE[id] ?? "hard";
            }
            sfx.footstep(surf);
          }
        } else {
          strideDist = 0;
        }
        const gunOut = hotbarSel === 1;
        const zoom = gunOut && (keyboard.zooming || touch.zooming) ? WEAPONS[myWeapon]?.zoom : undefined;
        const targetFov = zoom ? 70 / zoom : 70 + (speed > 6.5 ? 6 : 0);
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
          camera.updateProjectionMatrix();
        }
        // scoped: aim slows to match magnification, HUD shows the scope ring
        look.scale = zoom ? 1 / zoom : 1;
        hud.setScopeOverlay(!!zoom && shooterCam.mode === "first");
        // BUILD/DESTROY (v5): slot 3 breaks the aimed block, slot 5 places.
        const toolOut = hotbarSel === 2 || hotbarSel === 4;
        if (voxWorld && toolOut) {
          const eye: [number, number, number] = [
            charPos.x + myUp[0] * EYE_HEIGHT,
            charPos.y + myUp[1] * EYE_HEIGHT,
            charPos.z + myUp[2] * EYE_HEIGHT,
          ];
          const bdir = dirFromYawPitch(look.yaw, look.pitch, myUp);
          const hit = voxWorld.raycast(eye, bdir, BUILD_REACH);
          if (!buildTarget) {
            buildTarget = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
              new THREE.LineBasicMaterial({ color: 0xffffff }),
            );
            scene.add(buildTarget);
          }
          buildTarget.visible = !!hit;
          if (hit) buildTarget.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
          const nowS = performance.now() / 1000;
          // mouse OR the touch fire button drive mining/placing
          const lmb = keyboard.current().fire || touch.fire;
          const rmb = keyboard.rightDown;
          // MINING (slot 3): hold LMB — progress at the block's hardness,
          // with a growing crack decal; switching targets resets progress.
          if (hotbarSel === 2 && lmb && hit) {
            const key = `${hit.x},${hit.y},${hit.z}`;
            if (key !== mineKey) {
              mineKey = key;
              mineProg = 0;
            }
            const hard = HARDNESS[voxWorld.get(hit.x, hit.y, hit.z)] ?? 1;
            if (Number.isFinite(hard)) {
              mineProg += dt / hard;
              if (mineProg >= 1) {
                net.sendBlockEdit(hit.x, hit.y, hit.z, 0);
                sfx.thock(0);
                mineKey = "";
                mineProg = 0;
              }
            } else {
              mineProg = 0; // bedrock/fluids: cracks never appear
            }
          } else {
            mineKey = "";
            mineProg = 0;
          }
          // crack overlay riding the mined block
          if (!mineOverlay) {
            mineCracks = crackTextures(4);
            mineOverlay = new THREE.Mesh(
              new THREE.BoxGeometry(1.006, 1.006, 1.006),
              new THREE.MeshBasicMaterial({
                map: mineCracks[0],
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1,
              }),
            );
            scene.add(mineOverlay);
          }
          mineOverlay.visible = mineKey !== "" && mineProg > 0.02 && !!hit;
          if (mineOverlay.visible && hit && mineCracks) {
            mineOverlay.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
            const stage = Math.min(3, Math.floor(mineProg * 4));
            (mineOverlay.material as THREE.MeshBasicMaterial).map = mineCracks[stage];
          }
          // PLACING (slot 5): tap or hold either button
          if (hit && hotbarSel === 4 && (lmb || rmb) && myBlocks > 0 && nowS - lastBuildAt > 0.18) {
            net.sendBlockEdit(hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz, B_BUILD);
            sfx.pickup();
            lastBuildAt = nowS;
          }
        } else {
          if (buildTarget) buildTarget.visible = false;
          if (mineOverlay) mineOverlay.visible = false;
          mineKey = "";
          mineProg = 0;
        }
        // GRENADE CROSSHAIR (slot 4): grenades always throw at full power on
        // an ARC, so the flat center dot lies. Simulate the real flight —
        // same vector, face gravity, and bounce damping as the server — and
        // light up the LANDING spot as the aiming guide.
        if (hotbarSel === 3 && myNades > 0 && voxWorld) {
          if (!nadeMark) {
            nadeMark = new THREE.Mesh(
              new THREE.SphereGeometry(0.24, 14, 10),
              new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.85, depthWrite: false }),
            );
            scene.add(nadeMark);
          }
          const d = dirFromYawPitch(aim.yaw, aim.pitch, myUp);
          const p: V3 = [
            charPos.x + d[0] * 0.6 + myUp[0] * 0.4,
            charPos.y + d[1] * 0.6 + myUp[1] * 0.4,
            charPos.z + d[2] * 0.6 + myUp[2] * 0.4,
          ];
          const v: V3 = [
            d[0] * GRENADE.throwSpeed + myUp[0] * GRENADE.throwUp,
            d[1] * GRENADE.throwSpeed + myUp[1] * GRENADE.throwUp,
            d[2] * GRENADE.throwSpeed + myUp[2] * GRENADE.throwUp,
          ];
          // mirror stepNades: the fuse only burns AFTER first world contact
          let fuse = GRENADE.fuseTicks;
          let touched = false;
          for (let i = 0; i < 300 && (!touched || fuse > 0); i++) {
            const g = faceUp(p, null, planetMode);
            v[0] -= g[0] * GRAVITY * TICK_DT;
            v[1] -= g[1] * GRAVITY * TICK_DT;
            v[2] -= g[2] * GRAVITY * TICK_DT;
            const segLen = Math.hypot(v[0], v[1], v[2]) * TICK_DT;
            if (segLen > 1e-6) {
              const hit = voxWorld.raycast(p, [v[0], v[1], v[2]], segLen + 0.1);
              if (hit && hit.dist <= segLen) {
                // reflect + damp exactly like stepNades
                const t = Math.max(0, hit.dist - 0.02);
                const inv = 1 / (segLen / TICK_DT);
                p[0] += v[0] * inv * t; p[1] += v[1] * inv * t; p[2] += v[2] * inv * t;
                const dot = v[0] * hit.nx + v[1] * hit.ny + v[2] * hit.nz;
                v[0] = (v[0] - 2 * dot * hit.nx) * 0.4;
                v[1] = (v[1] - 2 * dot * hit.ny) * 0.4;
                v[2] = (v[2] - 2 * dot * hit.nz) * 0.4;
                touched = true;
              } else {
                p[0] += v[0] * TICK_DT; p[1] += v[1] * TICK_DT; p[2] += v[2] * TICK_DT;
              }
            }
            if (touched) fuse--;
          }
          nadeMark.visible = true;
          nadeMark.position.set(p[0], p[1], p[2]);
          // lit pulse so the landing spot reads as the active crosshair
          const pulse = 1 + Math.sin(performance.now() / 130) * 0.22;
          nadeMark.scale.setScalar(pulse);
        } else if (nadeMark) {
          nadeMark.visible = false;
        }
        hud.setLoadout(myWeapon, myAmmo, myNades, myBlocks, hotbarSel);
        // hands match the hotbar: gun on 1-2, held block on 5, bare on 3-4
        if (shooterCam.mode === "first" && !deathCam) {
          viewmodel.visible = gunOut;
          if (!heldBlock) {
            heldBlock = new THREE.Mesh(
              new THREE.BoxGeometry(0.22, 0.22, 0.22),
              blockMaterial(B_BUILD) ?? new THREE.MeshLambertMaterial({ color: 0xb4b9c2 }),
            );
            heldBlock.position.set(0.28, -0.26, -0.5);
            camera.add(heldBlock);
          }
          heldBlock.visible = hotbarSel === 4 && myBlocks > 0;
        } else if (heldBlock) {
          heldBlock.visible = false;
        }
        // viewmodel life: draw dip after a swap + walk bob (still while scoped)
        // + recoil kick (backward/up shove that springs home; aim unaffected)
        vmDip = Math.max(0, vmDip - dt * 4);
        vmKick = Math.max(0, vmKick - dt * 7);
        vmBobPhase += speed * dt * 1.9;
        // no walk-bob in the air: flying reads glassy smooth. EASE the
        // amplitude — grounded flickers on landing must not snap the gun.
        const bobTarget = zoom || airborne ? 0 : Math.min(1, speed / 5) * 0.012;
        vmBobAmp += (bobTarget - vmBobAmp) * Math.min(1, dt * 6);
        const bobAmp = vmBobAmp;
        viewmodel.position.set(
          0.2 + Math.cos(vmBobPhase) * bobAmp,
          -0.22 - vmDip * 0.3 + Math.abs(Math.sin(vmBobPhase)) * bobAmp * 1.4 + vmKick * 0.02,
          -0.48 + vmKick * 0.07,
        );
        viewmodel.rotation.x = -vmDip * 0.9 + vmKick * 0.1;
        {
          const prevUp = myUp;
          // mirror the sim rule: no face flip while rising (edge jumps)
          const velNow = prediction.getVelocity();
          const risingNow = velNow[0] * myUp[0] + velNow[1] * myUp[1] + velNow[2] * myUp[2] > 1;
          if (!risingNow) myUp = faceUp([charPos.x, charPos.y, charPos.z], myUp, planetMode);
          // edge crossing: carry the WORLD direction you were facing into the
          // new face frame so the view doesn't whip 90°
          if (myUp !== prevUp && (myUp[0] !== prevUp[0] || myUp[1] !== prevUp[1] || myUp[2] !== prevUp[2])) {
            look.yaw = carryYaw(look.yaw, prevUp, myUp);
          }
          if (snapCamUp) {
            // fresh spawn: no roll-in from the previous face's orientation
            snapCamUp = false;
            shooterCam.snapUp(myUp);
          }
        }
        shooterCam.update(charPos, look.yaw, look.pitch, (f, d, dist) => prediction.cameraBlock(f, d, dist), myUp);
        hud.updateMinimap(charPos.x, charPos.z, look.yaw);
      }
      // DEATH CAM: while waiting to respawn, rise above the body and watch
      // the killer instead of staring through a corpse in first person.
      // (Outside the transform guard — prediction has no state while dead.)
      if (deathCam) {
        deathCam.angle += dt * 0.35;
        // orbit in the FACE FRAME of the death spot (plain Y off the planet)
        const du = faceUp([deathCam.pos.x, deathCam.pos.y, deathCam.pos.z], null, planetMode);
        const { t1: dt1, t2: dt2 } = basis(du);
        const oc = Math.cos(deathCam.angle) * 5.5;
        const os = Math.sin(deathCam.angle) * 5.5;
        camera.position.set(
          deathCam.pos.x + dt1[0] * oc + dt2[0] * os + du[0] * 4,
          deathCam.pos.y + dt1[1] * oc + dt2[1] * os + du[1] * 4,
          deathCam.pos.z + dt1[2] * oc + dt2[2] * os + du[2] * 4,
        );
        camera.up.set(du[0], du[1], du[2]);
        const killer = deathCam.killer ? visuals.getPosition(deathCam.killer) : null;
        camera.lookAt(killer ? new THREE.Vector3(killer.x, killer.y + 0.6, killer.z) : deathCam.pos);
        viewmodel.visible = false;
        hud.setScopeOverlay(false);
      }
    }

    // camera inside a water cell = submerged view (blue murk + the shared
    // water material goes near-clear so you can SEE OUT; from above it stays
    // near-opaque — every water cell is a full cube, so from below you're
    // looking at real front faces, not culled backfaces)
    const camUnderwater =
      !!voxWorld &&
      voxWorld.get(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z)) === B_WATER;
    const waterMat = blockMaterial(B_WATER);
    if (waterMat) waterMat.opacity = camUnderwater ? 0.22 : 0.94;
    // advance + fade the floating damage numbers
    for (let i = dmgNums.length - 1; i >= 0; i--) {
      const n = dmgNums[i];
      n.ttl -= dt;
      if (n.ttl <= 0) {
        scene.remove(n.s);
        n.s.material.map?.dispose();
        n.s.material.dispose();
        dmgNums.splice(i, 1);
        continue;
      }
      n.s.position.addScaledVector(n.v, dt);
      n.v.multiplyScalar(1 - dt * 2);
      n.s.material.opacity = Math.min(1, n.ttl / 0.45);
    }
    // spawn-in beams: stretch up + fade out
    for (let i = spawnBeams.length - 1; i >= 0; i--) {
      const b = spawnBeams[i];
      b.ttl -= dt;
      if (b.ttl <= 0) {
        scene.remove(b.m);
        (b.m.material as THREE.Material).dispose();
        spawnBeams.splice(i, 1);
        continue;
      }
      const f = b.ttl / 0.7;
      (b.m.material as THREE.MeshBasicMaterial).opacity = 0.75 * f;
      b.m.scale.set(0.6 + 0.8 * (1 - f), 1 + (1 - f) * 0.6, 0.6 + 0.8 * (1 - f));
    }
    weather?.tick(
      dt,
      camera.position,
      myUp,
      srvTime + (srvTimeAt ? (performance.now() - srvTimeAt) / 1000 : 0),
      camUnderwater,
    );
    if (planetMode) sfx.setBiome(faceIndexOfUp(myUp)); // ambient bed follows the face
    visuals.tick(dt);
    dartsFx.tick(dt);
    renderer.render(scene, camera);
  });
}

start();
