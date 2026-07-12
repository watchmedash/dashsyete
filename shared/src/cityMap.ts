import { TILE } from "./constants";
import type { TeamId } from "./types";

export type Rot = 0 | 1 | 2 | 3; // quarter turns clockwise around Y

export interface Tile {
  gx: number;
  gz: number;
  rot: Rot;
  pack: string;
  model: string;
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

export interface CityMap {
  size: number;
  tiles: Tile[];
  colliders: BoxCollider[];
  spawns: { team: TeamId; points: SpawnPoint[] }[];
  waypointLoops: { x: number; z: number }[][];
  trainPath: { x: number; z: number }[];
}

export function tileToWorld(g: number, size: number): number {
  return (g - size / 2 + 0.5) * TILE;
}

const SIZE = 24;
// Road lines: ring at 2/21, cross streets at 7/16, central avenues at 12.
const ROAD_LINES = [2, 7, 12, 16, 21];
const RING_MIN = 2;
const RING_MAX = 21;
// Team spawn plazas: 3x3 tiles per quadrant. Team order: 0 NW, 1 NE, 2 SW, 3 SE.
const PLAZAS: { team: TeamId; x0: number; z0: number }[] = [
  { team: 0, x0: 4, z0: 4 },   // Crimson — Downtown (NW)
  { team: 1, x0: 17, z0: 4 },  // Azure — Harbor (NE)
  { team: 2, x0: 4, z0: 17 },  // Emerald — Suburbs (SW)
  { team: 3, x0: 17, z0: 17 }, // Violet — Old Town (SE)
];

const COMMERCIAL = ["building-a", "building-b", "building-c", "building-d", "building-e", "building-f", "building-g", "building-h", "building-i", "building-j", "building-k", "building-l", "building-m", "building-n"];
const SKYSCRAPERS = ["building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-d", "building-skyscraper-e"];
const INDUSTRIAL = ["building-a", "building-b", "building-c", "building-d", "building-e", "building-f", "building-g", "building-h", "building-i", "building-j", "building-k", "building-l", "building-m", "building-n", "building-o", "building-p", "building-q", "building-r", "building-s", "building-t"];
const SUBURBAN = ["building-type-a", "building-type-b", "building-type-c", "building-type-d", "building-type-e", "building-type-f", "building-type-g", "building-type-h", "building-type-i", "building-type-j", "building-type-k", "building-type-l", "building-type-m", "building-type-n", "building-type-o", "building-type-p", "building-type-q", "building-type-r", "building-type-s", "building-type-t", "building-type-u"];
const CRYPTS = ["crypt", "crypt-a", "crypt-b", "crypt-small"];
const GRAVESTONES = ["gravestone-cross", "gravestone-round", "gravestone-wide", "gravestone-bevel", "gravestone-decorative"];
const BOATS = ["ship-cargo-a", "boat-tug-a", "boat-speed-a", "boat-fishing-small", "ship-small", "boat-speed-b"];

const isRoadLine = (g: number) => ROAD_LINES.includes(g);
const inRing = (g: number) => g >= RING_MIN && g <= RING_MAX;
const isRoad = (gx: number, gz: number) =>
  (isRoadLine(gx) && inRing(gz)) || (isRoadLine(gz) && inRing(gx));

function inPlaza(gx: number, gz: number): boolean {
  return PLAZAS.some((p) => gx >= p.x0 && gx < p.x0 + 3 && gz >= p.z0 && gz < p.z0 + 3);
}

/** Quadrant of a tile: 0 NW, 1 NE, 2 SW, 3 SE (matches team ids). */
function quadrant(gx: number, gz: number): TeamId {
  return ((gz < SIZE / 2 ? 0 : 2) + (gx < SIZE / 2 ? 0 : 1)) as TeamId;
}

function roadTile(gx: number, gz: number): { model: string; rot: Rot } {
  const onV = isRoadLine(gx);
  const onH = isRoadLine(gz);
  if (onV && onH) {
    // Junction. Corners of the ring:
    if (gx === RING_MIN && gz === RING_MIN) return { model: "road-bend", rot: 1 };
    if (gx === RING_MAX && gz === RING_MIN) return { model: "road-bend", rot: 2 };
    if (gx === RING_MAX && gz === RING_MAX) return { model: "road-bend", rot: 3 };
    if (gx === RING_MIN && gz === RING_MAX) return { model: "road-bend", rot: 0 };
    // T-junctions on the ring edges (stem points into the city):
    if (gz === RING_MIN) return { model: "road-intersection", rot: 2 };
    if (gz === RING_MAX) return { model: "road-intersection", rot: 0 };
    if (gx === RING_MIN) return { model: "road-intersection", rot: 1 };
    if (gx === RING_MAX) return { model: "road-intersection", rot: 3 };
    // Center roundabout:
    if (gx === 12 && gz === 12) return { model: "road-roundabout", rot: 0 };
    return { model: "road-crossroad", rot: 0 };
  }
  // Straight segment: vertical roads run along z, horizontal along x.
  return onV ? { model: "road-straight", rot: 0 } : { model: "road-straight", rot: 1 };
}

/** Ordered tile centers along the perimeter of a tile rectangle (clockwise). */
function rectLoop(x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let x = x0; x < x1; x++) pts.push({ x: tileToWorld(x, SIZE), z: tileToWorld(z0, SIZE) });
  for (let z = z0; z < z1; z++) pts.push({ x: tileToWorld(x1, SIZE), z: tileToWorld(z, SIZE) });
  for (let x = x1; x > x0; x--) pts.push({ x: tileToWorld(x, SIZE), z: tileToWorld(z1, SIZE) });
  for (let z = z1; z > z0; z--) pts.push({ x: tileToWorld(x0, SIZE), z: tileToWorld(z, SIZE) });
  return pts;
}

export function buildCityMap(): CityMap {
  const tiles: Tile[] = [];
  const colliders: BoxCollider[] = [];

  const w = (g: number) => tileToWorld(g, SIZE);
  const pick = <T>(arr: T[], gx: number, gz: number): T => arr[(gx * 7 + gz * 13) % arr.length];

  // --- Roads + plazas ---
  for (let gx = 0; gx < SIZE; gx++) {
    for (let gz = 0; gz < SIZE; gz++) {
      if (inPlaza(gx, gz)) {
        tiles.push({ gx, gz, rot: 0, pack: "roads", model: "road-square" });
        continue;
      }
      if (isRoad(gx, gz)) {
        const { model, rot } = roadTile(gx, gz);
        tiles.push({ gx, gz, rot, pack: "roads", model });
      }
    }
  }

  // --- Quadrant fill: blocks between roads, inside the ring ---
  for (let gx = RING_MIN + 1; gx < RING_MAX; gx++) {
    for (let gz = RING_MIN + 1; gz < RING_MAX; gz++) {
      if (isRoad(gx, gz) || inPlaza(gx, gz)) continue;
      const nextToRoad =
        isRoad(gx - 1, gz) || isRoad(gx + 1, gz) || isRoad(gx, gz - 1) || isRoad(gx, gz + 1);
      const q = quadrant(gx, gz);
      const x = w(gx);
      const z = w(gz);
      const box = (hy: number, shrink = 0) =>
        colliders.push({ x, y: hy, z, hx: TILE / 2 - shrink, hy, hz: TILE / 2 - shrink });

      if (q === 0) {
        // Downtown: perimeter tiles get buildings; every 4th is a skyscraper.
        if (!nextToRoad) continue;
        const sky = (gx * 3 + gz) % 4 === 0;
        tiles.push({ gx, gz, rot: ((gx + gz) % 4) as Rot, pack: "commercial", model: sky ? pick(SKYSCRAPERS, gx, gz) : pick(COMMERCIAL, gx, gz) });
        box(sky ? 15 : 8, 0.5);
      } else if (q === 1) {
        // Harbor/industrial: warehouses on perimeter, chimneys inside.
        if (nextToRoad) {
          tiles.push({ gx, gz, rot: ((gx + gz) % 4) as Rot, pack: "industrial", model: pick(INDUSTRIAL, gx, gz) });
          box(6, 0.5);
        } else if ((gx + gz) % 3 === 0) {
          tiles.push({ gx, gz, rot: 0, pack: "industrial", model: (gx * 7 + gz) % 2 === 0 ? "chimney-large" : "detail-tank" });
          colliders.push({ x, y: 6, z, hx: 2, hy: 6, hz: 2 });
        }
      } else if (q === 2) {
        // Suburbs: houses on perimeter, trees inside.
        if (nextToRoad) {
          tiles.push({ gx, gz, rot: ((gx + gz) % 4) as Rot, pack: "suburban", model: pick(SUBURBAN, gx, gz) });
          box(3, 0.5);
        } else if ((gx + gz) % 2 === 0) {
          const large = (gx * 5 + gz) % 3 === 0;
          tiles.push({ gx, gz, rot: 0, pack: "suburban", model: large ? "tree-large" : "tree-small" });
          if (large) colliders.push({ x, y: 3, z, hx: 1.2, hy: 3, hz: 1.2 });
        }
      } else {
        // Old Town: crypts on perimeter, gravestones + pines inside (no colliders for stones).
        if (nextToRoad) {
          tiles.push({ gx, gz, rot: ((gx + gz) % 4) as Rot, pack: "graveyard", model: pick(CRYPTS, gx, gz) });
          box(4, 1.5);
        } else if ((gx + gz) % 2 === 0) {
          tiles.push({ gx, gz, rot: ((gx * 3 + gz) % 4) as Rot, pack: "graveyard", model: pick(GRAVESTONES, gx, gz) });
        } else if ((gx + gz) % 5 === 0) {
          tiles.push({ gx, gz, rot: 0, pack: "graveyard", model: "pine" });
          colliders.push({ x, y: 3, z, hx: 1, hy: 3, hz: 1 });
        }
      }
    }
  }

  // --- Train rail loop at ring index 1 ---
  const trainPath: { x: number; z: number }[] = [];
  const R0 = 1;
  const R1 = SIZE - 2; // 22
  for (let gx = R0; gx < R1; gx++) tiles.push({ gx, gz: R0, rot: 1, pack: "train", model: gx === R0 ? "railroad-corner-large" : "railroad-straight" });
  for (let gz = R0; gz < R1; gz++) tiles.push({ gx: R1, gz, rot: 2, pack: "train", model: gz === R0 ? "railroad-corner-large" : "railroad-straight" });
  for (let gx = R1; gx > R0; gx--) tiles.push({ gx, gz: R1, rot: 3, pack: "train", model: gx === R1 ? "railroad-corner-large" : "railroad-straight" });
  for (let gz = R1; gz > R0; gz--) tiles.push({ gx: R0, gz, rot: 0, pack: "train", model: gz === R1 ? "railroad-corner-large" : "railroad-straight" });
  // Ordered path (clockwise, matches tile placement order above):
  for (let gx = R0; gx < R1; gx++) trainPath.push({ x: w(gx), z: w(R0) });
  for (let gz = R0; gz < R1; gz++) trainPath.push({ x: w(R1), z: w(gz) });
  for (let gx = R1; gx > R0; gx--) trainPath.push({ x: w(gx), z: w(R1) });
  for (let gz = R1; gz > R0; gz--) trainPath.push({ x: w(R0), z: w(gz) });

  // --- Arena walls between the rails (ring 1, center ±126) and ring 0 ---
  const WALL = 132;
  const LEN = (SIZE * TILE) / 2; // 144
  colliders.push({ x: 0, y: 5, z: -WALL, hx: LEN, hy: 5, hz: 1 });
  colliders.push({ x: 0, y: 5, z: WALL, hx: LEN, hy: 5, hz: 1 });
  colliders.push({ x: -WALL, y: 5, z: 0, hx: 1, hy: 5, hz: LEN });
  colliders.push({ x: WALL, y: 5, z: 0, hx: 1, hy: 5, hz: LEN });

  // --- Harbor boats east of the wall (visual only, outside the arena) ---
  BOATS.forEach((model, i) => {
    tiles.push({ gx: SIZE - 1, gz: 4 + i * 3, rot: 0, pack: "watercraft", model });
  });

  // --- Team spawn plazas: 6 slots each (2 rows x 3), facing the city center ---
  const spawns = PLAZAS.map(({ team, x0, z0 }) => {
    const points: SpawnPoint[] = [];
    const cx = w(x0 + 1);
    const cz = w(z0 + 1);
    for (let i = 0; i < 6; i++) {
      const x = cx + ((i % 3) - 1) * 8;
      const z = cz + (i < 3 ? -4 : 4);
      points.push({ x, z, rotY: Math.atan2(-x, -z) });
    }
    return { team, points };
  });

  // --- Bot waypoint loops (all on road tiles) ---
  const waypointLoops = [
    rectLoop(RING_MIN, RING_MIN, RING_MAX, RING_MAX), // outer ring
    rectLoop(7, 7, 16, 16),                            // inner block ring
    rectLoop(RING_MIN, RING_MIN, 12, RING_MAX),        // west half loop (uses avenue)
    rectLoop(12, RING_MIN, RING_MAX, RING_MAX),        // east half loop
  ];

  return { size: SIZE, tiles, colliders, spawns, waypointLoops, trainPath };
}
