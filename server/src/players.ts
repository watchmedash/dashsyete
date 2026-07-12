import type { TeamId } from "../../shared/src/types";

export interface Player {
  id: string;
  name: string;
  car: string;
  team: TeamId;
  bot: boolean;
  score: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  protectedUntil: number;
  lastDamagedAt: number;
  lastAttacker: string | null;
  lastInputSeq: number;
}

export class Roster {
  /** Accumulated team scores — must survive members leaving. */
  readonly teamScores: [number, number, number, number] = [0, 0, 0, 0];
  private players = new Map<string, Player>();

  add(p: Player): void {
    this.players.set(p.id, p);
  }

  remove(id: string): void {
    this.players.delete(id);
  }

  get(id: string): Player | undefined {
    return this.players.get(id);
  }

  all(): Player[] {
    return [...this.players.values()];
  }

  humans(): Player[] {
    return this.all().filter((p) => !p.bot);
  }

  humanCounts(): [number, number, number, number] {
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    for (const p of this.players.values()) if (!p.bot) counts[p.team]++;
    return counts;
  }
}
