// Drives full throttle for 5s and reports the server-side position each second.
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
let myId = null;
let seq = 0;
let last = null;
ws.on("open", () => {
  ws.send(JSON.stringify({ t: "hello", pass: "botpass", name: "Probe", car: "race" }));
  setInterval(() => {
    ws.send(JSON.stringify({ t: "input", input: { seq: ++seq, throttle: 1, steer: 0, brake: 0, handbrake: false } }));
  }, 33);
});
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") myId = msg.id;
  if (msg.t === "snapshot" && myId) last = msg.cars.find((c) => c.id === myId);
});
let n = 0;
const timer = setInterval(() => {
  n++;
  if (last) console.log(`t=${n}s pos ${last.p.map((x) => x.toFixed(1)).join(",")} vel ${Math.hypot(last.v[0], last.v[2]).toFixed(1)} m/s`);
  if (n >= 6) { clearInterval(timer); process.exit(0); }
}, 1000);
