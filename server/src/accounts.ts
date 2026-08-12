import fs from "node:fs";
import path from "node:path";

export interface Account {
  nameKey: string; // lowercase — the store key
  name: string; // as originally typed
  skin: string;
  score: number;
  createdAt: number;
}

/**
 * Keyless score store (name keys removed by user decision 2026-08-12):
 * whoever plays under a name carries its persistent score. Online name
 * collisions are solved by the server auto-suffixing a number instead.
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

  /** Get-or-create the account for a name; the join-screen skin pick wins. */
  touch(name: string, skin: string): Account {
    const nameKey = name.toLowerCase();
    let a = this.accounts.get(nameKey);
    if (!a) {
      a = { nameKey, name, skin, score: 0, createdAt: Date.now() };
      this.accounts.set(nameKey, a);
    } else {
      a.skin = skin;
    }
    this.save();
    return a;
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
