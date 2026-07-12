import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
let first = null;
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", name: "TrainCheck", car: "van" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t !== "snapshot") return;
  const train = msg.cars.find((c) => c.id === "train");
  if (!train) { console.log("no train in snapshot!"); process.exit(1); }
  if (!first) {
    first = train.p;
    setTimeout(() => {}, 0);
  } else if (Math.hypot(train.p[0] - first[0], train.p[2] - first[2]) > 10) {
    console.log(`train moving: ${first.map((x) => x.toFixed(0))} -> ${train.p.map((x) => x.toFixed(0))}`);
    process.exit(0);
  }
});
setTimeout(() => { console.log("train did not move"); process.exit(1); }, 10000);
