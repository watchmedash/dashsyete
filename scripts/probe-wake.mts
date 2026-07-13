// Does a car that has gone idle (slept) respond to throttle again?
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const sim = await Sim.create();
const idle = { seq: 0, throttle: 0, steer: 0, brake: 0, handbrake: false };

sim.addCar("a", 6, -40, 0);
for (let i = 0; i < TICK_RATE * 2; i++) sim.step(); // settle + sleep
const before = sim.getState("a").p;

sim.setInput("a", { ...idle, seq: 1, throttle: 1 });
for (let i = 0; i < TICK_RATE * 2; i++) sim.step();
const after = sim.getState("a").p;
const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
console.log(`throttle after 2s idle: moved ${moved.toFixed(2)} m ${moved < 1 ? "<-- CAR IS DEAD, WON'T WAKE" : "(ok)"}`);

// steering-only input (throttle 0) must also not freeze mid-corner coast
sim.setInput("a", { ...idle, seq: 2, throttle: 0, steer: 1 });
for (let i = 0; i < TICK_RATE; i++) sim.step();
console.log(`coasting with steer-only input: speed ${Math.hypot(sim.getState("a").v[0], sim.getState("a").v[2]).toFixed(1)} m/s`);
