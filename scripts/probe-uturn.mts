import { Sim } from "../shared/src/sim";
import { steerToward } from "../server/src/bots";

// Car at avenue facing +z (rotY 0), target directly BEHIND at (6, -80).
// Let steerToward drive for 5s; report remaining angle to target.
const sim = await Sim.create();
sim.addCar("u", 6, -40, 0);
for (let i = 0; i < 30; i++) sim.step();
const target = { x: 6, z: -80 };
let seq = 0;
let rev = false;
for (let s = 0; s < 10; s++) {
  for (let i = 0; i < 60; i++) {
    const { p, q } = sim.getState("u");
    const heading = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
    const cmd = steerToward({ x: p[0], z: p[2] }, heading, target, rev); rev = cmd.reversing;
    sim.setInput("u", { seq: ++seq, throttle: cmd.throttle, steer: cmd.steer, brake: 0, handbrake: false });
    sim.step();
  }
  const { p, q } = sim.getState("u");
  const heading = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
  let angle = Math.atan2(target.x - p[0], target.z - p[2]) - heading;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  const dist = Math.hypot(target.x - p[0], target.z - p[2]);
  console.log(`t=${s + 1}s angleToTarget ${angle.toFixed(2)} dist ${dist.toFixed(1)}`);
}


