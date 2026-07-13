// Counts knockouts vs respawns; respawns in excess of knockouts are hazard
// respawns (water plunge or flip) — proof the world hazards work live.
import WebSocket from "ws";

const seconds = Number(process.argv[2] ?? 120);
const ws = new WebSocket("ws://localhost:8080");
let knockouts = 0;
let respawns = 0;
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", name: "Counter", car: "van" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "knockout") knockouts++;
  if (msg.t === "respawn") respawns++;
});
setTimeout(() => {
  console.log(`knockouts=${knockouts} respawns=${respawns} hazardRespawns=${respawns - knockouts}`);
  process.exit(0);
}, seconds * 1000);
