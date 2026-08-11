export interface Player {
  id: string;
  name: string;
  skin: string;
  score: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  protectedUntil: number;
  lastDamagedAt: number;
  lastAttacker: string | null;
  lastInputSeq: number;
  /** Held weapon id (see shared/src/weapons.ts). */
  weapon: string;
  /** Tick until which the weapon is cooling down. */
  cooldownUntilTick: number;
  grenades: number;
  /** Previous fire/nade input state for edge detection. */
  prevFire: boolean;
  prevNade: boolean;
}

export class Roster {
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
}
