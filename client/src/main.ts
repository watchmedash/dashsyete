import * as THREE from "three";
import { MAX_HP, TICK_DT } from "../../shared/src/constants";
import { WEAPONS, DEFAULT_WEAPON } from "../../shared/src/weapons";
import type { InputState, PlayerInfo } from "../../shared/src/protocol";
import { buildCity } from "./city";
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
import { Hud } from "./ui/hud";
import { showJoinScreen } from "./ui/join";
import "./ui/style.css";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
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
    await buildCity(scene);
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

  // V cycles the perspective: 3rd-back → 1st-person → 3rd-front (selfie).
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyV" && myId) {
      const mode = shooterCam.cycleMode();
      visuals.setHidden(myId, mode === "first");
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
    return {
      seq: ++seq,
      moveX,
      moveZ,
      yaw: look.yaw,
      aimPitch: look.pitch,
      jump,
      sprint: kb.sprint || (touch.active && Math.hypot(touch.jx, touch.jy) > 0.95),
      fire,
      nade: kb.nade,
    };
  };
  (window as unknown as { __input?: unknown }).__input = readInput; // debug hook
  (window as unknown as { __vel?: unknown }).__vel = () => prediction.getVelocity(); // debug hook

  let myId: string | null = null;
  let myWeapon = DEFAULT_WEAPON;
  const players = new Map<string, PlayerInfo>();

  const [prediction, cityMap] = await Promise.all([LocalPrediction.create(), buildCity(scene)]);

  let joinResolve: ((reason: string | null) => void) | null = null;

  net.onMsg = (msg) => {
    switch (msg.t) {
      case "reject":
        joinResolve?.(msg.reason);
        joinResolve = null;
        break;
      case "welcome":
        joinResolve?.(null);
        joinResolve = null;
        myId = msg.id;
        hud.setMyId(myId);
        for (const p of msg.players) {
          players.set(p.id, p);
          visuals.ensure(p, p.id === myId);
        }
        hud.setPlayers([...players.values()]);
        hud.setScores(msg.scores);
        break;
      case "join":
        players.set(msg.player.id, msg.player);
        visuals.ensure(msg.player);
        hud.upsertPlayer(msg.player);
        break;
      case "leave":
        players.delete(msg.id);
        visuals.remove(msg.id);
        hud.removePlayer(msg.id);
        break;
      case "snapshot": {
        interp.push(msg.time, msg.chars);
        dartsFx.sync(msg.darts, performance.now() / 1000);
        // Props sync BEFORE correct(): the replay resimulates them alongside
        // our character, so the mirror stays coherent with the authoritative
        // state.
        prediction.syncProps(msg.chars);
        for (const c of msg.chars) {
          if (c.id === myId) {
            prediction.correct(c.p, c.q, c.v, msg.lastSeq);
            hud.setHp(c.hp);
            hud.setWeapon(c.weapon, c.nades ?? 0);
            visuals.setWeapon(c.id, c.weapon);
            myWeapon = c.weapon;
          } else if (players.has(c.id)) {
            visuals.setHp(c.id, c.hp / MAX_HP);
            visuals.setWeapon(c.id, c.weapon);
          } else if (c.id.startsWith("crate-")) {
            visuals.ensureCrate(c.id, c.p[0], c.p[2], c.weapon);
            visuals.setCrateArmed(c.id, c.hp > 0);
          }
        }
        break;
      }
      case "knockout":
        visuals.setVisible(msg.victimId, false);
        hud.addKill(msg.attackerId, msg.victimId);
        hud.setScores(msg.scores);
        if (msg.victimId === myId) {
          prediction.reset();
          hud.showRespawnCountdown();
        }
        break;
      case "respawn":
        if (msg.id === myId) hud.hideRespawnCountdown();
        break;
      case "damage":
        if (msg.attackerId === myId) hud.hitMarker();
        break;
    }
  };
  net.onClose = () => console.warn("disconnected");

  await net.connect();

  // Join loop: keep showing the join screen until the server accepts us
  // (wrong password / duplicate name come back as reject messages).
  let joinError: string | undefined;
  for (;;) {
    const choice = await showJoinScreen(joinError);
    const reason = await new Promise<string | null>((resolve) => {
      joinResolve = resolve;
      net.sendHello(choice.name, choice.skin, choice.pass);
    });
    if (reason === null) break;
    joinError = reason;
  }

  const charPos = new THREE.Vector3();

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
    const t = prediction.getTransform();
    if (!t) return;
    const cosP = Math.cos(look.pitch);
    const d: [number, number, number] = [Math.sin(look.yaw) * cosP, Math.sin(look.pitch), Math.cos(look.yaw) * cosP];
    // right-hand muzzle — keep in sync with server handleFire
    const rx = -Math.cos(look.yaw) * 0.3;
    const rz = Math.sin(look.yaw) * 0.3;
    dartsFx.localShot([t.p[0] + rx + d[0] * 0.55, t.p[1] + 0.25 + d[1] * 0.55, t.p[2] + rz + d[2] * 0.55], d, w.dartSpeed);
  };
  setInterval(pump, 1000 / 60);

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
        shooterCam.update(charPos, look.yaw, look.pitch, (f, d, dist) => prediction.cameraBlock(f, d, dist));
      }
    }

    visuals.tick(dt);
    dartsFx.tick(dt);
    renderer.render(scene, camera);
  });
}

start();
