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
    const r = a.login("Zed", "hunter2", "suv", 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(true);
      expect(r.account.team).toBe(1);
      expect(r.account.score).toBe(0);
      expect(r.account.car).toBe("suv");
    }
  });

  it("rejects a wrong password", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "suv", 1);
    const r = a.login("Zed", "wrong", "suv", 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/password/i);
  });

  it("restores team and score, and saves the newly picked car", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "suv", 3);
    a.setScore("zed", 9);
    const r = a.login("Zed", "hunter2", "taxi", 0); // teamIfNew ignored for existing
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(false);
      expect(r.account.team).toBe(3);
      expect(r.account.score).toBe(9);
      expect(r.account.car).toBe("taxi");
    }
  });

  it("persists across instances (server restart)", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "suv", 2);
    a.setScore("zed", 7);
    const b = new Accounts(file);
    const r = b.login("Zed", "hunter2", "suv", 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.account.score).toBe(7);
      expect(r.account.team).toBe(2);
    }
  });

  it("is case-insensitive on names", () => {
    const a = new Accounts(file);
    a.login("Zed", "hunter2", "suv", 1);
    const r = a.login("ZED", "hunter2", "suv", 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.created).toBe(false);
  });
});
