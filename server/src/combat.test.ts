import { describe, it, expect, beforeEach } from "vitest";
import { Combat } from "./combat";
import { Roster, type Player } from "./players";
import {
  MAX_HP, RESPAWN_DELAY_S, SPAWN_PROTECTION_S,
} from "../../shared/src/constants";
import { WEAPONS, GRENADE } from "../../shared/src/weapons";
import type { DartEnd } from "../../shared/src/projectiles";

function player(id: string): Player {
  return {
    id, name: id, skin: "character-a",
    score: 0,
  deaths: 0,
  blocks: 30, hp: MAX_HP, alive: true,
    respawnAt: 0, protectedUntil: 0, lastDamagedAt: -Infinity, lastAttacker: null, lastInputSeq: 0,
    slots: ["blaster", null], activeSlot: 0, lastSel: 1, ammo: [Infinity, 0],
    cooldownUntilTick: 0, grenades: 0, prevFire: false, prevNade: false, prevSwap: false,
  };
}

function dartHit(owner: string, victim: string, weapon = "blaster", travel = 5, headshot = false): DartEnd[] {
  return [
    {
      dart: { id: "dart-1", owner, weapon, p: [0, 1, 0], o: [0, 1, -travel], v: [0, 0, 45], ticksLeft: 10 },
      hitChar: victim,
      hitWorld: false,
      headshot,
      travel,
    },
  ];
}

let roster: Roster;
let combat: Combat;
let A: Player, B: Player;

beforeEach(() => {
  roster = new Roster();
  A = player("A");
  B = player("B");
  roster.add(A);
  roster.add(B);
  combat = new Combat(roster);
});

describe("Combat.processDartHits", () => {
  it("a dart hit deals the weapon's flat damage", () => {
    const res = combat.processDartHits(dartHit("A", "B"), 10);
    expect(B.hp).toBe(MAX_HP - WEAPONS.blaster.damage);
    expect(A.hp).toBe(MAX_HP);
    expect(res.damaged).toEqual([{ id: "B", hp: MAX_HP - WEAPONS.blaster.damage, attackerId: "A" }]);
  });

  it("heavier weapons deal more", () => {
    combat.processDartHits(dartHit("A", "B", "heavy"), 10);
    expect(B.hp).toBe(MAX_HP - WEAPONS.heavy.damage);
  });

  it("damage falls off with distance (35% floor)", () => {
    combat.processDartHits(dartHit("A", "B", "blaster", 75), 10);
    expect(B.hp).toBeCloseTo(MAX_HP - WEAPONS.blaster.damage * 0.35, 3);
  });

  it("snipers hit full damage at any range", () => {
    combat.processDartHits(dartHit("A", "B", "longshot", 200), 10);
    expect(B.hp).toBe(MAX_HP - WEAPONS.longshot.damage);
  });

  it("headshots deal double", () => {
    combat.processDartHits(dartHit("A", "B", "blaster", 5, true), 10);
    expect(B.hp).toBe(MAX_HP - WEAPONS.blaster.damage * 2);
  });

  it("killing blow credits the attacker and schedules respawn", () => {
    B.hp = WEAPONS.blaster.damage;
    const res = combat.processDartHits(dartHit("A", "B"), 100);
    expect(B.alive).toBe(false);
    expect(B.respawnAt).toBe(100 + RESPAWN_DELAY_S);
    expect(res.knockouts).toEqual([{ victimId: "B", attackerId: "A" }]);
    expect(A.score).toBe(1);

    const r1 = combat.tick(100 + RESPAWN_DELAY_S - 0.1);
    expect(r1.respawns).toEqual([]);
    const r2 = combat.tick(100 + RESPAWN_DELAY_S + 0.1);
    expect(r2.respawns).toEqual(["B"]);
    expect(B.alive).toBe(true);
    expect(B.hp).toBe(MAX_HP);
    expect(B.protectedUntil).toBeCloseTo(100 + RESPAWN_DELAY_S + 0.1 + SPAWN_PROTECTION_S);
  });

  it("spawn-protected players neither take nor deal damage", () => {
    B.protectedUntil = 20;
    combat.processDartHits(dartHit("A", "B"), 10);
    expect(B.hp).toBe(MAX_HP);
    A.protectedUntil = 20;
    B.protectedUntil = 0;
    combat.processDartHits(dartHit("A", "B"), 10);
    expect(B.hp).toBe(MAX_HP);
  });

  it("dead players are ignored", () => {
    B.alive = false;
    const res = combat.processDartHits(dartHit("A", "B"), 10);
    expect(res.damaged).toEqual([]);
  });
});

describe("Combat.processExplosions", () => {
  const positions = (pos: Record<string, [number, number, number]>) => (id: string) => pos[id] ?? null;

  it("deals falloff damage by distance, INCLUDING the thrower", () => {
    const res = combat.processExplosions(
      [{ id: "nade-1", owner: "A", p: [0, 0, 0], v: [0, 0, 0], fuse: 0 }],
      positions({ A: [GRENADE.radius / 2, 0, 0], B: [GRENADE.radius / 2, 0, 0] }),
      10,
    );
    expect(A.hp).toBeCloseTo(MAX_HP - GRENADE.maxDamage / 2, 5); // own nade hurts
    expect(B.hp).toBeCloseTo(MAX_HP - GRENADE.maxDamage / 2, 5);
    expect(res.damaged.length).toBe(2);
  });

  it("a self-knockout scores NO point for the thrower", () => {
    A.hp = 1;
    const res = combat.processExplosions(
      [{ id: "nade-1", owner: "A", p: [0, 0, 0], v: [0, 0, 0], fuse: 0 }],
      positions({ A: [0.5, 0, 0] }),
      10,
    );
    expect(res.knockouts).toEqual([{ victimId: "A", attackerId: "A" }]);
    expect(A.alive).toBe(false);
    expect(A.score).toBe(0);
    expect(A.deaths).toBe(1);
  });

  it("out-of-radius characters are untouched", () => {
    combat.processExplosions(
      [{ id: "nade-1", owner: "A", p: [0, 0, 0], v: [0, 0, 0], fuse: 0 }],
      positions({ B: [GRENADE.radius + 1, 0, 0] }),
      10,
    );
    expect(B.hp).toBe(MAX_HP);
  });
});

describe("Combat.tick — NO natural regen (health packs only)", () => {
  it("never regenerates hp, no matter how long since damage", () => {
    A.hp = 50;
    A.lastDamagedAt = 100;
    combat.tick(100 + 1);
    combat.tick(100 + 30);
    combat.tick(100 + 600);
    expect(A.hp).toBe(50);
  });
});
