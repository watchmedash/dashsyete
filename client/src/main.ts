import * as THREE from "three";
import { MAX_HP, TICK_DT } from "../../shared/src/constants";
import type { PlayerInfo } from "../../shared/src/protocol";
import { TEAMS } from "../../shared/src/types";
import { buildCity } from "./city";
import { CarVisuals } from "./cars";
import { ChaseCamera } from "./camera";
import { KeyboardInput } from "./input";
import { TouchInput } from "./touch";
import { Interpolator } from "./interp";
import { autoDrift, joystickToInput } from "./joystick";
import { FreeLook } from "./look";
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

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 150, 220);
camera.lookAt(0, 0, 0);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function start() {
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
  const visuals = new CarVisuals(scene);
  const interp = new Interpolator();
  const keyboard = new KeyboardInput();
  const touch = new TouchInput();
  const chase = new ChaseCamera(camera);
  const look = new FreeLook();
  look.attach(renderer.domElement);
  const hud = new Hud();

  if (touch.active) {
    // Lighter rendering on touch devices
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  const carHeading = () => {
    const t = prediction.getTransform();
    if (!t) return 0;
    const q = t.q;
    return Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
  };

  const readInput = () => {
    const input = keyboard.current();
    if (touch.active) {
      const stick = joystickToInput(touch.jx, touch.jy, chase.yaw(), carHeading());
      if (stick.throttle !== 0 || stick.steer !== 0) {
        input.throttle = stick.throttle;
        input.steer = stick.steer;
      }
      if (touch.gas) input.throttle = 1;
      if (touch.brake) input.throttle = -1;
      // Auto-drift replaces the DRIFT button on touch devices
      const vel = prediction.getVelocity();
      input.handbrake = autoDrift(Math.hypot(vel[0], vel[2]), input.steer, input.throttle);
    }
    return input;
  };
  (window as unknown as { __input?: unknown }).__input = readInput; // debug hook
  (window as unknown as { __vel?: unknown }).__vel = () => prediction.getVelocity(); // debug hook

  let myId: string | null = null;
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
        hud.setTeamColor(TEAMS[msg.team].color);
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
        interp.push(msg.time, msg.cars);
        // Props sync BEFORE correct(): the replay resimulates them alongside
        // our car, so the mirror stays coherent with the authoritative state.
        prediction.syncProps(msg.cars);
        for (const c of msg.cars) {
          if (c.id === myId) {
            prediction.correct(c.p, c.q, c.v, msg.lastSeq);
            hud.setHp(c.hp);
          } else if (players.has(c.id)) {
            visuals.setHp(c.id, c.hp / MAX_HP);
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
      net.sendHello(choice.name, choice.car, choice.pass);
    });
    if (reason === null) break;
    joinError = reason;
  }

  const carPos = new THREE.Vector3();
  const carQuat = new THREE.Quaternion();
  let firstFollow = true;
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
    }
  };
  setInterval(pump, 1000 / 60);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    pump(); // step physics in-phase with the frame (see pump above)

    // Remote cars from the interpolation buffer
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
    // car renders ~100 ms ahead of interp, so an interp-rendered prop being
    // pushed sits visually inside the car (the "passing through" glitch).
    cityMap.props.forEach((spawn, i) => {
      const id = `prop-${i}`;
      const s = prediction.getProp(id);
      visuals.ensureProp(id, spawn.pack, spawn.model);
      visuals.setTransform(id, s.p, s.q);
    });

    // Own car from prediction, interpolated between the last two physics
    // states ("Fix Your Timestep"): physics steps on a 60 Hz timer, rendering
    // on rAF — a frame sees 0..2 steps, and drawing the raw (or lazily
    // smoothed) pose beats rhythmically at speed ("takak takak").
    if (myId) {
      const alpha = Math.min(accumulator / TICK_DT, 1);
      const t = prediction.getTransform(alpha);
      if (t) {
        carPos.set(t.p[0], t.p[1], t.p[2]);
        carQuat.set(t.q[0], t.q[1], t.q[2], t.q[3]);
        visuals.setTransform(myId, t.p, t.q);
        const tr = (window as unknown as { __trace?: number[][] }).__trace;
        if (tr) tr.push([performance.now(), carPos.x, carPos.z]); // debug: frame-pace trace
        if (firstFollow) {
          chase.jumpTo(carPos, carQuat);
          firstFollow = false;
        }
        const vel = prediction.getVelocity();
        look.tick(dt, Math.hypot(vel[0], vel[2]) > 2);
        chase.update(dt, carPos, carQuat, look);
      }
    }

    renderer.render(scene, camera);
  });
}

start();
