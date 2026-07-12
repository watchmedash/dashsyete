import { describe, it, expect } from "vitest";
import { generateBotName } from "./names";

describe("generateBotName", () => {
  it("produces AdjectiveNoun style names", () => {
    expect(generateBotName(new Set())).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
  });
  it("never returns a taken name", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const n = generateBotName(taken);
      expect(taken.has(n)).toBe(false);
      taken.add(n);
    }
  });
});
