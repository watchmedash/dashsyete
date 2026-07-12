import { DAMAGE_MIN_SPEED, DAMAGE_PER_SPEED, DAMAGE_CAP } from "./constants";
import type { TeamId } from "./types";

export function impactDamage(relSpeed: number): number {
  if (relSpeed < DAMAGE_MIN_SPEED) return 0;
  return Math.min(DAMAGE_CAP, (relSpeed - DAMAGE_MIN_SPEED) * DAMAGE_PER_SPEED);
}

export function damageBetween(teamA: TeamId, teamB: TeamId, relSpeed: number): number {
  return teamA === teamB ? 0 : impactDamage(relSpeed);
}
