// Yaw-rate traces on OPEN ground (north spawn plaza, x -24..12, z -234..-198).
// Run 1: accelerate then hold a full-lock LEFT turn (circle fits the plaza).
// Run 2: fresh car — short turn, release, watch it straighten.
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const sim = await Sim.create();
const idle = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

const yawOf = (q: number[]) =>
  Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));

function trace(label: string, phases: { steer: number; ticks: number }[]) {
  sim.addCar("s", -6, -232, 0);
  sim.setInput("s", { ...idle, seq: 1, throttle: 1 });
  for (let i = 0; i < TICK_RATE; i++) sim.step();
  let prevYaw = yawOf(sim.getState("s").q);
  console.log(label);
  for (const ph of phases) {
    sim.setInput("s", { ...idle, seq: 99, throttle: 1, steer: ph.steer });
    const rates: number[] = [];
    for (let i = 0; i < ph.ticks; i++) {
      sim.step();
      const yaw = yawOf(sim.getState("s").q);
      let d = yaw - prevYaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      rates.push((d * 180) / Math.PI);
      prevYaw = yaw;
    }
    // per-tick oscillation = |rate[i] - rate[i-1]| beyond the mean trend
    const mean = rates.reduce((a, b) => a + b) / rates.length;
    let osc = 0;
    for (let i = 1; i < rates.length; i++) osc = Math.max(osc, Math.abs(rates[i] - rates[i - 1]));
    const { p, v } = sim.getState("s");
    console.log(
      `  steer ${String(ph.steer).padStart(2)}: mean ${mean.toFixed(2)} deg/tick (${(mean * 60).toFixed(0)} deg/s), ` +
      `max tick-to-tick jump ${osc.toFixed(2)} deg, end speed ${Math.hypot(v[0], v[2]).toFixed(1)} m/s ` +
      `at (${p[0].toFixed(0)}, ${p[2].toFixed(0)})`,
    );
  }
  sim.removeCar("s");
}

trace("HOLD TURN 2s:", [{ steer: -1, ticks: TICK_RATE * 2 }]);
trace("TURN 0.5s -> RELEASE 1s:", [
  { steer: -1, ticks: TICK_RATE / 2 },
  { steer: 0, ticks: TICK_RATE },
]);
