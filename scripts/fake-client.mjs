// Minimal test client: joins, holds full throttle, logs a few snapshots.
// Usage: node scripts/fake-client.mjs [name]
import WebSocket from "ws";

const name = process.argv[2] ?? "FakeBot";
const ws = new WebSocket("ws://localhost:8080");
let myId = null;
let seq = 0;
let snapshots = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "hello", pass: "botpass", name, car: "race" }));
  setInterval(() => {
    ws.send(JSON.stringify({ t: "input", input: { seq: ++seq, throttle: 1, steer: 0, brake: 0, handbrake: false } }));
  }, 33);
});

ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") {
    myId = msg.id;
    console.log("welcome:", myId, "team", msg.team, "players:", msg.players.length);
  }
  if (msg.t === "snapshot" && snapshots < 5 && myId) {
    snapshots++;
    const me = msg.cars.find((c) => c.id === myId);
    console.log(`snapshot t=${msg.time.toFixed(2)} lastSeq=${msg.lastSeq} me @`, me ? me.p.map((n) => n.toFixed(1)).join(",") : "?");
    if (snapshots === 5) {
      console.log("OK");
      process.exit(0);
    }
  }
});

ws.on("error", (e) => {
  console.error("ws error:", e.message);
  process.exit(1);
});
setTimeout(() => { console.error("timeout"); process.exit(1); }, 15000);
