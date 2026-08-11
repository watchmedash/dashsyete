import { Sim } from "../shared/src/sim";

const sim = await Sim.create();
const s = sim.map.spawns[0];
console.log("spawn", s);
sim.addChar("me", s.x, s.z, s.rotY);
for (let i = 0; i < 30; i++) sim.step();
console.log("settled", sim.getState("me"));
sim.setInput("me", { seq: 0, moveX: 0, moveZ: 1, yaw: s.rotY, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false });
for (let i = 0; i < 90; i++) {
  sim.step();
  if (i % 15 === 0) {
    const st = sim.getState("me");
    console.log(i, "p", st.p.map((n) => n.toFixed(2)).join(","), "spd", Math.hypot(st.v[0], st.v[2]).toFixed(2), "grounded", st.grounded);
  }
}
