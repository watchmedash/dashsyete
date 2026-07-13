export const TILE = 12;              // world meters per city tile
export const CITY_MODEL_SCALE = 12;  // kenney city/road/etc packs are unit-tile scale
export const CAR_MODEL_SCALE = 2.2;

// Kenney packs use different native scales; world scale factor per pack
// (measured from GLB bounding boxes so models fit the 12 m tile grid).
export const MODEL_SCALES: Record<string, number> = {
  roads: 12,
  commercial: 12,
  industrial: 9,
  suburban: 8,
  graveyard: 4,
  train: 3,
  watercraft: 2.5,
  cars: CAR_MODEL_SCALE,
};

export const TICK_RATE = 60;         // server physics Hz
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 3;     // every 3rd tick => 20 Hz
export const INTERP_DELAY_MS = 100;

export const MAX_HP = 100;
export const RESPAWN_DELAY_S = 3;
export const SPAWN_PROTECTION_S = 2;
export const REGEN_DELAY_S = 6;
export const REGEN_PER_S = 8;

export const DAMAGE_MIN_SPEED = 6;   // m/s relative impact speed below which hits are free
export const DAMAGE_PER_SPEED = 4;   // damage per m/s above the threshold
export const DAMAGE_CAP = 45;        // max damage from one hit

// Auto-drift (mobile): handbrake engages automatically past these thresholds.
export const AUTO_DRIFT_MIN_SPEED = 14; // m/s
export const AUTO_DRIFT_MIN_STEER = 0.55;

export const BOTS_PER_TEAM = 5;
export const FLIP_RESPAWN_S = 3;     // upside-down/on-side this long => auto respawn
export const WATER_Y = -2;           // sea level (visual); islands' tops are at y=0
export const KILL_FLOOR_Y = -6;      // below this = swimming => auto respawn

export const SERVER_PORT = 8080;

// Cars selectable on the join screen; bots also pick from this list.
export const PLAYABLE_CARS = [
  "sedan-sports",
  "hatchback-sports",
  "race",
  "race-future",
  "suv",
  "taxi",
  "police",
  "van",
  "truck",
  "firetruck",
  "garbage-truck",
  "tractor",
] as const;
