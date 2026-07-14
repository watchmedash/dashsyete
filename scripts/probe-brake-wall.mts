// Quantify braking + wall-impact composure.
// 1) BRAKE: full throttle 3 s on the avenue, then S (throttle -1): time and
//    distance until stopped, plus worst nose-dive pitch.
// 2) WALL SLAM: full speed straight into a building collider: min upY
//    (1 = level, <0.3 = flip-detect territory), max height, resting state.
import { Sim } from "../shared/src/sim";
import { TICK_RATE, TICK_DT } from "../shared/src/constants";

const sim = await Sim.create();
const idle = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

function upY(q: [number, number, number, number]): number {
  return 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
}
function pitchY(q: [number, number, number, number]): number {
  // y of the car's forward axis: negative = nose down
  const [x, y, z, w] = q;
  return 2 * (y * z + w * x) * -1 + 2 * (w * x + y * z) * 0 + (2 * (x * z + w * y)) * 0; // placeholder
}
// forward vector y component from quaternion (rotate (0,0,1))
function fwdY(q: [number, number, number, number]): number {
  const [x, y, z, w] = q;
  return 2 * (y * z - w * x);
}

// --- 1) brake from top speed ---
{
  sim.addCar("b", 6, -60, 0);
  sim.setInput("b", { ...idle, seq: 1, throttle: 1 });
  for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
  const s0 = sim.getState("b");
  const v0 = Math.hypot(s0.v[0], s0.v[2]);
  sim.setInput("b", { ...idle, seq: 2, throttle: -1 });
  let ticks = 0;
  let minFwdY = 0;
  for (; ticks < TICK_RATE * 8; ticks++) {
    sim.step();
    const s = sim.getState("b");
    minFwdY = Math.min(minFwdY, fwdY(s.q));
    if (Math.hypot(s.v[0], s.v[2]) < 1) break;
  }
  const s1 = sim.getState("b");
  const dist = Math.hypot(s1.p[0] - s0.p[0], s1.p[2] - s0.p[2]);
  console.log(
    `BRAKE from ${v0.toFixed(1)} m/s: stopped in ${(ticks * TICK_DT).toFixed(2)} s / ${dist.toFixed(1)} m, worst nose pitch fwdY ${minFwdY.toFixed(2)}`,
  );
  sim.removeCar("b");
}

// --- 2) wall slam ---
{
  // Find a tall building collider roughly north of the downtown avenue.
  // Downtown skyscraper at (30, -54), west face at x=24.2: the corridor from
  // x=-50 at z=-54 is collider-free, so slam it at full speed heading +x.
  const target = sim.map.colliders.find((c) => c.hy > 2 && c.x === 30 && c.z === -54);
  if (!target) {
    console.log("WALL: no collider target found, adjust filter");
  } else {
    sim.addCar("w", -50, -54, Math.PI / 2); // rotY +90deg: forward = +x
    sim.setInput("w", { ...idle, seq: 1, throttle: 1 });
    let minUp = 1;
    let maxY = 0;
    for (let i = 0; i < TICK_RATE * 5; i++) {
      sim.step();
      const s = sim.getState("w");
      minUp = Math.min(minUp, upY(s.q));
      maxY = Math.max(maxY, s.p[1]);
    }
    const end = sim.getState("w");
    console.log(
      `WALL slam square-on: min upY ${minUp.toFixed(2)}, max height ${maxY.toFixed(2)}, flipped=${sim.isFlipped("w")}, rest upY ${upY(end.q).toFixed(2)}`,
    );
    sim.removeCar("w");
  }

  // Oblique hits are the flip-prone ones: same face, approached at an angle,
  // and a corner clip that catches one front wheel side.
  const runs: [string, number, number, number][] = [
    ["oblique ~25deg", -40, -84, Math.atan2(64.2, 30)],
    ["corner clip", -40, -70, Math.atan2(65.2, 10.2)],
  ];
  // Low decor collider (planter/gravestone, hy ~0.7): these are the launch
  // ramps — a chassis riding up a knee-high box at speed pops the nose.
  const low = sim.map.colliders.find((c) => c.hy < 1.2 && c.hy > 0.2 && c.x === -66 && c.z === -270);
  if (low) runs.push(["low decor ramp", low.x, low.z + 30, Math.PI]); // stay ashore: approach from the south heading -z
  for (const [label, sx, sz, yaw] of runs) {
    sim.addCar("w", sx, sz, yaw);
    sim.setInput("w", { ...idle, seq: 1, throttle: 1 });
    let minUp = 1;
    let maxY = 0;
    for (let i = 0; i < TICK_RATE * 5; i++) {
      sim.step();
      const s = sim.getState("w");
      minUp = Math.min(minUp, upY(s.q));
      maxY = Math.max(maxY, s.p[1]);
    }
    const end = sim.getState("w");
    console.log(
      `WALL slam ${label}: min upY ${minUp.toFixed(2)}, max height ${maxY.toFixed(2)}, flipped=${sim.isFlipped("w")}, rest upY ${upY(end.q).toFixed(2)}`,
    );
    sim.removeCar("w");
  }
}
