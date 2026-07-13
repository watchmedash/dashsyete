// Idle drift at every REAL spawn point: a freshly spawned car with no input
// must sit still. Reports drift + biggest per-tick jump for each slot.
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const sim = await Sim.create();

for (const { team, points } of sim.map.spawns) {
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    sim.addCar("t", pt.x, pt.z, pt.rotY);
    for (let k = 0; k < TICK_RATE; k++) sim.step(); // settle 1s
    const start = sim.getState("t").p;
    let maxJump = 0;
    let prev = start;
    for (let k = 0; k < TICK_RATE * 5; k++) {
      sim.step();
      const p = sim.getState("t").p;
      maxJump = Math.max(maxJump, Math.hypot(p[0]-prev[0], p[1]-prev[1], p[2]-prev[2]));
      prev = p;
    }
    const end = sim.getState("t").p;
    const drift = Math.hypot(end[0]-start[0], end[2]-start[2]);
    const flag = drift > 0.05 || maxJump > 0.005 ? "  <-- MOVES" : "";
    console.log(`team ${team} slot ${i} (${pt.x.toFixed(0)},${pt.z.toFixed(0)}): drift ${drift.toFixed(3)} m, max tick jump ${(maxJump*1000).toFixed(1)} mm${flag}`);
    sim.removeCar("t");
  }
}
