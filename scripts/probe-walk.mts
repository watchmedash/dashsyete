// Movement-feel probe: from every map spawn, walk straight for 6 s and report
// speed stability (max tick-to-tick jump), plus idle stillness and a curb
// step-up check. Run after ANY sim/character/map change.
import { Sim } from "../shared/src/sim";
import { WALK_SPEED, SPRINT_SPEED } from "../shared/src/character";

const sim = await Sim.create();
const input = (over: Record<string, unknown> = {}) => ({
  seq: 0, moveX: 0, moveZ: 1, yaw: 0, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false, ...over,
});

let worstJump = 0;
let worstIdle = 0;
let stalls = 0;

for (let s = 0; s < sim.map.spawns.length; s++) {
  const spawn = sim.map.spawns[s];
  const id = `w${s}`;
  sim.addChar(id, spawn.x, spawn.z, spawn.rotY);
  for (let i = 0; i < 30; i++) sim.step();

  // idle stillness
  const p0 = sim.getState(id).p;
  for (let i = 0; i < 60; i++) sim.step();
  const p1 = sim.getState(id).p;
  worstIdle = Math.max(worstIdle, Math.hypot(p1[0] - p0[0], p1[2] - p0[2]));

  // walk straight along the spawn facing; sprint the second half
  let prevSpeed = 0;
  let localStall = 0;
  for (let i = 0; i < 360; i++) {
    sim.setInput(id, input({ yaw: spawn.rotY, sprint: i >= 180 }));
    sim.step();
    const v = sim.getState(id).v;
    const speed = Math.hypot(v[0], v[2]);
    if (i > 20 && i !== 180 + 20) {
      // exclude ramp-up windows from the jump stat
      worstJump = Math.max(worstJump, Math.abs(speed - prevSpeed));
    }
    const cap = i >= 180 ? SPRINT_SPEED : WALK_SPEED;
    if (i > 40 && i < 170 && speed < cap * 0.3) localStall++;
    prevSpeed = speed;
  }
  if (localStall > 30) stalls++; // blocked by a wall is fine briefly; long stall = report
  sim.removeChar(id);
}

console.log(`spawns probed: ${sim.map.spawns.length}`);
console.log(`worst idle drift over 1 s: ${(worstIdle * 1000).toFixed(2)} mm (target < 1 mm)`);
console.log(`worst tick-to-tick speed jump mid-stride: ${worstJump.toFixed(2)} m/s`);
console.log(`spawns with long stalls (walked into a wall): ${stalls}`);

// curb step-up on a synthetic platform
sim.addStaticBox({ x: 12, y: 0.5, z: 12 }, 500, 50, 500);
sim.addStaticBox({ x: 3, y: 0.1, z: 3 }, 500, 50.6, 506);
sim.addChar("curb", 0, 0, 0);
sim.setState("curb", [500, 51.5, 500], [0, 0, 0, 1], [0, 0, 0]);
for (let i = 0; i < 30; i++) sim.step();
const restY = sim.getState("curb").p[1];
let maxY = restY;
for (let i = 0; i < 120; i++) {
  sim.setInput("curb", input());
  sim.step();
  maxY = Math.max(maxY, sim.getState("curb").p[1]);
}
const end = sim.getState("curb");
console.log(
  `curb step-up: z +${(end.p[2] - 500).toFixed(1)} m, peak y +${(maxY - restY).toFixed(2)} m ${maxY - restY > 0.15 ? "OK" : "FAILED"}`,
);
