import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "./accounts";

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "dash-accounts-")), "players.json");
});

describe("Accounts (name keys)", () => {
  it("first join mints a key and creates the account", () => {
    const a = new Accounts(file);
    const r = a.login("Zed", "", "character-d");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(true);
      expect(r.issuedKey).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(r.account.skin).toBe("character-d");
    }
  });

  it("rejects a taken name without its key", () => {
    const a = new Accounts(file);
    a.login("Zed", "", "character-a");
    const r = a.login("Zed", "", "character-a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/key/i);
    const wrong = a.login("Zed", "NOPE-NOPE-NOPE", "character-a");
    expect(wrong.ok).toBe(false);
  });

  it("the minted key unlocks the name, restores score, saves the new skin", () => {
    const a = new Accounts(file);
    const first = a.login("Zed", "", "character-a");
    const key = first.ok ? first.issuedKey! : "";
    a.setScore("zed", 9);
    const r = a.login("Zed", key, "character-q");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(false);
      expect(r.issuedKey).toBeUndefined();
      expect(r.account.score).toBe(9);
      expect(r.account.skin).toBe("character-q");
    }
  });

  it("keys are case/space tolerant and persist across restarts", () => {
    const a = new Accounts(file);
    const first = a.login("Zed", "", "character-a");
    const key = first.ok ? first.issuedKey! : "";
    const b = new Accounts(file);
    const r = b.login("ZED", ` ${key.toLowerCase()} `, "character-a");
    expect(r.ok).toBe(true);
  });
});
