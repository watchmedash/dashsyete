// Are the bots ON the road network? Samples every bot position for N seconds
// and reports how often each sits within a tile of a drivable cell center.
// Usage: npx tsx scripts/check-bot-roads.mts [seconds]
import WebSocket from "ws";
import { buildCityMap, tileToWorld } from "../shared/src/cityMap";

const seconds = Number(process.argv[2] ?? 60);
const map = buildCityMap();
const centers = map.navCells.map(([gx, gz]) => ({ x: tileToWorld(gx), z: tileToWorld(gz) }));

const onRoad = (x: number, z: number) => {
  let best = Infinity;
  for (const c of centers) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < best) best = d;
  }
  return best < 9; // within a tile of a lane center (12 m tiles)
};

const ws = new WebSocket("ws://localhost:8080");
const bots = new Map<string, { name: string; on: number; total: number }>();

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", name: `probe${Date.now() % 1000}`, car: "sedan", pass: "probe1234" })));
ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.t === "welcome") {
    for (const p of msg.players) if (p.bot) bots.set(p.id, { name: p.name, on: 0, total: 0 });
    setTimeout(() => {
      let worst: { name: string; frac: number }[] = [];
      let onSum = 0, total = 0;
      for (const b of bots.values()) {
        if (!b.total) continue;
        onSum += b.on;
        total += b.total;
        worst.push({ name: b.name, frac: b.on / b.total });
      }
      worst.sort((a, b) => a.frac - b.frac);
      console.log(`bots on-road: ${((onSum / total) * 100).toFixed(1)}% of ${total} samples`);
      console.log("least road-bound:", worst.slice(0, 5).map((w) => `${w.name} ${(w.frac * 100).toFixed(0)}%`).join(", "));
      process.exit(0);
    }, seconds * 1000);
  }
  if (msg.t === "snapshot") {
    for (const c of msg.cars) {
      const b = bots.get(c.id);
      if (!b) continue;
      b.total++;
      if (onRoad(c.p[0], c.p[2])) b.on++;
    }
  }
});
