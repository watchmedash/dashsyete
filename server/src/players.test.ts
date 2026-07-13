import { describe, it, expect } from "vitest";
import { Roster, type Player } from "./players";

function player(id: string, team: 0 | 1 | 2 | 3): Player {
  return {
    id, name: id, car: "sedan", team,
    score: 0, hp: 100, alive: true,
    respawnAt: 0, protectedUntil: 0, lastDamagedAt: -Infinity, lastAttacker: null, lastInputSeq: 0,
  };
}

describe("Roster", () => {
  it("teamCounts tallies members per team", () => {
    const r = new Roster();
    r.add(player("h1", 0));
    r.add(player("h2", 0));
    r.add(player("h3", 1));
    expect(r.teamCounts()).toEqual([2, 1, 0, 0]);
  });

  it("team scores survive member removal", () => {
    const r = new Roster();
    r.add(player("h1", 2));
    r.teamScores[2] += 5;
    r.remove("h1");
    expect(r.teamScores).toEqual([0, 0, 5, 0]);
  });

  it("all() and get() reflect membership", () => {
    const r = new Roster();
    r.add(player("x", 1));
    expect(r.get("x")?.team).toBe(1);
    r.remove("x");
    expect(r.get("x")).toBeUndefined();
    expect(r.all()).toEqual([]);
  });
});
