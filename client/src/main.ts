import * as THREE from "three";
import { TICK_DT } from "../../shared/src/constants";
import type { PlayerInfo } from "../../shared/src/protocol";
import { buildCity } from "./city";
import { CarVisuals } from "./cars";
import { ChaseCamera } from "./camera";
import { KeyboardInput } from "./input";
import { TouchInput } from "./touch";
import { Interpolator } from "./interp";
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

  const { name, car } = await showJoinScreen();

  const net = new Net();
  const visuals = new CarVisuals(scene);
  const interp = new Interpolator();
  const keyboard = new KeyboardInput();
  const touch = new TouchInput();
  const chase = new ChaseCamera(camera);
  const hud = new Hud();

  if (touch.active) {
    // Lighter rendering on touch devices
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  const readInput = () => {
    const input = keyboard.current();
    if (touch.active) {
      const t = touch.current();
      if (t.throttle !== 0 || t.steer !== 0 || t.handbrake) {
        input.throttle = t.throttle;
        input.steer = t.steer;
        input.handbrake = t.handbrake;
      }
    }
    return input;
  };
  (window as unknown as { __input?: unknown }).__input = readInput; // debug hook

  let myId: string | null = null;
  const players = new Map<string, PlayerInfo>();

  const [prediction, cityMap] = await Promise.all([LocalPrediction.create(), buildCity(scene)]);

  net.onMsg = (msg) => {
    switch (msg.t) {
      case "welcome":
        myId = msg.id;
        hud.setMyId(myId);
        for (const p of msg.players) {
          players.set(p.id, p);
          visuals.ensure(p);
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
        if (myId) {
          const mine = msg.cars.find((c) => c.id === myId);
          if (mine) {
            prediction.correct(mine.p, mine.q, mine.v);
            hud.setHp(mine.hp);
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
  net.sendHello(name, car);

  const carPos = new THREE.Vector3();
  const carQuat = new THREE.Quaternion();
  let firstFollow = true;
  let accumulator = 0;
  let lastTick = performance.now();
  let sendToggle = false;
  const clock = new THREE.Clock();

  // Fixed-step local prediction + input send (60 Hz sim, 30 Hz net).
  // Runs on a timer, not rAF: rAF is throttled in occluded/background tabs,
  // which would starve the input stream and freeze prediction.
  setInterval(() => {
    const now = performance.now();
    accumulator += Math.min((now - lastTick) / 1000, 1); // catch up after timer throttling
    lastTick = now;
    while (accumulator >= TICK_DT) {
      accumulator -= TICK_DT;
      const input = readInput();
      prediction.step(input);
      sendToggle = !sendToggle;
      if (sendToggle) net.sendInput(input);
    }
  }, 1000 / 60);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);

    // Remote cars from the interpolation buffer
    const sampled = interp.sample();
    for (const [id] of players) {
      if (id === myId) continue;
      const s = sampled.get(id);
      if (s) visuals.setTransform(id, s.p, s.q);
    }
    for (const [id, s] of sampled) {
      if (id.startsWith("prop-")) {
        const spawn = cityMap.props[Number(id.slice(5))];
        if (spawn) {
          visuals.ensureProp(id, spawn.pack, spawn.model);
          visuals.setTransform(id, s.p, s.q);
        }
      }
    }

    // Own car from prediction
    if (myId) {
      const t = prediction.getTransform();
      if (t) {
        visuals.setTransform(myId, t.p, t.q);
        carPos.set(t.p[0], t.p[1], t.p[2]);
        carQuat.set(t.q[0], t.q[1], t.q[2], t.q[3]);
        if (firstFollow) {
          chase.jumpTo(carPos, carQuat);
          firstFollow = false;
        }
        chase.update(dt, carPos, carQuat);
      }
    }

    renderer.render(scene, camera);
  });
}

start();
