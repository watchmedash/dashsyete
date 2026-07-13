// Driving-feel probe: quantifies the current complaints so fixes are measurable.
// 1. straight-line stability: drive straight 5s — lateral drift + yaw wobble
// 2. side-touch flip: T-bone at moderate speed — victim must stay upright
// 3. rest ride height (for the visual anchor) + settle bounce
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const sim = await Sim.create();
const idle = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

// --- rest height + bounce ---
sim.addCar("rest", -60, -80, 0);
const heights: number[] = [];
for (let i = 0; i < TICK_RATE * 2; i++) {
  sim.step();
  heights.push(sim.getState("rest").p[1]);
}
const late = heights.slice(-30);
console.log(
  `rest height: ${(late.reduce((a, b) => a + b) / late.length).toFixed(3)} ` +
  `(bounce amplitude last 0.5s: ${(Math.max(...late) - Math.min(...late)).toFixed(4)})`,
);
sim.removeCar("rest");

// --- straight-line stability ---
sim.addCar("s", -60, -80, 0);
sim.setInput("s", { ...idle, seq: 1, throttle: 1 });
let maxYawDev = 0;
for (let i = 0; i < TICK_RATE * 5; i++) {
  sim.step();
  const q = sim.getState("s").q;
  const yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
  maxYawDev = Math.max(maxYawDev, Math.abs(yaw));
}
const sPos = sim.getState("s").p;
console.log(`straight 5s: lateral drift ${Math.abs(sPos[0] + 60).toFixed(2)} m, max yaw dev ${maxYawDev.toFixed(3)} rad`);
sim.removeCar("s");

// --- steering release wobble ---
sim.addCar("w", 60, -80, 0);
sim.setInput("w", { ...idle, seq: 1, throttle: 1 });
for (let i = 0; i < TICK_RATE * 2; i++) sim.step();
sim.setInput("w", { ...idle, seq: 2, throttle: 1, steer: 1 });
for (let i = 0; i < TICK_RATE; i++) sim.step();
sim.setInput("w", { ...idle, seq: 3, throttle: 1 });
const yaws: number[] = [];
for (let i = 0; i < TICK_RATE * 2; i++) {
  sim.step();
  const q = sim.getState("w").q;
  yaws.push(Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])));
}
// wobble = MEANINGFUL direction changes of yaw rate after release (deadband
// filters numerical noise around zero)
let flips = 0;
let amp = 0;
for (let i = 2; i < yaws.length; i++) {
  const d1 = yaws[i - 1] - yaws[i - 2];
  const d2 = yaws[i] - yaws[i - 1];
  if (Math.abs(d1) > 0.002 && Math.abs(d2) > 0.002 && Math.sign(d1) !== Math.sign(d2)) {
    flips++;
    amp = Math.max(amp, Math.abs(d2));
  }
}
console.log(`steer-release: significant yaw wobbles over 2s = ${flips} (max step ${amp.toFixed(4)})`);
sim.removeCar("w");

// --- side-touch flip test: victim broadside, attacker at speed ---
sim.addCar("victim", 6, 60, Math.PI / 2); // sideways across the avenue
sim.addCar("rammer", 6, 20, 0);
sim.setInput("rammer", { ...idle, seq: 1, throttle: 1 });
let minUp = 1;
let hitSpeed = 0;
for (let i = 0; i < TICK_RATE * 4; i++) {
  const events = sim.step();
  for (const e of events) {
    if ((e.a === "rammer" || e.b === "rammer") && hitSpeed === 0) hitSpeed = e.relSpeed;
  }
  const q = sim.getState("victim").q;
  const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
  minUp = Math.min(minUp, upY);
}
console.log(`T-bone at rel ${hitSpeed.toFixed(1)} m/s: victim min upY over 4s: ${minUp.toFixed(2)} (flip if < 0.3)`);
