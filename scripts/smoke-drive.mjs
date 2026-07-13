// Live-server smoke: join, drive 8 s with gentle S-curves, report distance
// covered and worst per-snapshot heading jump (controllability signal).
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
let myId = null;
let seq = 0;
let t0 = null;
let last = null;
let dist = 0;
let worstYawJump = 0;
let lastYaw = null;

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "hello", pass: "botpass", name: `Smoke${Date.now() % 1000}`, car: "race" }));
  setInterval(() => {
    // straight down the spoke street (spawns face it; ~100 m of clear road)
    ws.send(JSON.stringify({ t: "input", input: { seq: ++seq, throttle: 1, steer: 0, brake: 0, handbrake: false } }));
  }, 33);
});

ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") myId = msg.id;
  if (msg.t === "snapshot" && myId) {
    const me = msg.cars.find((c) => c.id === myId);
    if (!me) return;
    t0 ??= msg.time;
    if (last) dist += Math.hypot(me.p[0] - last[0], me.p[2] - last[2]);
    last = me.p;
    const q = me.q;
    const yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
    if (lastYaw !== null) {
      let d = Math.abs(yaw - lastYaw);
      if (d > Math.PI) d = 2 * Math.PI - d;
      worstYawJump = Math.max(worstYawJump, d);
    }
    lastYaw = yaw;
    if (Math.abs((msg.time - t0) % 1) < 0.05)
      console.log(`t=${(msg.time - t0).toFixed(1)} p=(${me.p[0].toFixed(1)}, ${me.p[1].toFixed(2)}, ${me.p[2].toFixed(1)}) v=(${me.v.map((n) => n.toFixed(1)).join(",")})`);
    if (msg.time - t0 > 8) {
      console.log(`drove ${dist.toFixed(0)} m in 8 s; worst yaw jump between snapshots ${(worstYawJump * 57.3).toFixed(1)} deg`);
      process.exit(0);
    }
  }
});
setTimeout(() => { console.error("timeout"); process.exit(1); }, 20000);
