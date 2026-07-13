// Is the T-bone flip caused by the victim SLEEPING at impact?
// Variant A: victim idle (sleeps). Variant B: victim held awake by a
// hair of throttle. Variant C: victim awake, rammer slower (bump speed).
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const idle = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

async function tbone(label: string, victimThrottle: number, rammerRun: number) {
  const sim = await Sim.create();
  sim.addCar("victim", 6, 60, Math.PI / 2);
  sim.addCar("rammer", 6, 60 - rammerRun, 0);
  if (victimThrottle) sim.setInput("victim", { ...idle, seq: 1, throttle: victimThrottle });
  sim.setInput("rammer", { ...idle, seq: 1, throttle: 1 });
  let minUp = 1, maxY = 0, hit = 0;
  for (let i = 0; i < TICK_RATE * 4; i++) {
    for (const e of sim.step()) if (!hit) hit = e.relSpeed;
    const q = sim.getState("victim").q;
    minUp = Math.min(minUp, 1 - 2 * (q[0] * q[0] + q[2] * q[2]));
    maxY = Math.max(maxY, sim.getState("victim").p[1], sim.getState("rammer").p[1]);
  }
  console.log(`${label}: rel ${hit.toFixed(1)} m/s, victim minUp ${minUp.toFixed(2)}, maxY ${maxY.toFixed(2)}`);
}

await tbone("A sleeping victim, 40m run", 0, 40);
await tbone("B awake victim,   40m run", 0.02, 40);
await tbone("A sleeping victim, 25m run", 0, 25);
await tbone("A sleeping victim, 15m run", 0, 15);
