import {
  MAX_HP, REGEN_DELAY_S, REGEN_PER_S, RESPAWN_DELAY_S, SPAWN_PROTECTION_S, TICK_DT,
} from "../../shared/src/constants";
import { damageBetween } from "../../shared/src/damage";
import type { ImpactEvent } from "../../shared/src/sim";
import type { Roster, Player } from "./players";

export interface CombatResult {
  damaged: { id: string; hp: number }[];
  knockouts: { victimId: string; attackerId: string }[];
  respawns: string[];
}

export class Combat {
  private roster: Roster;

  constructor(roster: Roster) {
    this.roster = roster;
  }

  /** Apply car-vs-car impacts: damage both sides, credit killing blows. */
  processImpacts(events: ImpactEvent[], now: number): CombatResult {
    const result: CombatResult = { damaged: [], knockouts: [], respawns: [] };

    for (const e of events) {
      const a = this.roster.get(e.a);
      const b = this.roster.get(e.b);
      if (!a || !b || !a.alive || !b.alive) continue;
      if (now < a.protectedUntil || now < b.protectedUntil) continue;

      const dmg = damageBetween(a.team, b.team, e.relSpeed);
      if (dmg <= 0) continue;

      this.applyDamage(a, b, dmg, now, result);
      this.applyDamage(b, a, dmg, now, result);
    }

    // Resolve knockouts after all damage so mutual kills credit both sides.
    for (const { victimId, attackerId } of result.knockouts) {
      const victim = this.roster.get(victimId)!;
      const attacker = this.roster.get(attackerId);
      victim.alive = false;
      victim.respawnAt = now + RESPAWN_DELAY_S;
      if (attacker) {
        attacker.score++;
        this.roster.teamScores[attacker.team]++;
      }
    }
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
    result.damaged.push({ id: victim.id, hp: victim.hp });
    if (victim.hp <= 0 && !result.knockouts.some((k) => k.victimId === victim.id)) {
      result.knockouts.push({ victimId: victim.id, attackerId: attacker.id });
    }
  }

  /** Per-tick upkeep: HP regen and due respawns. */
  tick(now: number): CombatResult {
    const result: CombatResult = { damaged: [], knockouts: [], respawns: [] };
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
