import * as THREE from "three";
import { PLAYABLE_CARS, TICK_DT } from "../../shared/src/constants";
import type { PlayerInfo } from "../../shared/src/protocol";
import { buildCity } from "./city";
import { CarVisuals } from "./cars";
import { ChaseCamera } from "./camera";
import { KeyboardInput } from "./input";
import { Interpolator } from "./interp";
import { Net } from "./net";
import { LocalPrediction } from "./prediction";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 300, 700);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 150, 220);
camera.lookAt(0, 0, 0);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function start() {
  const net = new Net();
  const visuals = new CarVisuals(scene);
  const interp = new Interpolator();
  const keyboard = new KeyboardInput();
  const chase = new ChaseCamera(camera);

  let myId: string | null = null;
  const players = new Map<string, PlayerInfo>();

  const [prediction] = await Promise.all([LocalPrediction.create(), buildCity(scene)]);

  net.onMsg = (msg) => {
    switch (msg.t) {
      case "welcome":
        myId = msg.id;
        for (const p of msg.players) {
          players.set(p.id, p);
          visuals.ensure(p);
        }
        break;
      case "join":
        players.set(msg.player.id, msg.player);
        visuals.ensure(msg.player);
        break;
      case "leave":
        players.delete(msg.id);
        visuals.remove(msg.id);
        break;
      case "snapshot": {
        interp.push(msg.time, msg.cars);
        if (myId) {
          const mine = msg.cars.find((c) => c.id === myId);
          if (mine) prediction.correct(mine.p, mine.q, mine.v);
        }
        break;
      }
    }
  };
  net.onClose = () => console.warn("disconnected");

  await net.connect();
  // Temporary auto-join until the join screen lands (Task 11)
  net.sendHello("Dev", PLAYABLE_CARS[Math.floor(Math.random() * PLAYABLE_CARS.length)]);

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
      const input = keyboard.current();
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

    // Own car from prediction
    if (myId) {
      const t = prediction.getTransform();
      (window as unknown as { __debug?: unknown }).__debug = t;
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
