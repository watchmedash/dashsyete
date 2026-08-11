// Server load test: spawns N walking clients (one process, N sockets), all
// sending 60 Hz inputs, then measures — from a quiet observer client — the
// snapshot cadence (target 50 ms), its jitter, and the input-ack lag.
// Usage: node scripts/load-test.mjs [N]
import WebSocket from "ws";
import process from "node:process";

const N = Number(process.argv[2] ?? 20);
const HOST = "ws://localhost:8080";
const run = Math.floor(Math.random() * 1e6);

function bot(i) {
  const ws = new WebSocket(HOST);
  let seq = 0;
  let timer = null;
  ws.on("open", () => {
    ws.send(JSON.stringify({ t: "hello", key: "", name: `LT${run}-${i}`, skin: "character-d" }));
    const yaw = (i / N) * Math.PI * 2;
    timer = setInterval(() => {
      ws.send(
        JSON.stringify({
          t: "input",
          input: {
            seq: ++seq, moveX: 0, moveZ: 1, yaw: yaw + Math.sin(seq / 120), aimPitch: 0,
            jump: false, sprint: seq % 240 < 120, fire: i % 4 === 0 && seq % 30 < 2, nade: false, swap: false,
          },
        }),
      );
    }, 1000 / 60);
  });
  ws.on("close", () => clearInterval(timer));
  ws.on("error", () => {});
  return ws;
}

const bots = [];
let spawned = 0;
const spawnNext = () => {
  if (spawned >= N) return;
  bots.push(bot(spawned++));
  setTimeout(spawnNext, 120); // stagger joins
};
spawnNext();

// Observer: measures snapshot health once all bots are in.
setTimeout(() => {
  const obs = new WebSocket(HOST);
  let seq = 0;
  let lastSnap = 0;
  const gaps = [];
  let lastSeqSent = 0;
  let ackLagSum = 0;
  let acks = 0;
  let entities = 0;
  obs.on("open", () => {
    obs.send(JSON.stringify({ t: "hello", key: "", name: `LTobs${run}`, skin: "character-a" }));
    setInterval(() => {
      lastSeqSent = ++seq;
      obs.send(JSON.stringify({ t: "input", input: { seq, moveX: 0, moveZ: 0, yaw: 0, aimPitch: 0, jump: false, sprint: false, fire: false, nade: false, swap: false } }));
    }, 1000 / 60);
  });
  obs.on("message", (data) => {
    const msg = JSON.parse(String(data));
    if (msg.t !== "snapshot") return;
    const now = performance.now();
    if (lastSnap) gaps.push(now - lastSnap);
    lastSnap = now;
    ackLagSum += lastSeqSent - msg.lastSeq;
    acks++;
    entities = msg.chars.length + msg.darts.length;
  });
  setTimeout(() => {
    gaps.sort((a, b) => a - b);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    const p99 = gaps[Math.floor(gaps.length * 0.99)];
    console.log(`players: ${N + 1}, snapshot entities: ${entities}`);
    console.log(`snapshot gap mean ${mean.toFixed(1)} ms (target 50), p95 ${p95.toFixed(1)}, p99 ${p99.toFixed(1)}, max ${gaps[gaps.length - 1].toFixed(1)}`);
    console.log(`input-ack lag avg ${(ackLagSum / acks).toFixed(1)} ticks (healthy: 1-4)`);
    process.exit(0);
  }, 12000);
}, N * 120 + 2500);
