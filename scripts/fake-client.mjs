// Headless v3 test client: joins as a character, walks a patrol square, and
// (with --shoot) aims at the nearest other player and fires.
// Usage: node scripts/fake-client.mjs [name] [--shoot] [--idle]
import WebSocket from "ws";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--")) ?? "FakeBot";
const shoot = args.includes("--shoot");
const idle = args.includes("--idle");

const ws = new WebSocket("ws://localhost:8080");
let myId = null;
let seq = 0;
let tick = 0;
let me = null;
let others = new Map();

let lastPos = null;
let stuckTicks = 0;
let detourUntil = 0;
let detourYaw = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "hello", key: "", name, skin: "character-d" }));
  setInterval(() => {
    tick++;
    // patrol: walk forward, turn 90° every 4 s
    let yaw = idle ? 0 : Math.floor(tick / 240) * (Math.PI / 2);
    let fire = false;
    let aimPitch = 0;
    if (shoot && me) {
      // aim at the nearest other player and hold the trigger
      let best = null;
      let bestD = Infinity;
      for (const o of others.values()) {
        const d = Math.hypot(o.p[0] - me.p[0], o.p[2] - me.p[2]);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        yaw = Math.atan2(best.p[0] - me.p[0], best.p[2] - me.p[2]);
        const dy = best.p[1] - me.p[1];
        aimPitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, bestD)));
        // close the gap before opening fire (dart range ~45 m, buildings block).
        // PULSE the trigger — the basic blaster is semi-auto (edge-triggered).
        fire = bestD < 25 && tick % 24 < 12;
        // wall-bounce navigation: if we stopped moving while trying to walk,
        // take a 90° detour for ~1.5 s (grid city => detours reach anything)
        if (!fire) {
          if (lastPos && Math.hypot(me.p[0] - lastPos[0], me.p[2] - lastPos[2]) < 0.15) stuckTicks++;
          else stuckTicks = 0;
          lastPos = [me.p[0], me.p[2]];
          if (stuckTicks > 30 && tick >= detourUntil) {
            detourYaw = yaw + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
            detourUntil = tick + 90;
            stuckTicks = 0;
          }
          if (tick < detourUntil) yaw = detourYaw;
        }
      }
    }
    ws.send(
      JSON.stringify({
        t: "input",
        input: {
          seq: ++seq,
          moveX: 0,
          moveZ: idle || fire ? 0 : 1,
          yaw,
          aimPitch,
          jump: false,
          sprint: false,
          fire,
          nade: false,
        },
      }),
    );
  }, 1000 / 60);
});

ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") {
    myId = msg.id;
    console.log("welcome:", myId, "players:", msg.players.length);
  }
  if (msg.t === "snapshot" && myId) {
    others = new Map();
    for (const c of msg.chars) {
      if (c.id === myId) me = c;
      else if (!c.id.startsWith("prop-") && !c.id.startsWith("crate-") && c.id !== "ship") others.set(c.id, c);
    }
  }
  if (msg.t === "damage") console.log(`damage: ${msg.id} -> ${msg.hp.toFixed(0)} hp (by ${msg.attackerId})`);
  if (msg.t === "knockout") console.log(`knockout: ${msg.victimId} by ${msg.attackerId}`);
});

ws.on("error", (e) => {
  console.error("ws error:", e.message);
  process.exit(1);
});
