import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "./accounts";

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "dash-accounts-")), "players.json");
});

describe("Accounts (keyless score store)", () => {
  it("first touch creates the account with the picked skin", () => {
    const a = new Accounts(file);
    const acc = a.touch("Zed", "character-d");
    expect(acc.score).toBe(0);
    expect(acc.skin).toBe("character-d");
  });

  it("re-touching restores the score and adopts the new skin", () => {
    const a = new Accounts(file);
    a.touch("Zed", "character-a");
    a.setScore("zed", 9);
    const acc = a.touch("ZED", "character-q");
    expect(acc.score).toBe(9);
    expect(acc.skin).toBe("character-q");
  });

  it("persists across restarts and ranks the top list", () => {
    const a = new Accounts(file);
    a.touch("Zed", "character-a");
    a.setScore("zed", 5);
    a.touch("Maya", "character-f");
    a.setScore("maya", 12);
    const b = new Accounts(file);
    expect(b.top(10).map((r) => r.name)).toEqual(["Maya", "Zed"]);
    expect(b.touch("Maya", "character-f").score).toBe(12);
  });
});
