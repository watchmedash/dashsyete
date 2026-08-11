// Blaster arsenal. Damage = base × distance falloff × headshot multiplier.
// Models are from the kenney blaster-kit ("blasters" asset dir); snipers
// carry a scope model on top.

export interface Weapon {
  id: string;
  /** blaster-kit model name (client attaches it to the hand). */
  model: string;
  /** Scope model perched on top (snipers). */
  scopeModel?: string;
  /** Base HP removed per dart hit (before falloff/headshot). */
  damage: number;
  /** Ticks between shots (60 Hz). */
  cooldownTicks: number;
  /** Dart muzzle speed, m/s. */
  dartSpeed: number;
  /** Holding fire keeps shooting. */
  auto: boolean;
  /** Magazine size; Infinity = never runs dry (the starter blaster). */
  ammoCap: number;
  /** Snipers: no distance falloff + right-click zoom factor. */
  zoom?: number;
}

export const WEAPONS: Record<string, Weapon> = {
  blaster: { id: "blaster", model: "blaster-a", damage: 10, cooldownTicks: 21, dartSpeed: 45, auto: false, ammoCap: Infinity },
  rapid: { id: "rapid", model: "blaster-f", damage: 6, cooldownTicks: 7, dartSpeed: 50, auto: true, ammoCap: 60 },
  heavy: { id: "heavy", model: "blaster-r", damage: 25, cooldownTicks: 54, dartSpeed: 40, auto: false, ammoCap: 15 },
  sniper: { id: "sniper", model: "blaster-g", scopeModel: "scope-small", damage: 40, cooldownTicks: 75, dartSpeed: 90, auto: false, ammoCap: 8, zoom: 2.5 },
  longshot: { id: "longshot", model: "blaster-i", scopeModel: "scope-large-a", damage: 60, cooldownTicks: 110, dartSpeed: 110, auto: false, ammoCap: 5, zoom: 5 },
};

export const DEFAULT_WEAPON = "blaster";

/** Dart lifetime in ticks (~1.4 s ⇒ sniper darts reach across districts). */
export const DART_LIFE_TICKS = 85;

/**
 * Distance falloff: full damage inside 15 m, fading linearly to 35% at 75 m.
 * Snipers are EXEMPT — a scoped dart hits as hard at any range.
 */
export function damageFalloff(weaponId: string, dist: number): number {
  if (WEAPONS[weaponId]?.zoom) return 1;
  const t = Math.max(0, dist - 15) / 60;
  return Math.max(0.35, 1 - t * 0.65);
}

/** Hits this far above the capsule center count as headshots (the head). */
export const HEADSHOT_Y = 0.38;
export const HEADSHOT_MULT = 2;

export const GRENADE = {
  fuseTicks: 90, // 1.5 s
  radius: 6, // m blast radius
  maxDamage: 60,
  throwSpeed: 14, // m/s horizontal
  throwUp: 6, // m/s added vertical arc
};

/** Linear falloff from maxDamage at the center to 0 at the radius edge. */
export function grenadeDamage(dist: number): number {
  if (dist >= GRENADE.radius) return 0;
  return GRENADE.maxDamage * (1 - dist / GRENADE.radius);
}

// Non-weapon pickup items (crate contents alongside weapon ids + "grenade").
export const ITEM_AMMO = "ammo"; // refills the slot-2 gun (survival Battery_Big)
export const ITEM_HEALTH = "health"; // +50 HP capped at MAX_HP (survival FirstAidKit)
export const HEALTH_PACK_HP = 50;
