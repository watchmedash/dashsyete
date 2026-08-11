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
  characters: 0.667, // blocky characters are 2.7 native ⇒ ~1.8 m tall
  blasters: 1,       // blaster-kit is already hand/world scale
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

export const WATER_Y = -2;           // sea level (visual); the mainland top is at y=0
export const KILL_FLOOR_Y = -6;      // below this = swimming => auto respawn

// Weapon crate pickups
export const CRATE_RESPAWN_S = 15;   // crate rearm time after a pickup
export const PICKUP_RADIUS = 1.5;    // walk within this of a crate to grab it
export const GRENADES_PER_PICKUP = 3;

export const SERVER_PORT = 8080;

// Character skins selectable on the join screen (blocky-characters pack).
export const PLAYABLE_SKINS = "abcdefghijklmnopqr".split("").map((c) => `character-${c}`);
