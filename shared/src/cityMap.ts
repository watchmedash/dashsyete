import { MODEL_SCALES, TILE, WATER_Y } from "./constants";
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
  /** World y offset. */
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
  /** Floor height (building lobbies sit at y=1; street level omits it). */
  y?: number;
  /** Item granted on pickup (weapon id | "grenade" | "ammo" | "health"). */
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
  /** FFA spawn points on clear ground, ≥30 m apart. */
  spawns: SpawnPoint[];
  /** Pickup points (crate + floating item, respawn on a timer). */
  crateSpawns: CrateSpawn[];
  /** Unused in the downtown map (kept for interface stability). */
  parkedCars: ParkedCar[];
  /** Visual-only overlays (unused downtown). */
  greens: GroundRect[];
  shipPath: { x: number; z: number }[];
  props: PropSpawn[];
  /** Visible slabs for walkable colliders that no model draws (building
   * interiors, door steps) — without these players stand on invisible
   * platforms and read as FLOATING. */
  floors: FloorBox[];
}

export interface FloorBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  color: string;
}

export const SIZE = 48;

export function tileToWorld(g: number, size: number = SIZE): number {
  return (g - size / 2 + 0.5) * TILE;
}

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

export function parkedCarCollider(pc: ParkedCar): BoxCollider {
  return footprintCollider("cars", pc.model, MODEL_SCALES.cars, pc.x, pc.z, pc.rot);
}

// ---------------------------------------------------------------------------
// v4 DOWNTOWN — built exclusively from the Quaternius Downtown City MegaKit.
//
// Manhattan-style island: a 5×5 grid of city blocks on a 48 m pitch.
// Streets are 12 m wide (2 lanes + baked sidewalks, 6 m modules); block
// interiors are 36×36 m courtyards ringed by brick/metal towers whose fronts
// sit on the sidewalk line. Alleys between towers cut into every block.
// The sea surrounds the island (fall in -> hazard respawn, as ever).
// ---------------------------------------------------------------------------

const PITCH = 48; // street-centerline spacing
const STREET_HALF = 6; // street total width 12 (incl sidewalks)
const CURB = 0.15; // sidewalk height baked into the street models
const EDGE = 2 * PITCH + STREET_HALF; // outermost street edge (=102)
const APRON = 12; // paved promenade beyond the last street
const COLOR_CITY = "#63666d";

const BUILDINGS = ["Building_Small_1", "Building_Medium_2_001", "Building_Large_2"];

// ---------------------------------------------------------------------------
// CUSTOM MAPS: export from the map builder (?editor) as custom-map.json and
// drop the file at shared/src/customMap.json — when it has pieces, the game
// builds THAT city (both server colliders and client visuals) instead of the
// procedural downtown. An empty pieces array keeps the procedural city.
// ---------------------------------------------------------------------------
import customMap from "./customMap.json";

interface CustomPiece {
  model: string;
  x: number;
  y: number;
  z: number;
  rot: Rot;
}

interface CustomMapFile {
  version?: number;
  /** Optional editor map size in 48 m tiles; only widens the ground slab. */
  size?: { w?: number; d?: number };
  pieces: CustomPiece[];
}

export function buildCustomMap(pieces: CustomPiece[], size?: { w?: number; d?: number }): CityMap {
  const tiles: Tile[] = [];
  const colliders: BoxCollider[] = [];
  const w2t = (x: number) => x / TILE + SIZE / 2 - 0.5;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const p of pieces) {
    tiles.push({ gx: w2t(p.x), gz: w2t(p.z), rot: p.rot, pack: "downtown", model: p.model, y: p.y });
    minX = Math.min(minX, p.x - 15);
    maxX = Math.max(maxX, p.x + 15);
    minZ = Math.min(minZ, p.z - 15);
    maxZ = Math.max(maxZ, p.z + 15);
    // solid collider for anything wall-height; flat pieces (streets,
    // sidewalks, decals, floors) stay walkable
    const f = MODEL_FOOTPRINTS[`downtown/${p.model}`];
    if (!f || f.hy <= 0.2 || p.model.startsWith("Decal_")) continue;
    const c = footprintCollider("downtown", p.model, 1, p.x, p.z, p.rot);
    c.y += p.y;
    colliders.push(c);
  }
  if (!Number.isFinite(minX)) {
    minX = -60;
    maxX = 60;
    minZ = -60;
    maxZ = 60;
  }
  // Editor-declared map size (tiles of 48 m): only ever WIDENS the ground slab
  // so the island covers the full authored footprint. Absent size = old files.
  if (size) {
    // the editor authors size in 48 m city-block tiles (PITCH), not street modules
    const hx = ((Number(size.w) || 0) * 48) / 2;
    const hz = ((Number(size.d) || 0) * 48) / 2;
    minX = Math.min(minX, -hx);
    maxX = Math.max(maxX, hx);
    minZ = Math.min(minZ, -hz);
    maxZ = Math.max(maxZ, hz);
  }

  const grounds: GroundRect[] = [{ x0: minX, z0: minZ, x1: maxX, z1: maxZ, color: COLOR_CITY }];

  // spawns: spread across street pieces (fallback: a ring near the center)
  const streets = pieces.filter((p) => p.model.startsWith("Street_"));
  const spawns: SpawnPoint[] = [];
  const src = streets.length >= 4 ? streets : pieces;
  const stride = Math.max(1, Math.floor(src.length / 16));
  for (let i = 0; i < src.length && spawns.length < 16; i += stride) {
    const p = src[i];
    if (spawns.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 20)) continue;
    spawns.push({ x: p.x, z: p.z, rotY: Math.atan2(-p.x, -p.z) });
  }
  if (spawns.length === 0) spawns.push({ x: 0, z: 0, rotY: 0 });

  // pickups: rotate the item table across spawn-adjacent spots
  const items = ["rapid", "heavy", "sniper", "longshot", "grenade", "ammo", "health"];
  const crateSpawns: CrateSpawn[] = spawns
    .slice(0, 12)
    .map((s, i) => ({ x: s.x + 4, z: s.z + 4, weapon: items[i % items.length] }));

  const shipPath = [
    { x: maxX + 80, z: minZ - 40 },
    { x: minX - 80, z: minZ - 40 },
    { x: minX - 80, z: minZ - 90 },
    { x: maxX + 80, z: minZ - 90 },
  ];

  tiles.sort((a, b) => a.gx - b.gx || a.gz - b.gz || a.model.localeCompare(b.model));
  return {
    size: SIZE,
    tiles,
    colliders,
    grounds,
    waterY: WATER_Y,
    spawns,
    crateSpawns,
    parkedCars: [],
    greens: [],
    shipPath,
    props: [],
    floors: [],
  };
}

export function buildCityMap(): CityMap {
  const custom = customMap as CustomMapFile;
  if (custom.pieces.length > 0) return buildCustomMap(custom.pieces, custom.size);
  const tiles: Tile[] = [];
  const colliders: BoxCollider[] = [];
  const props: PropSpawn[] = [];
  const floorBoxes: FloorBox[] = [];
  const w2t = (x: number) => x / TILE + SIZE / 2 - 0.5; // world -> fractional tile coord

  const put = (model: string, x: number, z: number, rot: Rot, y = 0) => {
    tiles.push({ gx: w2t(x), gz: w2t(z), rot, pack: "downtown", model, y });
  };
  /** Place a model by PIVOT + emit its footprint collider. */
  const putSolid = (model: string, x: number, z: number, rot: Rot) => {
    put(model, x, z, rot);
    colliders.push(footprintCollider("downtown", model, 1, x, z, rot));
  };

  // ---- Enterable towers: wall-shell colliders instead of solid boxes ------
  // The prefabs have real interiors and an OPEN front door at the PIVOT.
  // Shell = 4 walls with a door gap + lintel, an interior floor slab at the
  // kit's entrance height, and two entry steps outside the door.
  const DOOR_HALF = 0.9;
  const WALL_T = 0.45;
  const FLOOR_TOP = 1.0; // interior ground floor (Entrance_Concrete height)
  const DOOR_LINTEL = 3.1;
  const interiorSpots: { x: number; z: number; hash: number }[] = [];
  const putBuilding = (model: string, px: number, pz: number, rot: Rot) => {
    put(model, px, pz, rot);
    const f = MODEL_FOOTPRINTS[`downtown/${model}`];
    const lx0 = f.cx - f.hx;
    const lx1 = f.cx + f.hx;
    const zB = f.cz - f.hz;
    const zF = f.cz + f.hz;
    const H = f.hy * 2;
    // [x0, x1, z0, z1, y0, y1, visibleColor?] in LOCAL space (pivot at the
    // front door). Walkable surfaces the prefab doesn't draw (interior slab,
    // door steps) carry a color and get a visible mesh — an invisible floor
    // reads as the character FLOATING.
    const boxes: [number, number, number, number, number, number, string?][] = [
      [lx0, -DOOR_HALF, zF - WALL_T, zF, 0, H], // front left of the door
      [DOOR_HALF, lx1, zF - WALL_T, zF, 0, H], // front right
      [-DOOR_HALF, DOOR_HALF, zF - WALL_T, zF, DOOR_LINTEL, H], // lintel
      [lx0, lx1, zB, zB + WALL_T, 0, H], // back
      [lx0, lx0 + WALL_T, zB, zF, 0, H], // left
      [lx1 - WALL_T, lx1, zB, zF, 0, H], // right
      [lx0, lx1, zB, zF, 0, FLOOR_TOP, "#8f8a81"], // interior ground-floor slab
      // entry stairs: four 0.25 risers (autostep-friendly) up to the floor
      [-DOOR_HALF, DOOR_HALF, zF, zF + 0.4, 0, 0.75, "#96999f"],
      [-DOOR_HALF, DOOR_HALF, zF + 0.4, zF + 0.8, 0, 0.5, "#96999f"],
      [-DOOR_HALF, DOOR_HALF, zF + 0.8, zF + 1.2, 0, 0.25, "#96999f"],
    ];
    const rotPt = (x: number, z: number): [number, number] =>
      rot === 1 ? [-z, x] : rot === 2 ? [-x, -z] : rot === 3 ? [z, -x] : [x, z];
    // remember the lobby center for interior loot/cover
    {
      const [ix, iz] = rotPt((lx0 + lx1) / 2, (zB + zF) / 2);
      interiorSpots.push({ x: px + ix, z: pz + iz, hash: Math.abs(Math.round(px * 31 + pz * 17)) });
    }
    for (const [bx0, bx1, bz0, bz1, y0, y1, color] of boxes) {
      const [ax, az] = rotPt(bx0, bz0);
      const [bx, bz] = rotPt(bx1, bz1);
      const x0 = Math.min(ax, bx);
      const x1 = Math.max(ax, bx);
      const z0 = Math.min(az, bz);
      const z1 = Math.max(az, bz);
      const box = {
        x: px + (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        z: pz + (z0 + z1) / 2,
        hx: (x1 - x0) / 2,
        hy: (y1 - y0) / 2,
        hz: (z1 - z0) / 2,
      };
      colliders.push(box);
      if (color) floorBoxes.push({ ...box, color });
    }
  };

  // ---- Ground: one island slab -------------------------------------------
  const ground = EDGE + APRON;
  const grounds: GroundRect[] = [{ x0: -ground, z0: -ground, x1: ground, z1: ground, color: COLOR_CITY }];

  // ---- Street grid --------------------------------------------------------
  const lines = [-2, -1, 0, 1, 2].map((k) => k * PITCH);
  const isCrossing = (a: number) => lines.some((c) => Math.abs(a - c) < STREET_HALF);
  for (const c of lines) {
    for (let a = -EDGE + 3; a <= EDGE - 3; a += 6) {
      if (isCrossing(a)) continue; // crossing zone handled below
      // x-running street at z=c (model length runs along x, width along z)
      put("Street_2Lane", a, c, 0);
      // z-running street at x=c
      put("Street_2Lane", c, a, 1);
    }
    // sidewalk curb colliders — SEGMENTED with gaps at every crossing:
    // continuous strips made players climb invisible curbs mid-intersection
    // at sprint (autostep hitches read as "shaky running")
    for (let k = 0; k < lines.length - 1; k++) {
      const a0 = lines[k] + STREET_HALF + 1;
      const a1 = lines[k + 1] - STREET_HALF - 1;
      const mid = (a0 + a1) / 2;
      const half = (a1 - a0) / 2;
      colliders.push(
        { x: mid, y: CURB / 2, z: c - 4.5, hx: half, hy: CURB / 2, hz: 1.5 },
        { x: mid, y: CURB / 2, z: c + 4.5, hx: half, hy: CURB / 2, hz: 1.5 },
        { x: c - 4.5, y: CURB / 2, z: mid, hx: 1.5, hy: CURB / 2, hz: half },
        { x: c + 4.5, y: CURB / 2, z: mid, hx: 1.5, hy: CURB / 2, hz: half },
      );
    }
  }
  // crossings: asphalt patches (2×2 of 6 m) + rounded SIDEWALK CORNERS that
  // tie the street sidewalks together + crosswalk decals
  for (const cx of lines) {
    for (const cz of lines) {
      for (const dx of [-3, 3]) {
        for (const dz of [-3, 3]) put("Street_2Lane_noSidewalk", cx + dx, cz + dz, 0, 0.148);
      }
      // corner sidewalks (one per quadrant; rot turns the rounded curb inward)
      put("Sidewalk_Corner_Round_3m", cx - 4.5, cz - 4.5, 2, 0.148);
      put("Sidewalk_Corner_Round_3m", cx + 4.5, cz - 4.5, 1, 0.148);
      put("Sidewalk_Corner_Round_3m", cx + 4.5, cz + 4.5, 0, 0.148);
      put("Sidewalk_Corner_Round_3m", cx - 4.5, cz + 4.5, 3, 0.148);
      put("Decal_Crosswalk", cx, cz - 5.2, 0, 0.151);
      put("Decal_Crosswalk", cx, cz + 5.2, 0, 0.151);
      put("Decal_Crosswalk", cx - 5.2, cz, 1, 0.151);
      put("Decal_Crosswalk", cx + 5.2, cz, 1, 0.151);
    }
  }

  // ---- City blocks: towers around each block perimeter --------------------
  // Block between street lines k and k+1: interior spans
  // [k·48+6, (k+1)·48−6] on both axes (36 m). Building FRONTS sit on the
  // sidewalk line; alleys open between them and into the courtyard.
  const hash = (a: number, b: number, c: number) => Math.abs((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) % 997;
  const depthOf = (m: string) => MODEL_FOOTPRINTS[`downtown/${m}`].hz - Math.abs(MODEL_FOOTPRINTS[`downtown/${m}`].cz);

  for (let bi = -2; bi < 2; bi++) {
    for (let bj = -2; bj < 2; bj++) {
      const x0 = bi * PITCH + STREET_HALF;
      const x1 = (bi + 1) * PITCH - STREET_HALF;
      const z0 = bj * PITCH + STREET_HALF;
      const z1 = (bj + 1) * PITCH - STREET_HALF;
      const cxm = (x0 + x1) / 2;
      const czm = (z0 + z1) / 2;

      // one tower per block side, offset along the side by hash for variety.
      // rot: front faces the street. Model front = +z at pivot ⇒
      //   north side (front toward -z): rot 2; south: rot 0; west: rot 3? —
      //   rot 1 turns +z toward +x (east); rot 3 toward -x (west).
      const sides: { rot: Rot; px: (b: string) => number; pz: (b: string) => number }[] = [
        // south edge of the block, front toward -z street? No: the street at
        // z0 lies at LOWER z — the front must face -z ⇒ rot 2.
        { rot: 2, px: () => cxm, pz: () => z0 },
        { rot: 0, px: () => cxm, pz: () => z1 },
        { rot: 1, px: () => x0, pz: () => czm }, // faces +x?? see note below
        { rot: 3, px: () => x1, pz: () => czm },
      ];
      // Side rots (rotation.y = -rot·π/2): rot 1 maps local +z → -x, rot 3
      // maps local +z → +x. West edge (x0) fronts face -x ⇒ rot 1; east
      // edge (x1) fronts face +x ⇒ rot 3.
      sides[2].rot = 1;
      sides[3].rot = 3;

      for (let s = 0; s < 4; s++) {
        const h = hash(bi + 3, bj + 3, s);
        const model = BUILDINGS[h % BUILDINGS.length];
        const along = ((h >> 3) % 13) - 6; // slide along the side (alleys!)
        const side = sides[s];
        let px = side.px(model);
        let pz = side.pz(model);
        if (s < 2) px += along;
        else pz += along;
        putBuilding(model, px, pz, side.rot);
      }

      // courtyard dressing: entrance slab + planters + AC units + bollards
      const h = hash(bi + 9, bj + 9, 7);
      put("Street_Asphalt_6x6", cxm, czm, 0, 0.01);
      if (h % 2 === 0) putSolid("Prop_Planter_Single", cxm - 6, czm - 6, 0);
      if (h % 3 === 0) putSolid("Prop_Planter_Single", cxm + 6, czm + 6, 0);
      if (h % 3 === 1) putSolid("Prop_ACUnit", cxm + 5, czm - 5, (h % 4) as Rot);
      putSolid("Prop_Bollard", cxm - 4, czm + 4, 0);
      putSolid("Prop_Bollard", cxm + 4, czm + 4, 0);
      put("Prop_ManholeCover", cxm, czm - 8, 0, 0.02);
    }
  }

  // ---- Promenade dressing (planters along the island rim) -----------------
  for (let a = -EDGE; a <= EDGE; a += 24) {
    putSolid("Sidewalk_Planter", a, ground - 4, 0);
    putSolid("Sidewalk_Planter", a, -ground + 4, 0);
    putSolid("Sidewalk_Planter", ground - 4, a, 1);
    putSolid("Sidewalk_Planter", -ground + 4, a, 1);
  }

  // ---- Spawns: 16 street intersections/mid-blocks, all ≥ 45 m apart -------
  const spawns: SpawnPoint[] = [];
  for (const gx of [-2, -1, 1, 2]) {
    for (const gz of [-2, -1, 1, 2]) {
      const x = gx * PITCH;
      const z = gz * PITCH;
      spawns.push({ x, z, rotY: Math.atan2(-x, -z) });
    }
  }

  // ---- Pickups: courtyards + central crossing ----------------------------
  const items = ["rapid", "heavy", "sniper", "longshot", "grenade", "ammo", "health"];
  const crateSpawns: CrateSpawn[] = [];
  let i = 0;
  for (let bi = -2; bi < 2; bi++) {
    for (let bj = -2; bj < 2; bj++) {
      // exact courtyard center: towers from any side stop ≥1.4 m short of it
      const cxm = bi * PITCH + PITCH / 2;
      const czm = bj * PITCH + PITCH / 2;
      crateSpawns.push({ x: cxm, z: czm, weapon: items[i++ % items.length] });
    }
  }
  crateSpawns.push({ x: 0, z: 0, weapon: "sniper" }); // center stage
  crateSpawns.push({ x: 0, z: -96, weapon: "health" });
  crateSpawns.push({ x: 0, z: 96, weapon: "ammo" });

  // ---- Interior loot + cover: raiding lobbies pays -----------------------
  // Every 3rd building lobby holds a pickup on its floor; every lobby gets a
  // couple of crate obstacles as cover (solid, on the y=1 floor).
  const lootTable = ["health", "ammo", "grenade", "heavy", "ammo", "rapid", "health", "longshot"];
  interiorSpots.forEach((spot, idx) => {
    if (idx % 3 === 0) {
      crateSpawns.push({ x: spot.x, z: spot.z, y: 1, weapon: lootTable[(idx / 3) % lootTable.length | 0] });
    }
    const h = spot.hash % 97;
    const ox = (h % 7) - 3;
    const oz = ((h >> 2) % 7) - 3;
    if (Math.hypot(ox, oz) > 2.2) {
      // crate cover: visual tile + a solid collider on the lobby floor
      const scale = 2;
      const f = MODEL_FOOTPRINTS["blasters/crate-wide"];
      tiles.push({ gx: w2t(spot.x + ox), gz: w2t(spot.z + oz), rot: (h % 4) as Rot, pack: "blasters", model: "crate-wide", y: 1, scale });
      colliders.push({
        x: spot.x + ox, y: 1 + f.hy * scale, z: spot.z + oz,
        hx: f.hx * scale + 0.1, hy: f.hy * scale, hz: f.hz * scale + 0.1,
      });
    }
  });

  // ---- The sea + the (distant) cargo ship --------------------------------
  const shipPath = [
    { x: 220, z: -190 },
    { x: -220, z: -190 },
    { x: -220, z: -240 },
    { x: 220, z: -240 },
  ];

  tiles.sort((a, b) => a.gx - b.gx || a.gz - b.gz || a.model.localeCompare(b.model));

  return {
    size: SIZE,
    tiles,
    colliders,
    grounds,
    waterY: WATER_Y,
    spawns,
    crateSpawns,
    parkedCars: [],
    greens: [],
    shipPath,
    props,
    floors: floorBoxes,
  };
}
