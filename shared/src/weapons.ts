// Blaster weapon table — flat damage per hit (the car-era speed formula is
// gone). Models are from the kenney blaster-kit pack ("blasters" asset dir).

export interface Weapon {
  id: string;
  /** blaster-kit model name (client attaches it to the hand). */
  model: string;
  /** HP removed per dart hit. */
  damage: number;
  /** Ticks between shots (60 Hz). */
  cooldownTicks: number;
  /** Dart muzzle speed, m/s. */
  dartSpeed: number;
  /** Holding fire keeps shooting. */
  auto: boolean;
}

export const WEAPONS: Record<string, Weapon> = {
  blaster: { id: "blaster", model: "blaster-a", damage: 10, cooldownTicks: 21, dartSpeed: 45, auto: false },
  rapid: { id: "rapid", model: "blaster-f", damage: 6, cooldownTicks: 7, dartSpeed: 50, auto: true },
  heavy: { id: "heavy", model: "blaster-r", damage: 25, cooldownTicks: 54, dartSpeed: 40, auto: false },
};

export const DEFAULT_WEAPON = "blaster";

/** Dart lifetime in ticks (~1 s ⇒ 40–50 m max range). */
export const DART_LIFE_TICKS = 60;

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
