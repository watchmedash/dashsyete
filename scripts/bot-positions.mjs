import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
let names = new Map();
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", pass: "botpass", name: "PosProbe", car: "van" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") for (const p of msg.players) names.set(p.id, { name: p.name, bot: p.bot, team: p.team });
  if (msg.t === "snapshot") {
    for (const c of msg.cars) {
      const info = names.get(c.id);
      if (info?.bot) console.log(`${info.name} (t${info.team}) pos ${c.p.map((x) => x.toFixed(1)).join(",")} vel ${Math.hypot(c.v[0], c.v[2]).toFixed(1)}`);
    }
    process.exit(0);
  }
});
