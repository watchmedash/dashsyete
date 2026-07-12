import { describe, it, expect, beforeEach } from "vitest";
import { Combat } from "./combat";
import { Roster, type Player } from "./players";
import {
  DAMAGE_MIN_SPEED, DAMAGE_PER_SPEED, MAX_HP,
  REGEN_DELAY_S, REGEN_PER_S, RESPAWN_DELAY_S, SPAWN_PROTECTION_S, TICK_DT,
} from "../../shared/src/constants";

function player(id: string, team: 0 | 1 | 2 | 3): Player {
  return {
    id, name: id, car: "sedan", team, bot: false,
    score: 0, hp: MAX_HP, alive: true,
    respawnAt: 0, protectedUntil: 0, lastDamagedAt: -Infinity, lastAttacker: null, lastInputSeq: 0,
  };
}

let roster: Roster;
let combat: Combat;
let A: Player, B: Player, C: Player;

beforeEach(() => {
  roster = new Roster();
  A = player("A", 0);
  B = player("B", 1);
  C = player("C", 0);
  roster.add(A);
  roster.add(B);
  roster.add(C);
  combat = new Combat(roster);
});

const hit = (a: string, b: string, relSpeed: number) => [{ a, b, relSpeed }];

describe("Combat.processImpacts", () => {
  it("enemy impact damages both cars by the formula", () => {
    const rel = DAMAGE_MIN_SPEED + 5; // 5 m/s over => 20 damage
    const res = combat.processImpacts(hit("A", "B", rel), 10);
    const expected = MAX_HP - 5 * DAMAGE_PER_SPEED;
    expect(A.hp).toBe(expected);
    expect(B.hp).toBe(expected);
    expect(res.damaged.map((d) => d.id).sort()).toEqual(["A", "B"]);
  });

  it("same-team impact deals no damage", () => {
    combat.processImpacts(hit("A", "C", 50), 10);
    expect(A.hp).toBe(MAX_HP);
    expect(C.hp).toBe(MAX_HP);
  });

  it("killing blow credits the attacker and schedules respawn", () => {
    B.hp = 10;
    const res = combat.processImpacts(hit("A", "B", DAMAGE_MIN_SPEED + 10), 100);
    expect(B.alive).toBe(false);
    expect(B.respawnAt).toBe(100 + RESPAWN_DELAY_S);
    expect(res.knockouts).toEqual([{ victimId: "B", attackerId: "A" }]);
    expect(A.score).toBe(1);
    expect(roster.teamScores).toEqual([1, 0, 0, 0]);

    // respawn comes due via tick()
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
    combat.processImpacts(hit("A", "B", 50), 10);
    expect(A.hp).toBe(MAX_HP);
    expect(B.hp).toBe(MAX_HP);
  });

  it("dead players are ignored in impacts", () => {
    B.alive = false;
    combat.processImpacts(hit("A", "B", 50), 10);
    expect(A.hp).toBe(MAX_HP);
  });

  it("mutual knockout credits both attackers", () => {
    A.hp = 5;
    B.hp = 5;
    const res = combat.processImpacts(hit("A", "B", DAMAGE_MIN_SPEED + 10), 50);
    expect(res.knockouts).toHaveLength(2);
    expect(A.score).toBe(1);
    expect(B.score).toBe(1);
    expect(roster.teamScores).toEqual([1, 1, 0, 0]);
  });
});

describe("Combat.tick regen", () => {
  it("regenerates only after the regen delay", () => {
    A.hp = 50;
    A.lastDamagedAt = 100;
    combat.tick(100 + REGEN_DELAY_S - 1);
    expect(A.hp).toBe(50);
    combat.tick(100 + REGEN_DELAY_S + 1);
    expect(A.hp).toBeCloseTo(50 + REGEN_PER_S * TICK_DT);
  });

  it("caps regen at MAX_HP", () => {
    A.hp = MAX_HP - 0.01;
    A.lastDamagedAt = 0;
    combat.tick(1000);
    expect(A.hp).toBe(MAX_HP);
  });
});
