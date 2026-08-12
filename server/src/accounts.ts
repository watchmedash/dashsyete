import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface Account {
  nameKey: string; // lowercase — the store key
  name: string; // as originally typed
  hash: string; // scrypt(secretKey, salt) hex
  salt: string; // hex
  skin: string;
  score: number;
  createdAt: number;
}

export type LoginResult =
  | { ok: true; account: Account; created: boolean; issuedKey?: string }
  | { ok: false; reason: string };

const hashKey = (key: string, salt: string) =>
  crypto.scryptSync(key, Buffer.from(salt, "hex"), 32).toString("hex");

/** Human-friendly secret key, e.g. "M4TR-88QK-ZV2N". */
function generateKey(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
  const part = () =>
    Array.from(crypto.randomBytes(4))
      .map((b) => alphabet[b % alphabet.length])
      .join("");
  return `${part()}-${part()}-${part()}`;
}

/**
 * Name-ownership store: the FIRST join with a name mints a secret key (shown
 * once to that player); from then on the name only logs in with that key.
 * No passwords to invent — the server does the secret-making.
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

  login(name: string, key: string, skin: string): LoginResult {
    const nameKey = name.toLowerCase();
    const existing = this.accounts.get(nameKey);
    if (!existing) {
      const issuedKey = generateKey();
      const salt = crypto.randomBytes(16).toString("hex");
      const account: Account = {
        nameKey,
        name,
        hash: hashKey(issuedKey, salt),
        salt,
        skin,
        score: 0,
        createdAt: Date.now(),
      };
      this.accounts.set(nameKey, account);
      this.save();
      return { ok: true, account, created: true, issuedKey };
    }
    const attempt = Buffer.from(hashKey(key.trim().toUpperCase(), existing.salt), "hex");
    const stored = Buffer.from(existing.hash, "hex");
    if (!key || attempt.length !== stored.length || !crypto.timingSafeEqual(attempt, stored)) {
      return { ok: false, reason: "name taken — enter its key to play as it" };
    }
    existing.skin = skin; // the join-screen pick wins and is remembered
    this.save();
    return { ok: true, account: existing, created: false };
  }

  /** Top persistent scores (home-menu leaderboard). */
  top(n: number): { name: string; score: number }[] {
    return [...this.accounts.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((a) => ({ name: a.name, score: a.score }));
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
