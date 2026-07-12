import { describe, it, expect } from "vitest";
import { pickTeam } from "./teams";

describe("pickTeam", () => {
  it("picks the team with fewest humans", () => {
    expect(pickTeam([2, 0, 1, 3])).toBe(1);
  });
  it("breaks ties randomly among the minimum only", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pickTeam([1, 0, 2, 0], Math.random));
    expect(seen).toEqual(new Set([1, 3]));
  });
  it("is deterministic given rand", () => {
    expect(pickTeam([0, 0, 0, 0], () => 0)).toBe(0);
    expect(pickTeam([0, 0, 0, 0], () => 0.99)).toBe(3);
  });
});
