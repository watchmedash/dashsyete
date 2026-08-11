// Shooting-feel probe: dart hit rates vs a stationary and a strafing target
// at 10/25/40 m, per weapon. Run after ANY sim/projectile/weapon change.
import { Sim } from "../shared/src/sim";
import { stepDarts, type Dart } from "../shared/src/projectiles";
import { CHAR_CENTER_Y, WALK_SPEED } from "../shared/src/character";
import { WEAPONS, DART_LIFE_TICKS } from "../shared/src/weapons";

const sim = await Sim.create();
sim.addStaticBox({ x: 60, y: 0.5, z: 60 }, 500, 50, 500);
sim.step();
const TOP = 50.5;

const mkInput = (over: Record<string, unknown> = {}) => ({
  seq: 0, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false, swap: false, ...over,
});

sim.addChar("shooter", 0, 0, 0);
sim.addChar("target", 0, 0, 0);

for (const weaponId of Object.keys(WEAPONS)) {
  const w = WEAPONS[weaponId];
  for (const dist of [10, 25, 40]) {
    for (const strafe of [false, true]) {
      let hits = 0;
      const SHOTS = 20;
      for (let shot = 0; shot < SHOTS; shot++) {
        sim.setState("shooter", [500, TOP + CHAR_CENTER_Y, 500], [0, 0, 0, 1], [0, 0, 0]);
        sim.setState("target", [500, TOP + CHAR_CENTER_Y, 500 + dist], [0, 0, 0, 1], [0, 0, 0]);
        // strafing target oscillates; naive shooter aims at CURRENT position
        // (a human leads — this probe reports the no-lead baseline)
        const darts: Dart[] = [];
        let hit = false;
        for (let t = 0; t < DART_LIFE_TICKS + 10 && !hit; t++) {
          sim.setInput("target", mkInput({ moveX: strafe ? (Math.floor((t + shot * 7) / 30) % 2 === 0 ? 1 : -1) : 0 }));
          sim.setInput("shooter", mkInput());
          sim.step();
          if (t === 0) {
            const tp = sim.getState("target").p;
            const sp = sim.getState("shooter").p;
            const d = [tp[0] - sp[0], tp[1] + 0.2 - (sp[1] + 0.4), tp[2] - sp[2]];
            const len = Math.hypot(...d);
            darts.push({
              id: `d${shot}`,
              owner: "shooter",
              weapon: weaponId,
              p: [sp[0], sp[1] + 0.4, sp[2]],
              o: [sp[0], sp[1] + 0.4, sp[2]],
              v: [(d[0] / len) * w.dartSpeed, (d[1] / len) * w.dartSpeed, (d[2] / len) * w.dartSpeed],
              ticksLeft: DART_LIFE_TICKS,
            });
          }
          const ends = stepDarts(sim, darts, ["shooter", "target"]);
          if (ends.some((e) => e.hitChar === "target")) hit = true;
        }
        if (hit) hits++;
      }
      console.log(
        `${weaponId.padEnd(8)} ${String(dist).padStart(2)} m ${strafe ? "strafing " : "standing "}: ${hits}/${SHOTS} hits`,
      );
    }
  }
}
console.log(`(walk speed ${WALK_SPEED} m/s vs dart speeds ${Object.values(WEAPONS).map((w) => w.dartSpeed).join("/")})`);
