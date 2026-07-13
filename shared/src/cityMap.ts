import { TILE, WATER_Y } from "./constants";
import { MODEL_FOOTPRINTS } from "./modelFootprints";
import type { TeamId } from "./types";

export type Rot = 0 | 1 | 2 | 3; // quarter turns (rotation.y = -rot * PI/2)

export interface Tile {
  gx: number;
  gz: number;
  rot: Rot;
  pack: string;
  model: string;
  /** Overrides the pack's default scale (see MODEL_SCALES) when set. */
  scale?: number;
  /** World y offset (e.g. boats float at water level). */
  y?: number;
}

export interface BoxCollider {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  rotY: number;
}

export interface GroundRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  color: string;
}

export interface PropSpawn {
  pack: string;
  model: string;
  x: number;
  z: number;
}

export interface CityMap {
  size: number;
  tiles: Tile[];
  colliders: BoxCollider[];
  grounds: GroundRect[];
  waterY: number;
  spawns: { team: TeamId; points: SpawnPoint[] }[];
  waypointRoutes: { x: number; z: number }[][];
  shipPath: { x: number; z: number }[];
  props: PropSpawn[];
}

export const SIZE = 48;

export function tileToWorld(g: number, size: number = SIZE): number {
  return (g - size / 2 + 0.5) * TILE;
}

const w = (g: number) => tileToWorld(g);
/** World coordinate of a tile boundary (start edge of tile g). */
const edge = (g: number) => (g - SIZE / 2) * TILE;

/** Rotate a tile coordinate q quarter-turns clockwise around the map center. */
function rotT(gx: number, gz: number, q: number): [number, number] {
  for (let i = 0; i < q; i++) [gx, gz] = [SIZE - 1 - gz, gx];
  return [gx, gz];
}

/** Rotate a world point q quarter-turns ((x,z) -> (-z,x) per turn). */
function rotW(x: number, z: number, q: number): [number, number] {
  for (let i = 0; i < q; i++) [x, z] = [-z, x];
  return [x, z];
}

/**
 * Generate a collider from the measured model bounding box at a world
 * position/rotation. `rot` matches the Tile rot (rotation.y = -rot*PI/2).
 */
export function footprintCollider(
  pack: string,
  model: string,
  scale: number,
  x: number,
  z: number,
  rot: Rot,
): BoxCollider {
  const f = MODEL_FOOTPRINTS[`${pack}/${model}`];
  if (!f) throw new Error(`no footprint measured for ${pack}/${model}`);
  let cx = f.cx * scale;
  let cz = f.cz * scale;
  let hx = f.hx * scale;
  let hz = f.hz * scale;
  // rotation.y = -rot*PI/2: local (x,z) -> rot1 (-z,x), rot2 (-x,-z), rot3 (z,-x)
  if (rot === 1) [cx, cz, hx, hz] = [-cz, cx, hz, hx];
  else if (rot === 2) [cx, cz] = [-cx, -cz];
  else if (rot === 3) [cx, cz, hx, hz] = [cz, -cx, hz, hx];
  return { x: x + cx, y: f.cy * scale, z: z + cz, hx, hy: f.hy * scale, hz };
}

// ---------------------------------------------------------------------------
// Road classification: the road network is a set of cells; each cell picks its
// model + rotation from its 4-neighbours. Rotation tables verified in-game.
// ---------------------------------------------------------------------------

type CellKind = "road" | "bridge" | "plaza" | "round";

// T-intersection rot by stem direction (the one road out of line):
const TEE_ROT: Record<string, Rot> = { S: 2, N: 0, E: 1, W: 3 };
// Bend rot by the pair of connected sides (sorted key):
const BEND_ROT: Record<string, Rot> = { EN: 0, ES: 1, SW: 2, NW: 3 };
// Dead end rot by the single connected side:
const END_ROT: Record<string, Rot> = { N: 0, S: 2, E: 1, W: 3 };

function classifyRoad(
  cells: Map<string, CellKind>,
  gx: number,
  gz: number,
): { model: string; rot: Rot } {
  const has = (dx: number, dz: number) => cells.has(`${gx + dx},${gz + dz}`);
  const n = has(0, -1);
  const s = has(0, 1);
  const e = has(1, 0);
  const west = has(-1, 0);
  const count = Number(n) + Number(s) + Number(e) + Number(west);
  if (count === 4) return { model: "road-crossroad", rot: 0 };
  if (count === 3) {
    const stem = !n ? "S" : !s ? "N" : !e ? "W" : "E"; // stem = side opposite the missing one
    return { model: "road-intersection", rot: TEE_ROT[stem] };
  }
  if (count === 2) {
    // measured: road-straight runs along X at rot 0
    if (n && s) return { model: "road-straight", rot: 1 };
    if (e && west) return { model: "road-straight", rot: 0 };
    const key = [n ? "N" : "", s ? "S" : "", e ? "E" : "", west ? "W" : ""]
      .filter(Boolean)
      .sort()
      .join("");
    return { model: "road-bend", rot: BEND_ROT[key] ?? 0 };
  }
  const dir = n ? "N" : s ? "S" : e ? "E" : "W";
  return { model: "road-end-round", rot: END_ROT[dir] };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

// Ground colors per landmass
const COLOR_CENTER = "#5b5f66";
const COLOR_ISLAND = ["#7a7f88", "#8a8577", "#6f8f52", "#5d6b52"]; // uptown, harbor, suburbs, old town
const COLOR_DECK = "#63676e";

const PLAZA = { x0: 22, z0: 4, x1: 25, z1: 7 }; // north island plaza tiles

export function buildCityMap(): CityMap {
  const tiles: Tile[] = [];
  const colliders: BoxCollider[] = [];
  const grounds: GroundRect[] = [];
  const props: PropSpawn[] = [];
  const spawns: { team: TeamId; points: SpawnPoint[] }[] = [];
  const waypointRoutes: { x: number; z: number }[][] = [];
  const cells = new Map<string, CellKind>();
  const bridgeRuns: { gx0: number; gz0: number; gx1: number; gz1: number }[] = [];

  const put = (gx: number, gz: number, kind: CellKind) => cells.set(`${gx},${gz}`, kind);

  const groundFromTiles = (tx0: number, tz0: number, tx1: number, tz1: number, color: string) =>
    grounds.push({ x0: edge(tx0), z0: edge(tz0), x1: edge(tx1), z1: edge(tz1), color });

  // ---- Center island -------------------------------------------------------
  groundFromTiles(16, 16, 32, 32, COLOR_CENTER);
  // ring road
  for (let g = 18; g <= 29; g++) {
    put(g, 18, "road");
    put(g, 29, "road");
    put(18, g, "road");
    put(29, g, "road");
  }
  // avenues + roundabout (3x3 model centered on tile 24)
  for (let z = 16; z <= 22; z++) put(24, z, "road");
  for (let z = 26; z <= 31; z++) put(24, z, "road");
  for (let x = 16; x <= 22; x++) put(x, 24, "road");
  for (let x = 26; x <= 31; x++) put(x, 24, "road");
  for (let x = 23; x <= 25; x++) for (let z = 23; z <= 25; z++) put(x, z, "round");
  tiles.push({ gx: 24, gz: 24, rot: 0, pack: "roads", model: "road-roundabout" });

  // ---- Team islands (north island built in tile coords, stamped 4x) -------
  for (let q = 0; q < 4; q++) {
    const T = (gx: number, gz: number) => rotT(gx, gz, q);
    const putR = (gx: number, gz: number, kind: CellKind) => {
      const [rx, rz] = T(gx, gz);
      put(rx, rz, kind);
    };

    // island slab (tiles x [18,30), z [1,13))
    {
      const [ax, az] = T(18, 1);
      const [bx, bz] = T(29, 12);
      groundFromTiles(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx) + 1, Math.max(az, bz) + 1, COLOR_ISLAND[q]);
    }
    // corner islet slab (tiles x [34,38), z [9,13))
    {
      const [ax, az] = T(34, 9);
      const [bx, bz] = T(37, 12);
      groundFromTiles(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx) + 1, Math.max(az, bz) + 1, COLOR_DECK);
    }

    // plaza
    for (let x = PLAZA.x0; x < PLAZA.x1; x++)
      for (let z = PLAZA.z0; z < PLAZA.z1; z++) putR(x, z, "plaza");
    // plaza ring
    for (let g = 21; g <= 25; g++) {
      putR(g, 3, "road");
      putR(g, 7, "road");
    }
    for (let z = 3; z <= 12; z++) {
      putR(21, z, "road");
      putR(25, z, "road");
    }
    // spoke street + bridge to center
    for (let z = 7; z <= 12; z++) putR(24, z, "road");
    for (let z = 13; z <= 15; z++) putR(24, z, "bridge");
    // cross streets
    for (let x = 18; x <= 29; x++) {
      putR(x, 10, "road");
      putR(x, 12, "road");
    }
    // outgoing ring link: bridge east on row 10, islet bend, bridge south
    for (let x = 30; x <= 33; x++) putR(x, 10, "bridge");
    for (let x = 34; x <= 35; x++) putR(x, 10, "road"); // on islet
    for (let z = 10; z <= 12; z++) putR(35, z, "road"); // islet turn
    for (let z = 13; z <= 17; z++) putR(35, z, "bridge"); // south to next island

    // bridge runs (for decks + rails), in stamped coordinates
    for (const run of [
      { gx0: 24, gz0: 13, gx1: 24, gz1: 15 },
      { gx0: 30, gz0: 10, gx1: 33, gz1: 10 },
      { gx0: 35, gz0: 13, gx1: 35, gz1: 17 },
    ]) {
      const [ax, az] = T(run.gx0, run.gz0);
      const [bx, bz] = T(run.gx1, run.gz1);
      bridgeRuns.push({
        gx0: Math.min(ax, bx),
        gz0: Math.min(az, bz),
        gx1: Math.max(ax, bx),
        gz1: Math.max(az, bz),
      });
    }

    // spawns: 6 slots on the plaza facing the spoke (toward map center)
    const points: SpawnPoint[] = [];
    for (let i = 0; i < 6; i++) {
      const lx = w(23) + ((i % 3) - 1) * 9;
      const lz = w(5) + (i < 3 ? -4 : 4);
      const [x, z] = rotW(lx, lz, q);
      points.push({ x, z, rotY: -q * (Math.PI / 2) });
    }
    spawns.push({ team: q as TeamId, points });

    // route: plaza ring -> spoke -> center ring circuit -> back
    const routeTiles: [number, number][] = [
      [21, 3], [25, 3], [25, 7], [24, 9], [24, 12], [24, 14], [24, 17],
      [29, 18], [29, 24], [29, 29], [24, 29], [18, 29], [18, 24], [18, 18], [24, 18],
      [24, 15], [24, 11], [25, 9], [21, 7],
    ];
    waypointRoutes.push(
      routeTiles.map(([gx, gz]) => {
        const [rx, rz] = T(gx, gz);
        return { x: w(rx), z: w(rz) };
      }),
    );

    // skeleton props: cones at the plaza corners (themed in island dressing)
    for (const [px, pz] of [
      [w(21) + 4, w(3) + 4],
      [w(25) - 4, w(3) + 4],
      [w(21) + 4, w(7) - 4],
      [w(25) - 4, w(7) - 4],
      [w(23), w(8)],
    ] as [number, number][]) {
      const [x, z] = rotW(px, pz, q);
      props.push({ pack: "cars", model: "cone", x, z });
    }
  }

  // center props (construction zone placeholder, themed later)
  for (const [x, z] of [
    [w(21), w(21)], [w(27), w(21)], [w(21), w(27)], [w(27), w(27)],
  ] as [number, number][]) {
    props.push({ pack: "cars", model: "cone", x, z });
  }

  // ---- Bridge decks + rails ------------------------------------------------
  for (const run of bridgeRuns) {
    const x0 = edge(run.gx0);
    const z0 = edge(run.gz0);
    const x1 = edge(run.gx1 + 1);
    const z1 = edge(run.gz1 + 1);
    grounds.push({ x0, z0, x1, z1, color: COLOR_DECK });
    // low side rails along the long axis
    const vertical = run.gx0 === run.gx1;
    if (vertical) {
      const cx = (x0 + x1) / 2;
      colliders.push({ x: cx - TILE / 2 + 0.3, y: 0.6, z: (z0 + z1) / 2, hx: 0.3, hy: 0.6, hz: (z1 - z0) / 2 });
      colliders.push({ x: cx + TILE / 2 - 0.3, y: 0.6, z: (z0 + z1) / 2, hx: 0.3, hy: 0.6, hz: (z1 - z0) / 2 });
    } else {
      const cz = (z0 + z1) / 2;
      colliders.push({ x: (x0 + x1) / 2, y: 0.6, z: cz - TILE / 2 + 0.3, hx: (x1 - x0) / 2, hy: 0.6, hz: 0.3 });
      colliders.push({ x: (x0 + x1) / 2, y: 0.6, z: cz + TILE / 2 - 0.3, hx: (x1 - x0) / 2, hy: 0.6, hz: 0.3 });
    }
  }

  // ---- Emit road tiles from the cell network -------------------------------
  for (const [key, kind] of cells) {
    const [gx, gz] = key.split(",").map(Number);
    if (kind === "round") continue; // covered by the roundabout model
    if (kind === "plaza") continue; // open asphalt: bare ground reads better than boxed road-squares
    if (kind === "bridge") {
      // bridge orientation from neighbours
      const has = (dx: number, dz: number) => cells.has(`${gx + dx},${gz + dz}`);
      const rot: Rot = has(0, -1) || has(0, 1) ? 0 : 1;
      // road-bridge is an elevated overpass (deck at 6.12 m, underpass at 0);
      // sink it so the deck meets the flat physics deck at y=0 and the
      // understructure descends into the sea like bridge supports.
      tiles.push({ gx, gz, rot, pack: "roads", model: "road-bridge", y: -6.12 });
      continue;
    }
    const { model, rot } = classifyRoad(cells, gx, gz);
    tiles.push({ gx, gz, rot, pack: "roads", model });
  }

  // ---- The sea -------------------------------------------------------------
  const shipPath = [
    { x: 284, z: 284 },
    { x: 284, z: -284 },
    { x: -284, z: -284 },
    { x: -284, z: 284 },
  ];

  // sort tiles for determinism regardless of map iteration insertion order
  tiles.sort((a, b) => a.gx - b.gx || a.gz - b.gz || a.model.localeCompare(b.model));

  return {
    size: SIZE,
    tiles,
    colliders,
    grounds,
    waterY: WATER_Y,
    spawns,
    waypointRoutes,
    shipPath,
    props,
  };
}
