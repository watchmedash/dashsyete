import { CAR_MODEL_SCALE, MODEL_SCALES, TILE, WATER_Y } from "./constants";
import { MODEL_FOOTPRINTS } from "./modelFootprints";

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

export interface CrateSpawn {
  x: number;
  z: number;
  /** Weapon granted on pickup ("rapid" | "heavy" | "grenade"). */
  weapon: string;
}

export interface ParkedCar {
  model: string;
  x: number;
  z: number;
  rot: Rot;
}

export interface CityMap {
  size: number;
  tiles: Tile[];
  colliders: BoxCollider[];
  grounds: GroundRect[];
  waterY: number;
  /** FFA spawn points on clear road/plaza ground, ≥30 m apart. */
  spawns: SpawnPoint[];
  /** Weapon pickup points (crate + floating weapon, respawn on a timer). */
  crateSpawns: CrateSpawn[];
  /** Static decorative cars along the streets (cover, not vehicles). */
  parkedCars: ParkedCar[];
  /** Visual-only grass overlays (rendered ~2 cm above the ground slab). */
  greens: GroundRect[];
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

/** A model's bbox-center offset from its pivot, rotated into world space. */
export function rotatedOffset(
  pack: string,
  model: string,
  scale: number,
  rot: Rot,
): { x: number; z: number } {
  const f = MODEL_FOOTPRINTS[`${pack}/${model}`];
  if (!f) throw new Error(`no footprint measured for ${pack}/${model}`);
  let cx = f.cx * scale;
  let cz = f.cz * scale;
  // rotation.y = -rot*PI/2: local (x,z) -> rot1 (-z,x), rot2 (-x,-z), rot3 (z,-x)
  if (rot === 1) [cx, cz] = [-cz, cx];
  else if (rot === 2) [cx, cz] = [-cx, -cz];
  else if (rot === 3) [cx, cz] = [cz, -cx];
  return { x: cx, z: cz };
}

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
  let hx = f.hx * scale;
  let hz = f.hz * scale;
  if (rot === 1 || rot === 3) [hx, hz] = [hz, hx];
  const off = rotatedOffset(pack, model, scale, rot);
  return { x: x + off.x, y: f.cy * scale, z: z + off.z, hx, hy: f.hy * scale, hz };
}

// ---------------------------------------------------------------------------
// Road classification: the road network is a set of cells; each cell picks its
// model + rotation from its 4-neighbours. Rotation tables verified in-game.
// ---------------------------------------------------------------------------

type CellKind = "road" | "plaza" | "round";

// Rotation tables MEASURED by raycasting the road surface at edge midpoints
// (0.12 = open lane, 0.24 = curb) for each model at each rot — see the
// DEBUG_ROADS strip. Don't re-guess them.
const TEE_ROT: Record<string, Rot> = { S: 0, W: 1, N: 2, E: 3 };
const BEND_ROT: Record<string, Rot> = { SW: 0, NW: 1, EN: 2, ES: 3 };
const END_ROT: Record<string, Rot> = { E: 0, S: 1, W: 2, N: 3 };

function classifyRoad(
  cells: Map<string, CellKind>,
  gx: number,
  gz: number,
): { model: string; rot: Rot } {
  // Plazas are open ground abutting the road — they must NOT count as road
  // connections, or every roadside tile along a plaza renders as a
  // T-intersection.
  const has = (dx: number, dz: number) => {
    const kind = cells.get(`${gx + dx},${gz + dz}`);
    return kind !== undefined && kind !== "plaza";
  };
  const n = has(0, -1);
  const s = has(0, 1);
  const e = has(1, 0);
  const west = has(-1, 0);
  const count = Number(n) + Number(s) + Number(e) + Number(west);
  if (count === 4) return { model: "road-crossroad", rot: 0 };
  if (count === 3) {
    const stem = !n ? "S" : !s ? "N" : !e ? "W" : "E";
    return { model: "road-intersection", rot: TEE_ROT[stem] };
  }
  if (count === 2) {
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
// Layout — ONE dense mainland city, tiles [12,36) on both axes (~288 m).
//
//   z 10..11   harbor dock slab (open deck, containers, moored boats)
//   z 12       shoreline promenade
//   z 13 / 34  ring road; x 13 / 34 ring road
//   x 19/24/29 north-south streets; z 19/24/29 east-west streets
//   roundabout 3×3 at the center (23..25)²
//
// District blocks (bx,bz over the 4×4 block grid between the streets):
//   bz=0 north strip ........ industrial (harbor-side)
//   center 2×2 ............. downtown (skyscraper edges, plaza interiors)
//   bx=0,bz=1 .............. west park
//   bx=3,bz=1 .............. east commercial
//   bx=3,bz=2 .............. graveyard old-town corner
//   remaining ring blocks .. suburban
// ---------------------------------------------------------------------------

const COLOR_CITY = "#6a6f76";
const COLOR_DECK = "#5d616a";

// Road models put their DRIVING SURFACE 0.12 m above the model base; sink
// slightly less than 0.12 (exactly coplanar z-fights the ground slab top).
const ROAD_LANE_Y = 0.1;

const COMMERCIAL = ["building-a", "building-b", "building-c", "building-d", "building-e", "building-f", "building-g", "building-h"];
const INDUSTRIAL = ["building-d", "building-h", "building-i", "building-j", "building-k", "building-n", "building-o"];
const SUBURBAN = ["building-type-a", "building-type-c", "building-type-e", "building-type-g", "building-type-h", "building-type-i", "building-type-j", "building-type-k", "building-type-l", "building-type-p", "building-type-q", "building-type-r"];
const SKYSCRAPERS = ["building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-d", "building-skyscraper-e"];
const GRAVESTONES = ["gravestone-cross", "gravestone-round", "gravestone-wide", "gravestone-bevel", "gravestone-decorative"];
const CRYPTS = ["crypt", "crypt-a", "crypt-b", "crypt-small"];
const CARRIAGES = ["train-carriage-box", "train-carriage-coal", "train-carriage-container-red", "train-carriage-tank"];
const CONTAINERS = ["cargo-container-a", "cargo-container-b", "cargo-container-c", "cargo-pile-a"];
const PARKED = ["sedan", "sedan-sports", "suv", "suv-luxury", "hatchback-sports", "taxi", "police", "van", "truck", "delivery"];

// A model whose MEASURED footprint exceeds one tile bulges its collider into
// the neighbouring street — an invisible wall. Filter every list at build time.
const fitsTile = (pack: string, model: string, scale: number): boolean => {
  const f = MODEL_FOOTPRINTS[`${pack}/${model}`];
  return f !== undefined && f.hx * 2 * scale <= TILE + 0.5 && f.hz * 2 * scale <= TILE + 0.5;
};

const DEBUG_ROADS = false;

export function buildCityMap(): CityMap {
  const tiles: Tile[] = [];
  const colliders: BoxCollider[] = [];
  const grounds: GroundRect[] = [];
  const props: PropSpawn[] = [];
  const parkedCars: ParkedCar[] = [];
  const cells = new Map<string, CellKind>();

  const put = (gx: number, gz: number, kind: CellKind) => cells.set(`${gx},${gz}`, kind);
  const groundFromTiles = (tx0: number, tz0: number, tx1: number, tz1: number, color: string) =>
    grounds.push({ x0: edge(tx0), z0: edge(tz0), x1: edge(tx1), z1: edge(tz1), color });

  // ---- Ground slabs --------------------------------------------------------
  groundFromTiles(12, 12, 36, 36, COLOR_CITY); // mainland
  groundFromTiles(13, 10, 35, 12, COLOR_DECK); // harbor dock slab (north)

  // Visual-only grass: the park block + suburban block interiors read as
  // lawns instead of bare concrete (rendered slightly above the slab).
  const greens: GroundRect[] = [
    { x0: edge(14), z0: edge(20), x1: edge(19), z1: edge(29), color: "#6f8f52" }, // west park
    { x0: edge(14), z0: edge(30), x1: edge(19), z1: edge(34), color: "#7a9a5c" },
    { x0: edge(20), z0: edge(30), x1: edge(24), z1: edge(34), color: "#7a9a5c" },
    { x0: edge(25), z0: edge(30), x1: edge(29), z1: edge(34), color: "#7a9a5c" },
    { x0: edge(30), z0: edge(30), x1: edge(34), z1: edge(34), color: "#7a9a5c" },
    { x0: edge(30), z0: edge(25), x1: edge(34), z1: edge(29), color: "#66795b" }, // graveyard turf
  ];

  // ---- Street network ------------------------------------------------------
  for (let g = 13; g <= 34; g++) {
    put(g, 13, "road");
    put(g, 34, "road");
    put(13, g, "road");
    put(34, g, "road");
  }
  for (let g = 14; g <= 33; g++) {
    put(g, 19, "road");
    put(g, 29, "road");
    put(19, g, "road");
    put(29, g, "road");
  }
  for (let z = 14; z <= 22; z++) put(24, z, "road");
  for (let z = 26; z <= 33; z++) put(24, z, "road");
  for (let x = 14; x <= 22; x++) put(x, 24, "road");
  for (let x = 26; x <= 33; x++) put(x, 24, "road");
  for (let x = 23; x <= 25; x++) for (let z = 23; z <= 25; z++) put(x, z, "round");
  tiles.push({ gx: 24, gz: 24, rot: 0, pack: "roads", model: "road-roundabout", y: -ROAD_LANE_Y });

  // ---- Spawns (FFA): ring + inner intersections, all ≥ 60 m apart ----------
  const spawnTiles: [number, number][] = [
    [13, 13], [19, 13], [29, 13], [34, 13],
    [34, 19], [34, 29], [34, 34], [29, 34],
    [19, 34], [13, 34], [13, 29], [13, 19],
    [24, 19], [19, 24], [29, 24], [24, 29],
  ];
  const spawns: SpawnPoint[] = spawnTiles.map(([gx, gz]) => {
    const x = w(gx);
    const z = w(gz);
    return { x, z, rotY: Math.atan2(-x, -z) }; // face downtown
  });

  // ---- Pickup crates (tiles reserved from dressing) ------------------------
  // Weapons, grenades, ammo cells (refill the slot-2 gun) and first-aid kits.
  // Snipers live at the map's long sightlines (dock + graveyard shore).
  const crateTiles: [number, number, string][] = [
    [16, 11, "rapid"], [30, 11, "heavy"], [23, 11, "sniper"], // harbor dock
    [16, 22, "rapid"], [16, 26, "grenade"], [15, 24, "health"], // west park
    [21, 21, "rapid"], [27, 21, "heavy"], // downtown north blocks
    [21, 27, "heavy"], [27, 27, "rapid"], // downtown south blocks
    [22, 22, "ammo"], [26, 26, "ammo"], // downtown corners
    [31, 26, "grenade"], [31, 28, "longshot"], // graveyard corner
    [16, 31, "rapid"], [27, 31, "heavy"], [22, 31, "health"], // suburban south
    [31, 21, "grenade"], [31, 33, "ammo"], [15, 15, "ammo"], // spread
    [30, 15, "health"], [15, 28, "ammo"], [26, 31, "ammo"], [21, 15, "health"],
  ];
  const reserved = new Set(crateTiles.map(([gx, gz]) => `${gx},${gz}`));
  const crateSpawns: CrateSpawn[] = crateTiles.map(([gx, gz, weapon]) => ({ x: w(gx), z: w(gz), weapon }));

  // ---- Placement helper ----------------------------------------------------
  const place = (
    pack: string,
    model: string,
    gx: number,
    gz: number,
    rot: Rot,
    solid: boolean,
    opts: { ox?: number; oz?: number; y?: number; scale?: number } = {},
  ) => {
    const scale = opts.scale ?? MODEL_SCALES[pack];
    const x = w(gx) + (opts.ox ?? 0);
    const z = w(gz) + (opts.oz ?? 0);
    // Anchor by bbox CENTER, not pivot: off-center models otherwise spill
    // into neighbouring tiles.
    const off = rotatedOffset(pack, model, scale, rot);
    const ax = x - off.x;
    const az = z - off.z;
    tiles.push({
      gx: (ax - TILE / 2) / TILE + SIZE / 2,
      gz: (az - TILE / 2) / TILE + SIZE / 2,
      rot,
      pack,
      model,
      y: opts.y,
      scale: opts.scale,
    });
    if (solid) colliders.push(footprintCollider(pack, model, scale, ax, az, rot));
  };
  const hash = (a: number, b: number) => (a * 7 + b * 13) % 97;

  // ---- District dressing over every mainland non-road tile ----------------
  const commercial = COMMERCIAL.filter((m) => fitsTile("commercial", m, MODEL_SCALES.commercial));
  const industrial = INDUSTRIAL.filter((m) => fitsTile("industrial", m, MODEL_SCALES.industrial));
  const suburban = SUBURBAN.filter((m) => fitsTile("suburban", m, MODEL_SCALES.suburban));
  const towers = SKYSCRAPERS.filter((m) => fitsTile("commercial", m, 8.5));

  type District = "industrial" | "downtown" | "park" | "commercial" | "graveyard" | "suburban" | "promenade";
  const districtOf = (x: number, z: number): District => {
    if (x === 12 || x === 35 || z === 12 || z === 35) return "promenade";
    if (z <= 18) return "industrial";
    if (x >= 20 && x <= 28 && z >= 20 && z <= 28) return "downtown";
    if (x <= 18 && z >= 20 && z <= 28) return z <= 24 ? "park" : "park";
    if (x >= 30 && z >= 20 && z <= 24) return "commercial";
    if (x >= 30 && z >= 25 && z <= 28) return "graveyard";
    return "suburban";
  };

  for (let x = 12; x <= 35; x++) {
    for (let z = 12; z <= 35; z++) {
      if (cells.has(`${x},${z}`)) continue;
      if (reserved.has(`${x},${z}`)) continue;
      const isRoad = (dx: number, dz: number) => cells.get(`${x + dx},${z + dz}`) === "road";
      const nextToRoad = isRoad(0, -1) || isRoad(0, 1) || isRoad(1, 0) || isRoad(-1, 0);
      const faceRot: Rot = isRoad(0, 1) ? 0 : isRoad(-1, 0) ? 1 : isRoad(0, -1) ? 2 : 3;
      const h = hash(x, z);
      const d = districtOf(x, z);

      if (d === "promenade") {
        // shoreline strip: light dressing, mostly open walkway
        if (h % 6 === 0) place("graveyard", "lightpost-double", x, z, ((h >> 2) % 4) as Rot, true);
        else if (h % 6 === 3) place("suburban", "planter", x, z, (h % 4) as Rot, true, { scale: 8 });
        continue;
      }
      if (d === "downtown") {
        // skyscraper walls along the streets, open plaza interiors
        if (nextToRoad) place("commercial", towers[h % towers.length], x, z, ((h + x) % 4) as Rot, true, { scale: 8.5 });
        else if (h % 3 === 0) place("commercial", h % 2 ? "detail-parasol-a" : "detail-parasol-b", x, z, 0, true);
        else if (h % 5 === 1) props.push({ pack: "cars", model: "cone", x: w(x), z: w(z) });
        continue;
      }
      if (d === "industrial") {
        if (nextToRoad) place("industrial", industrial[h % industrial.length], x, z, faceRot, true);
        else if (h % 3 === 0) place("industrial", "chimney-large", x, z, 0, true);
        else if (h % 3 === 1) place("industrial", "detail-tank", x, z, (h % 4) as Rot, true);
        else if (h % 7 === 2) props.push({ pack: "cars", model: "box", x: w(x), z: w(z) });
        continue;
      }
      if (d === "park") {
        // dense green: two trees per wooded tile + planters, hay bales to kick
        if (h % 2 === 0) {
          place("suburban", h % 4 < 2 ? "tree-large" : "tree-small", x, z, 0, true, { ox: (h % 5) - 2, oz: (h % 3) - 1 });
          place("suburban", h % 4 < 2 ? "tree-small" : "tree-large", x, z, 0, true, { ox: ((h >> 2) % 5) - 2 + 3, oz: ((h >> 1) % 5) - 2 });
        } else if (h % 5 === 1) place("suburban", "planter", x, z, (h % 4) as Rot, true, { scale: 8 });
        else if (h % 3 === 0) place("graveyard", "pine", x, z, 0, true);
        else if (h % 7 === 2) props.push({ pack: "graveyard", model: "hay-bale", x: w(x), z: w(z) });
        continue;
      }
      if (d === "commercial") {
        if (nextToRoad) place("commercial", commercial[h % commercial.length], x, z, faceRot, true);
        else if (h % 3 === 0) place("commercial", h % 2 ? "detail-parasol-a" : "detail-parasol-b", x, z, 0, true);
        continue;
      }
      if (d === "graveyard") {
        if (nextToRoad && h % 3 === 0) place("graveyard", CRYPTS[h % CRYPTS.length], x, z, faceRot, true);
        else if (h % 2 === 0) place("graveyard", GRAVESTONES[h % GRAVESTONES.length], x, z, (h % 4) as Rot, true, { ox: (h % 5) - 2, oz: (h % 3) - 1 });
        else if (h % 5 === 1) place("graveyard", "pine", x, z, 0, true);
        else if (h % 7 === 3) props.push({ pack: "graveyard", model: h % 2 ? "pumpkin" : "pumpkin-tall", x: w(x), z: w(z) });
        continue;
      }
      // suburban
      if (nextToRoad) place("suburban", suburban[h % suburban.length], x, z, faceRot, true);
      else if (h % 3 === 0) place("suburban", h % 2 ? "tree-large" : "tree-small", x, z, 0, true);
      else if (h % 5 === 1) place("suburban", "fence-low", x, z, (h % 4) as Rot, true);
    }
  }

  // ---- Harbor dock dressing (rows z=10..11 on the deck slab) ---------------
  for (let x = 14; x <= 33; x++) {
    for (let z = 10; z <= 11; z++) {
      if (reserved.has(`${x},${z}`)) continue;
      const h = hash(x, z);
      if (h % 4 === 0) place("watercraft", CONTAINERS[h % CONTAINERS.length], x, z, (h % 2 ? 1 : 0) as Rot, true);
      else if (h % 9 === 1) place("train", CARRIAGES[h % CARRIAGES.length], x, z, 0, true);
      else if (h % 7 === 3) props.push({ pack: "cars", model: "box", x: w(x), z: w(z) });
    }
  }
  // moored boats + buoys along the waterfront
  place("watercraft", "boat-tug-a", 15, 8, 1, false, { y: WATER_Y });
  place("watercraft", "boat-fishing-small", 22, 8, 3, false, { y: WATER_Y });
  place("watercraft", "boat-speed-b", 28, 8, 1, false, { y: WATER_Y });
  place("watercraft", "buoy", 18, 7, 0, false, { y: WATER_Y });
  place("watercraft", "buoy-flag", 31, 7, 0, false, { y: WATER_Y });
  // the ghost ship haunts the graveyard shore (east)
  place("watercraft", "ship-small-ghost", 38, 27, 1, false, { y: WATER_Y });

  // ---- Anchored ships in the far sea ---------------------------------------
  {
    const sea = (pack: string, model: string, x: number, z: number, rot: Rot) => {
      tiles.push({
        gx: (x - TILE / 2) / TILE + SIZE / 2,
        gz: (z - TILE / 2) / TILE + SIZE / 2,
        rot,
        pack,
        model,
        y: WATER_Y,
      });
    };
    sea("watercraft", "ship-large", 200, -220, 0);
    sea("watercraft", "boat-sail-a", -220, 100, 2);
    sea("watercraft", "boat-sail-b", 220, 160, 0);
    sea("watercraft", "buoy-flag", -180, -180, 0);
  }

  // ---- Parked cars along the streets (static cover) ------------------------
  // Curb lane of the east-west cross streets and the ring verticals; never on
  // intersections or spawn tiles.
  const parkAt = (gx: number, gz: number, along: "x" | "z", side: 1 | -1, idx: number) => {
    const model = PARKED[idx % PARKED.length];
    const off = TILE / 2 - 2.2;
    const x = w(gx) + (along === "z" ? side * off : 0);
    const z = w(gz) + (along === "x" ? side * off : 0);
    const rot = (along === "x" ? 1 : 0) as Rot;
    parkedCars.push({ model, x, z, rot });
  };
  const parkCols = [15, 17, 21, 27, 31, 33];
  parkCols.forEach((x, i) => {
    parkAt(x, 19, "x", i % 2 === 0 ? 1 : -1, i);
    parkAt(x, 29, "x", i % 2 === 0 ? -1 : 1, i + 3);
  });
  const parkRows = [15, 21, 27, 31];
  parkRows.forEach((z, i) => {
    parkAt(13, z, "z", i % 2 === 0 ? 1 : -1, i + 6);
    parkAt(34, z, "z", i % 2 === 0 ? -1 : 1, i + 8);
  });

  // ---- The sea + cargo ship patrol (north, off the harbor) -----------------
  const shipPath = [
    { x: 240, z: -220 },
    { x: -240, z: -220 },
    { x: -240, z: -272 },
    { x: 240, z: -272 },
  ];

  // ---- Emit road tiles from the cell network -------------------------------
  for (const [key, kind] of cells) {
    const [gx, gz] = key.split(",").map(Number);
    if (kind === "round") continue; // covered by the roundabout model
    if (kind === "plaza") continue;
    const { model, rot } = classifyRoad(cells, gx, gz);
    tiles.push({ gx, gz, rot, pack: "roads", model, y: -ROAD_LANE_Y });
  }

  if (DEBUG_ROADS) {
    groundFromTiles(2, 40, 13, 47, "#9aa0a8");
    for (let r = 0; r < 4; r++) {
      tiles.push({ gx: 3 + r * 2, gz: 41, rot: r as Rot, pack: "roads", model: "road-bend" });
      tiles.push({ gx: 3 + r * 2, gz: 43, rot: r as Rot, pack: "roads", model: "road-intersection" });
      tiles.push({ gx: 3 + r * 2, gz: 45, rot: r as Rot, pack: "roads", model: "road-end-round" });
    }
    tiles.push({ gx: 11, gz: 41, rot: 0, pack: "roads", model: "road-straight" });
    tiles.push({ gx: 11, gz: 43, rot: 1, pack: "roads", model: "road-straight" });
  }

  // sort for determinism regardless of map iteration insertion order
  tiles.sort((a, b) => a.gx - b.gx || a.gz - b.gz || a.model.localeCompare(b.model));

  return {
    size: SIZE,
    tiles,
    colliders,
    grounds,
    waterY: WATER_Y,
    spawns,
    crateSpawns,
    parkedCars,
    greens,
    shipPath,
    props,
  };
}

/** Static colliders for the parked decor cars (consumed by Sim). */
export function parkedCarCollider(pc: ParkedCar): BoxCollider {
  return footprintCollider("cars", pc.model, CAR_MODEL_SCALE, pc.x, pc.z, pc.rot);
}
