// Observes the arena for N seconds: bot movement, knockouts, scores.
import WebSocket from "ws";

const seconds = Number(process.argv[2] ?? 30);
const ws = new WebSocket("ws://localhost:8080");
const names = new Map();
let firstSnap = null;
let lastSnap = null;
let kills = 0;
let damageEvents = 0;
let lastScores = null;

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", name: "Watcher", car: "van" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") {
    for (const p of msg.players) names.set(p.id, p.name);
    console.log(`players: ${msg.players.length} (${msg.players.filter((p) => p.bot).length} bots)`);
  }
  if (msg.t === "join") names.set(msg.player.id, msg.player.name);
  if (msg.t === "snapshot") {
    if (!firstSnap) firstSnap = new Map(msg.cars.map((c) => [c.id, c.p]));
    lastSnap = msg.cars;
  }
  if (msg.t === "damage") damageEvents++;
  if (msg.t === "knockout") {
    kills++;
    lastScores = msg.scores;
    console.log(`💥 ${names.get(msg.attackerId)} knocked out ${names.get(msg.victimId)} | teams: ${msg.scores.teams.join("/")}`);
  }
});

setTimeout(() => {
  if (firstSnap && lastSnap) {
    let moved = 0;
    for (const c of lastSnap) {
      const s = firstSnap.get(c.id);
      if (s && Math.hypot(c.p[0] - s[0], c.p[2] - s[2]) > 20) moved++;
    }
    console.log(`\ncars that moved >20m: ${moved}/${lastSnap.length}`);
  }
  console.log(`damage events: ${damageEvents}, knockouts observed: ${kills}`);
  if (lastScores) {
    const top = [...lastScores.players].sort((a, b) => b.score - a.score).slice(0, 3);
    console.log("top scorers:", top.map((p) => `${names.get(p.id)}:${p.score}`).join(" "));
  }
  process.exit(0);
}, seconds * 1000);
