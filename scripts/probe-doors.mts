import { Sim } from "../shared/src/sim";
import { buildCityMap } from "../shared/src/cityMap";

const map = buildCityMap();
// outer entry step: the [0, 0.33] box (y 0.165, hy 0.165)
const steps = map.colliders.filter((c) => Math.abs(c.y - 0.125) < 0.01 && Math.abs(c.hy - 0.125) < 0.01);
// interior floor slabs: y 0.5, hy 0.5, big
const floors = map.colliders.filter((c) => Math.abs(c.y - 0.5) < 0.01 && c.hx > 3);
console.log(`doors found: ${steps.length}, floors: ${floors.length}`);

const sim = await Sim.create();
let entered = 0;
for (const step of steps.slice(0, 6)) {
  // nearest floor slab = this building's interior
  const floor = floors.reduce((a, b) =>
    Math.hypot(a.x - step.x, a.z - step.z) < Math.hypot(b.x - step.x, b.z - step.z) ? a : b,
  );
  // walk PERPENDICULAR to the facade: along the step's narrow axis,
  // signed toward the building interior
  const alongZ = step.hz < step.hx; // narrow in z => door faces +-z
  const sign = alongZ ? Math.sign(floor.z - step.z) : Math.sign(floor.x - step.x);
  const dx = alongZ ? 0 : sign;
  const dz = alongZ ? sign : 0;
  const yaw = Math.atan2(dx, dz);
  const sx = step.x - dx * 3;
  const sz = step.z - dz * 3;
  sim.addChar("e", sx, sz, yaw);
  for (let i = 0; i < 30; i++) sim.step();
  for (let i = 0; i < 360; i++) {
    sim.setInput("e", { seq: 0, moveX: 0, moveZ: 1, yaw, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false, swap: false });
    sim.step();
  }
  const p = sim.getState("e").p;
  const inside =
    Math.abs(p[0] - floor.x) < floor.hx && Math.abs(p[2] - floor.z) < floor.hz && p[1] > 1.5;
  console.log(
    `door@(${step.x.toFixed(0)},${step.z.toFixed(0)}) -> (${p[0].toFixed(1)}, ${p[1].toFixed(2)}, ${p[2].toFixed(1)}) ${inside ? "ENTERED" : "no"}`,
  );
  if (inside) entered++;
  sim.removeChar("e");
}
console.log(`entered ${entered}/6`);
