export interface Player {
  id: string;
  name: string;
  skin: string;
  score: number;
  /** Session-local knockout deaths (not persisted to the account). */
  deaths: number;
  /** Building-block stock (v5 voxel mode): mined = earned. */
  blocks: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  protectedUntil: number;
  lastDamagedAt: number;
  lastAttacker: string | null;
  lastInputSeq: number;
  /** Two-gun loadout: slot 0 = the starter blaster (permanent, infinite
   * ammo), slot 1 = the picked-up gun (finite ammo), null when empty. */
  slots: [string, string | null];
  activeSlot: 0 | 1;
  /** Ammo per slot (slot 0 is Infinity). */
  ammo: [number, number];
  /** Tick until which the active weapon is cooling down. */
  cooldownUntilTick: number;
  grenades: number;
  /** Previous fire/nade/swap input state for edge detection. */
  prevFire: boolean;
  prevNade: boolean;
  prevSwap: boolean;
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
