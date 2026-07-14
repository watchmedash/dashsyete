// Reverse-gear stability: reversing with steering is the classic unstable
// trailer geometry (steered wheels trail the motion). Measure yaw-rate
// smoothness while backing up straight and while backing into a turn.
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const sim = await Sim.create();
const idle = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

function yawOf(q: [number, number, number, number]): number {
  return Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
}

for (const [label, steer] of [["straight", 0], ["steer 1", 1], ["steer -1", -1]] as const) {
  sim.addCar("r", -6, -232, 0); // open north plaza
  for (let i = 0; i < TICK_RATE; i++) sim.step(); // settle
  sim.setInput("r", { ...idle, seq: 1, throttle: -1, steer });
  let prevYaw = yawOf(sim.getState("r").q);
  let prevRate = 0;
  let maxJump = 0;
  let maxRate = 0;
  for (let i = 0; i < TICK_RATE * 3; i++) {
    sim.step();
    const yaw = yawOf(sim.getState("r").q);
    let rate = (yaw - prevYaw) * (180 / Math.PI);
    if (rate > 180) rate -= 360;
    if (rate < -180) rate += 360;
    maxJump = Math.max(maxJump, Math.abs(rate - prevRate));
    maxRate = Math.max(maxRate, Math.abs(rate));
    prevYaw = yaw;
    prevRate = rate;
  }
  const v = sim.getState("r").v;
  console.log(
    `REVERSE ${label}: max yaw rate ${maxRate.toFixed(2)} deg/tick, max tick-to-tick jump ${maxJump.toFixed(2)} deg, end speed ${Math.hypot(v[0], v[2]).toFixed(1)} m/s`,
  );
  sim.removeCar("r");
}
