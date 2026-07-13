import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TeamId } from "../../shared/src/types";

export interface Account {
  nameKey: string;   // lowercase — the store key
  name: string;      // as originally typed
  hash: string;      // scrypt(pass, salt) hex
  salt: string;      // hex
  team: TeamId;
  car: string;
  score: number;
  createdAt: number;
}

export type LoginResult =
  | { ok: true; account: Account; created: boolean }
  | { ok: false; reason: string };

const hashPass = (pass: string, salt: string) =>
  crypto.scryptSync(pass, Buffer.from(salt, "hex"), 32).toString("hex");

/**
 * Persistent name+password account store (JSON file). Lets players recover
 * their team/score from any device. The file is tiny; write-on-change.
 */
export class Accounts {
  private file: string;
  private accounts = new Map<string, Account>();

  constructor(file: string) {
    this.file = file;
    if (fs.existsSync(file)) {
      const list = JSON.parse(fs.readFileSync(file, "utf8")) as Account[];
      for (const a of list) this.accounts.set(a.nameKey, a);
    }
  }

  login(name: string, pass: string, car: string, teamIfNew: TeamId): LoginResult {
    const nameKey = name.toLowerCase();
    const existing = this.accounts.get(nameKey);
    if (!existing) {
      const salt = crypto.randomBytes(16).toString("hex");
      const account: Account = {
        nameKey,
        name,
        hash: hashPass(pass, salt),
        salt,
        team: teamIfNew,
        car,
        score: 0,
        createdAt: Date.now(),
      };
      this.accounts.set(nameKey, account);
      this.save();
      return { ok: true, account, created: true };
    }
    const attempt = Buffer.from(hashPass(pass, existing.salt), "hex");
    const stored = Buffer.from(existing.hash, "hex");
    if (attempt.length !== stored.length || !crypto.timingSafeEqual(attempt, stored)) {
      return { ok: false, reason: "wrong password for this name" };
    }
    existing.car = car; // the join-screen pick wins and is remembered
    this.save();
    return { ok: true, account: existing, created: false };
  }

  setScore(nameKey: string, score: number): void {
    const a = this.accounts.get(nameKey.toLowerCase());
    if (!a) return;
    a.score = score;
    this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify([...this.accounts.values()], null, 2));
  }
}
