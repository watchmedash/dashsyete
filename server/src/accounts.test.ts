import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Accounts } from "./accounts";

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "dash-accounts-")), "players.json");
});

describe("Accounts", () => {
  it("creates an account on first login", () => {
    const a = new Accounts(file);
    const r = a.login("Zed", "hunter2", "character-d");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(true);
      expect(r.account.score).toBe(0);
      expect(r.account.skin).toBe("character-d");
    }
  });

  it("rejects a wrong password", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "character-a");
    const r = a.login("Zed", "wrong", "character-a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/password/i);
  });

  it("restores score, and saves the newly picked skin", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "character-a");
    a.setScore("zed", 9);
    const r = a.login("Zed", "hunter2", "character-q");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(false);
      expect(r.account.score).toBe(9);
      expect(r.account.skin).toBe("character-q");
    }
  });

  it("persists across instances (server restart)", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "character-a");
    a.setScore("zed", 7);
    const b = new Accounts(file);
    const r = b.login("Zed", "hunter2", "character-a");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.account.score).toBe(7);
  });

  it("is case-insensitive on names", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "character-a");
    const r = a.login("ZED", "hunter2", "character-a");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.created).toBe(false);
  });
});
