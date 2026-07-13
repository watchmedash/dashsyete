import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
let first = null;
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", pass: "botpass", name: "ShipCheck", car: "van" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t !== "snapshot") return;
  const ship = msg.cars.find((c) => c.id === "ship");
  if (!ship) { console.log("no ship in snapshot!"); process.exit(1); }
  if (!first) first = ship.p;
  else if (Math.hypot(ship.p[0] - first[0], ship.p[2] - first[2]) > 10) {
    console.log(`ship sailing: ${first.map((x) => x.toFixed(0))} -> ${ship.p.map((x) => x.toFixed(0))}`);
    process.exit(0);
  }
});
setTimeout(() => { console.log("ship did not move"); process.exit(1); }, 15000);
