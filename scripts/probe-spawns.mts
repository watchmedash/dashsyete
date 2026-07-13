// Spawn clearance: every spawn slot must fit a car with room to drive out.
// Reports any collider within the car's swing circle at each slot.
import { buildCityMap } from "../shared/src/cityMap";

const map = buildCityMap();
const CAR_RADIUS = 2.4; // half-diagonal of the chassis + margin
let bad = 0;
for (const s of map.spawns) {
  s.points.forEach((p, i) => {
    for (const c of map.colliders) {
      if (c.hy < 0.7) continue; // curbs/rails don't trap cars
      const dx = Math.max(0, Math.abs(p.x - c.x) - c.hx);
      const dz = Math.max(0, Math.abs(p.z - c.z) - c.hz);
      const gap = Math.hypot(dx, dz);
      if (gap < CAR_RADIUS) {
        bad++;
        console.log(
          `team ${s.team} slot ${i} at (${p.x.toFixed(0)},${p.z.toFixed(0)}): collider ` +
          `(${c.x.toFixed(0)},${c.z.toFixed(0)}) hx=${c.hx.toFixed(1)} hz=${c.hz.toFixed(1)} gap=${gap.toFixed(2)}m`,
        );
      }
    }
  });
}
console.log(bad === 0 ? "ALL SPAWN SLOTS CLEAR" : `${bad} cramped slots`);
