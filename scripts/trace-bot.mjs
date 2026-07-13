import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
let botId = null;
let botName = null;
let last = null;
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", pass: "botpass", name: "Tracer", car: "van" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") {
    const bot = msg.players.find((p) => p.bot);
    botId = bot.id;
    botName = bot.name;
    console.log("tracing", botName);
  }
  if (msg.t === "snapshot" && botId) last = msg.cars.find((c) => c.id === botId);
});
let n = 0;
setInterval(() => {
  n++;
  if (last) {
    const q = last.q;
    const yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
    console.log(`t=${n}s pos ${last.p.map((x) => x.toFixed(1)).join(",")} vel ${Math.hypot(last.v[0], last.v[2]).toFixed(1)} yaw ${yaw.toFixed(2)}`);
  }
  if (n >= 15) process.exit(0);
}, 1000);
