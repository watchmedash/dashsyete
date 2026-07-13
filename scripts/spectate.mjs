// Joins as a spectator and reports the named player's server-side speed.
import WebSocket from "ws";

const target = process.argv[2] ?? "Dev";
const ws = new WebSocket("ws://localhost:8080");
let targetId = null;
let last = null;
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", pass: "botpass", name: "Spec", car: "van" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") {
    const p = msg.players.find((p) => p.name === target);
    if (!p) { console.log("target not found; players:", msg.players.map((x) => x.name).join(",")); process.exit(1); }
    targetId = p.id;
  }
  if (msg.t === "snapshot" && targetId) last = msg.cars.find((c) => c.id === targetId);
});
let n = 0;
setInterval(() => {
  n++;
  if (last) console.log(`t=${n}s ${target} pos ${last.p.map((x) => x.toFixed(1)).join(",")} vel ${Math.hypot(last.v[0], last.v[2]).toFixed(1)} m/s`);
  if (n >= 5) process.exit(0);
}, 1000);
