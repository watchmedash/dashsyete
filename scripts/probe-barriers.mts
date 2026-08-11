// Map-wide invisible-barrier sweep: walk straight lines along every street
// lane AND every block-interior lane, and report any spot where the character
// stops but no static collider explains it (nothing within 1.2 m ahead).
// Legit wall stops are counted silently; ghost stops are listed.
import { Sim } from "../shared/src/sim";
import { tileToWorld } from "../shared/src/cityMap";
import { TILE } from "../shared/src/constants";

const sim = await Sim.create();
const input = (yaw: number) => ({
  seq: 0, moveX: 0, moveZ: 1, yaw, aimPitch: 0, jump: false, sprint: true, fire: false, nade: false, swap: false,
});

interface Ghost {
  x: number;
  z: number;
  heading: string;
}
const ghosts: Ghost[] = [];
let wallStops = 0;
let runs = 0;

function sweepLine(sx: number, sz: number, yaw: number, ticks: number, heading: string): void {
  runs++;
  sim.addChar("s", sx, sz, yaw);
  for (let i = 0; i < 20; i++) sim.step();
  let stillTicks = 0;
  for (let i = 0; i < ticks; i++) {
    sim.setInput("s", input(yaw));
    sim.step();
    const st = sim.getState("s");
    const spd = Math.hypot(st.v[0], st.v[2]);
    if (i > 20 && spd < 0.5) stillTicks++;
    else stillTicks = 0;
    if (stillTicks === 12) {
      // stopped for 0.2 s — is there a real wall ahead?
      const dir: [number, number, number] = [Math.sin(yaw), 0, Math.cos(yaw)];
      const chest = sim.castRayStatic([st.p[0], st.p[1], st.p[2]], dir, 1.2);
      const shin = sim.castRayStatic([st.p[0], st.p[1] - 0.8, st.p[2]], dir, 1.2);
      if (chest === null && shin === null) ghosts.push({ x: st.p[0], z: st.p[2], heading });
      else wallStops++;
      break; // one finding per line is enough
    }
  }
  sim.removeChar("s");
}

// Every street lane: rows/cols of the road grid, both directions, offset to
// each side of the lane so we brush past building fronts and parked cars.
const streets = [13, 19, 24, 29, 34];
for (const g of streets) {
  const c = tileToWorld(g);
  for (const off of [-4, 0, 4]) {
    sweepLine(tileToWorld(13) - 4, c + off, Math.PI / 2, 60 * 36, `east along z=${c + off}`);
    sweepLine(tileToWorld(34) + 4, c + off, -Math.PI / 2, 60 * 36, `west along z=${c + off}`);
    sweepLine(c + off, tileToWorld(13) - 4, 0, 60 * 36, `south along x=${c + off}`);
    sweepLine(c + off, tileToWorld(34) + 4, Math.PI, 60 * 36, `north along x=${c + off}`);
  }
}
// Dock deck sweep (the reproduced ghost-wall zone)
for (const z of [tileToWorld(10), tileToWorld(11)]) {
  sweepLine(tileToWorld(14), z, Math.PI / 2, 60 * 36, `east along dock z=${z}`);
}

console.log(`lines swept: ${runs}, legit wall stops: ${wallStops}`);
if (ghosts.length === 0) console.log("NO ghost barriers found");
for (const g of ghosts) console.log(`GHOST BARRIER at (${g.x.toFixed(1)}, ${g.z.toFixed(1)}) heading ${g.heading}`);
