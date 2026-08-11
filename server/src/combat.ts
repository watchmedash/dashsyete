import {
  MAX_HP, REGEN_DELAY_S, REGEN_PER_S, RESPAWN_DELAY_S, SPAWN_PROTECTION_S, TICK_DT,
} from "../../shared/src/constants";
import { WEAPONS, grenadeDamage } from "../../shared/src/weapons";
import type { DartEnd, Nade } from "../../shared/src/projectiles";
import type { Roster, Player } from "./players";

export interface CombatResult {
  damaged: { id: string; hp: number; attackerId: string }[];
  knockouts: { victimId: string; attackerId: string }[];
  respawns: string[];
}

const emptyResult = (): CombatResult => ({ damaged: [], knockouts: [], respawns: [] });

/** Free-for-all blaster combat: darts deal their weapon's flat damage,
 * grenades deal radial falloff damage. No teams, no friendly fire rules. */
export class Combat {
  private roster: Roster;

  constructor(roster: Roster) {
    this.roster = roster;
  }

  /** Apply dart hits from this tick's projectile step. */
  processDartHits(ends: DartEnd[], now: number): CombatResult {
    const result = emptyResult();
    for (const e of ends) {
      if (!e.hitChar) continue;
      const victim = this.roster.get(e.hitChar);
      const attacker = this.roster.get(e.dart.owner);
      if (!victim || !victim.alive) continue;
      if (now < victim.protectedUntil) continue;
      if (attacker && now < attacker.protectedUntil) continue; // protected can't deal either
      const dmg = WEAPONS[e.dart.weapon]?.damage ?? 0;
      if (dmg <= 0 || !attacker) continue;
      this.applyDamage(victim, attacker, dmg, now, result);
    }
    this.resolveKnockouts(result, now);
    return result;
  }

  /** Apply grenade explosions: radial falloff vs every living character. */
  processExplosions(
    nades: Nade[],
    positions: (id: string) => [number, number, number] | null,
    now: number,
  ): CombatResult {
    const result = emptyResult();
    for (const n of nades) {
      const attacker = this.roster.get(n.owner);
      if (!attacker) continue;
      for (const victim of this.roster.all()) {
        if (!victim.alive || victim.id === n.owner) continue; // no self-damage
        if (now < victim.protectedUntil) continue;
        const p = positions(victim.id);
        if (!p) continue;
        const dmg = grenadeDamage(Math.hypot(p[0] - n.p[0], p[1] - n.p[1], p[2] - n.p[2]));
        if (dmg <= 0) continue;
        this.applyDamage(victim, attacker, dmg, now, result);
      }
    }
    this.resolveKnockouts(result, now);
    return result;
  }

  private applyDamage(
    victim: Player,
    attacker: Player,
    dmg: number,
    now: number,
    result: CombatResult,
  ): void {
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.lastDamagedAt = now;
    victim.lastAttacker = attacker.id;
    result.damaged.push({ id: victim.id, hp: victim.hp, attackerId: attacker.id });
    if (victim.hp <= 0 && !result.knockouts.some((k) => k.victimId === victim.id)) {
      result.knockouts.push({ victimId: victim.id, attackerId: attacker.id });
    }
  }

  private resolveKnockouts(result: CombatResult, now: number): void {
    for (const { victimId, attackerId } of result.knockouts) {
      const victim = this.roster.get(victimId)!;
      const attacker = this.roster.get(attackerId);
      victim.alive = false;
      victim.respawnAt = now + RESPAWN_DELAY_S;
      if (attacker) attacker.score++;
    }
  }

  /** Per-tick upkeep: HP regen and due respawns. */
  tick(now: number): CombatResult {
    const result = emptyResult();
    for (const p of this.roster.all()) {
      if (p.alive) {
        if (p.hp < MAX_HP && now - p.lastDamagedAt > REGEN_DELAY_S) {
          p.hp = Math.min(MAX_HP, p.hp + REGEN_PER_S * TICK_DT);
        }
      } else if (now >= p.respawnAt) {
        p.alive = true;
        p.hp = MAX_HP;
        p.protectedUntil = now + SPAWN_PROTECTION_S;
        p.lastAttacker = null;
        p.lastDamagedAt = -Infinity;
        result.respawns.push(p.id);
      }
    }
    return result;
  }
}
