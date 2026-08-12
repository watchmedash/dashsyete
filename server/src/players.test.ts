import { describe, it, expect } from "vitest";
import { Roster, type Player } from "./players";

function player(id: string): Player {
  return {
    id, name: id, skin: "character-a",
    score: 0,
  deaths: 0,
  blocks: 30, hp: 100, alive: true,
    respawnAt: 0, protectedUntil: 0, lastDamagedAt: -Infinity, lastAttacker: null, lastInputSeq: 0,
    slots: ["blaster", null], activeSlot: 0, ammo: [Infinity, 0],
    cooldownUntilTick: 0, grenades: 0, prevFire: false, prevNade: false, prevSwap: false,
  };
}

describe("Roster", () => {
  it("all() and get() reflect membership", () => {
    const r = new Roster();
    r.add(player("x"));
    expect(r.get("x")?.name).toBe("x");
    r.remove("x");
    expect(r.get("x")).toBeUndefined();
    expect(r.all()).toEqual([]);
  });
});
