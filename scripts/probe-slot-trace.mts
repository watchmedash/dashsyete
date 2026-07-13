// Why does an idle car creep at (226,3) but not (226,-6)?
// Compare wheel suspension state, and test sensitivity to heading/offset.
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const sim = await Sim.create();

function run(label: string, x: number, z: number, rotY: number) {
  const car = sim.addCar("t", x, z, rotY);
  for (let k = 0; k < TICK_RATE * 5; k++) sim.step();
  const { p, q } = sim.getState("t");
  const yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
  const drift = Math.hypot(p[0] - x, p[2] - z);
  const susp: string[] = [];
  for (let i = 0; i < 4; i++) {
    const s = car.controller.wheelSuspensionLength(i);
    const c = car.controller.wheelIsInContact(i);
    susp.push(`${s?.toFixed(3)}${c ? "" : "!"}`);
  }
  console.log(
    `${label.padEnd(28)} drift ${drift.toFixed(2).padStart(5)} m, yawΔ ${(yaw - rotY).toFixed(3).padStart(7)}, susp [${susp.join(", ")}]`,
  );
  sim.removeCar("t");
}

run("slot2 (226,3) rot -PI/2", 226, 3, -Math.PI / 2);
run("slot1 (226,-6) rot -PI/2", 226, -6, -Math.PI / 2);
run("slot2 rot 0", 226, 3, 0);
run("slot2 rot PI", 226, 3, Math.PI);
run("slot2 rot PI/2", 226, 3, Math.PI / 2);
run("(226, 3.01)", 226, 3.01, -Math.PI / 2);
run("(226, 4)", 226, 4, -Math.PI / 2);
run("(226.01, 3)", 226.01, 3, -Math.PI / 2);
run("(220, 3)", 220, 3, -Math.PI / 2);
run("(-226,-3) team3", -226, -3, Math.PI / 2);
