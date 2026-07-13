// Idle-car probe: a car with NO input should sit dead still.
// Measures (a) server-sim drift + per-tick jitter, (b) a client-style
// prediction mirror that gets blendState() corrections every 3 ticks —
// the setup the player actually sees.
import { Sim } from "../shared/src/sim";
import { TICK_RATE } from "../shared/src/constants";

const server = await Sim.create();
const client = await Sim.create();

// Spawn where players spawn: north plaza slot (team 0, w(23)≈? use 0,-258 area).
// Use the same open avenue used by other probes plus an actual plaza point.
const spots: [string, number, number][] = [
  ["avenue", 6, -40],
  ["plaza", 6, -252],
];

for (const [label, x, z] of spots) {
  server.addCar("idle", x, z, 0);
  client.addCar("me", x, z, 0);

  // settle 1s
  for (let i = 0; i < TICK_RATE; i++) {
    server.step();
    client.step();
  }
  const start = server.getState("idle").p;
  const startC = client.getState("me").p;

  let maxTickJump = 0; // biggest per-tick position delta (server)
  let maxTickJumpC = 0; // same for the corrected client mirror
  let maxYawDev = 0;
  let prev = start;
  let prevC = startC;

  for (let i = 0; i < TICK_RATE * 10; i++) {
    server.step();
    client.step();
    // client receives a snapshot every 3 ticks and soft-corrects
    if (i % 3 === 0) {
      const s = server.getState("idle");
      // mimic prediction.correct(): pos+vel blend 0.15, rot deadzone
      const cur = client.getState("me");
      const dot = Math.abs(cur.q[0]*s.q[0]+cur.q[1]*s.q[1]+cur.q[2]*s.q[2]+cur.q[3]*s.q[3]);
      const rotErr = 2 * Math.acos(Math.min(1, dot));
      client.blendState("me", s.p, rotErr < 0.15 ? cur.q : s.q, s.v, 0.15);
    }
    const p = server.getState("idle").p;
    const pc = client.getState("me").p;
    maxTickJump = Math.max(maxTickJump, Math.hypot(p[0]-prev[0], p[1]-prev[1], p[2]-prev[2]));
    maxTickJumpC = Math.max(maxTickJumpC, Math.hypot(pc[0]-prevC[0], pc[1]-prevC[1], pc[2]-prevC[2]));
    prev = p;
    prevC = pc;
    const q = server.getState("idle").q;
    const yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
    maxYawDev = Math.max(maxYawDev, Math.abs(yaw));
  }

  const end = server.getState("idle").p;
  const endC = client.getState("me").p;
  const drift = Math.hypot(end[0] - start[0], end[2] - start[2]);
  const driftC = Math.hypot(endC[0] - startC[0], endC[2] - startC[2]);
  console.log(
    `[${label}] 10s idle: server drift ${drift.toFixed(3)} m (yaw dev ${maxYawDev.toFixed(3)} rad, ` +
    `max tick jump ${(maxTickJump*1000).toFixed(1)} mm) | ` +
    `client-mirror drift ${driftC.toFixed(3)} m, max tick jump ${(maxTickJumpC*1000).toFixed(1)} mm`,
  );
  server.removeCar("idle");
  client.removeCar("me");
}
