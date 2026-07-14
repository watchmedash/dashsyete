import { MAX_HP, RESPAWN_DELAY_S } from "../../../shared/src/constants";
import type { PlayerInfo, Scores } from "../../../shared/src/protocol";
import { TEAMS } from "../../../shared/src/types";

/** In-game HUD: HP bar, team scoreboard, kill feed, leaderboard, respawn timer. */
export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private teamScoreEls: HTMLSpanElement[] = [];
  private killfeed: HTMLDivElement;
  private leaderboard: HTMLDivElement;
  private respawnMsg: HTMLDivElement;
  private myId: string | null = null;
  private players = new Map<string, PlayerInfo>();
  private teamScores: [number, number, number, number] = [0, 0, 0, 0];
  private respawnTimer: number | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hp-wrap"><div class="hp-fill"></div></div>
      <div class="teams-board"></div>
      <div class="killfeed"></div>
      <div class="leaderboard"><h3>LEADERBOARD</h3><div class="lb-rows"></div></div>
      <button class="lb-button" aria-label="leaderboard">🏆</button>
      <button class="unstuck-button" aria-label="unstuck" title="Stuck? Respawn on the nearest road">🆘</button>
      <div class="respawn-msg"></div>`;
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector<HTMLDivElement>(".hp-fill")!;
    this.killfeed = this.root.querySelector<HTMLDivElement>(".killfeed")!;
    this.leaderboard = this.root.querySelector<HTMLDivElement>(".leaderboard")!;
    this.respawnMsg = this.root.querySelector<HTMLDivElement>(".respawn-msg")!;

    const board = this.root.querySelector<HTMLDivElement>(".teams-board")!;
    TEAMS.forEach((team) => {
      const row = document.createElement("div");
      row.className = "team-row";
      row.innerHTML = `<span class="team-dot" style="background:${team.color}"></span>
        <span class="team-name">${team.name}</span><span class="team-score">0</span>`;
      board.appendChild(row);
      this.teamScoreEls.push(row.querySelector<HTMLSpanElement>(".team-score")!);
    });

    // Tab holds the leaderboard open on desktop; 🏆 toggles it on touch.
    window.addEventListener("keydown", (e) => {
      if (e.code === "Tab") {
        e.preventDefault();
        this.toggleLeaderboard(true);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Tab") this.toggleLeaderboard(false);
    });
    this.root.querySelector<HTMLButtonElement>(".lb-button")!.addEventListener("click", () => {
      this.toggleLeaderboard();
    });
    const unstuck = this.root.querySelector<HTMLButtonElement>(".unstuck-button")!;
    unstuck.addEventListener("click", () => {
      this.onUnstuck?.();
      // mirror the server's 5 s cooldown so the button telegraphs it
      unstuck.disabled = true;
      setTimeout(() => { unstuck.disabled = false; }, 5000);
    });
  }

  /** Wired by main.ts: sends the unstuck request to the server. */
  onUnstuck: (() => void) | null = null;

  setMyId(id: string): void {
    this.myId = id;
  }

  /** The HP bar wears your team color so you always know whose side you're on. */
  setTeamColor(color: string): void {
    this.hpFill.style.background = color;
  }

  setHp(hp: number): void {
    const frac = Math.max(0, Math.min(1, hp / MAX_HP));
    this.hpFill.style.width = `${frac * 100}%`;
  }

  setPlayers(players: PlayerInfo[]): void {
    this.players = new Map(players.map((p) => [p.id, p]));
    this.renderLeaderboard();
  }

  upsertPlayer(p: PlayerInfo): void {
    this.players.set(p.id, p);
    this.renderLeaderboard();
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.renderLeaderboard();
  }

  setScores(scores: Scores): void {
    this.teamScores = scores.teams;
    scores.teams.forEach((s, i) => (this.teamScoreEls[i].textContent = String(s)));
    for (const e of scores.players) {
      const p = this.players.get(e.id);
      if (p) p.score = e.score;
    }
    this.renderLeaderboard();
  }

  addKill(attackerId: string, victimId: string): void {
    const attacker = this.players.get(attackerId);
    const victim = this.players.get(victimId);
    const row = document.createElement("div");
    row.className = "kill-row";
    const name = (p: PlayerInfo | undefined) =>
      p ? `<span style="color:${TEAMS[p.team].color};font-weight:700">${escapeHtml(p.name)}</span>` : "?";
    row.innerHTML = `${name(attacker)} 💥 ${name(victim)}`;
    this.killfeed.appendChild(row);
    const maxRows = window.matchMedia("(max-width: 820px)").matches ? 4 : 6;
    while (this.killfeed.children.length > maxRows) this.killfeed.firstChild?.remove();
    setTimeout(() => row.classList.add("fading"), 4500);
    setTimeout(() => row.remove(), 5200);
  }

  showRespawnCountdown(): void {
    if (this.respawnTimer !== null) clearInterval(this.respawnTimer);
    let remaining = RESPAWN_DELAY_S;
    this.respawnMsg.classList.add("show");
    const update = () => {
      this.respawnMsg.textContent = `WRECKED! Respawn in ${remaining}…`;
      if (remaining <= 0) this.hideRespawnCountdown();
      remaining--;
    };
    update();
    this.respawnTimer = window.setInterval(update, 1000);
  }

  hideRespawnCountdown(): void {
    if (this.respawnTimer !== null) clearInterval(this.respawnTimer);
    this.respawnTimer = null;
    this.respawnMsg.classList.remove("show");
  }

  toggleLeaderboard(show?: boolean): void {
    const target = show ?? !this.leaderboard.classList.contains("show");
    this.leaderboard.classList.toggle("show", target);
    if (target) this.renderLeaderboard();
  }

  private renderLeaderboard(): void {
    if (!this.leaderboard.classList.contains("show")) return;
    const rows = this.leaderboard.querySelector<HTMLDivElement>(".lb-rows")!;
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, 10);
    const me = this.myId ? this.players.get(this.myId) : undefined;
    if (me && !top.includes(me)) top.push(me);
    rows.innerHTML = top
      .map((p) => {
        const rank = sorted.indexOf(p) + 1;
        const cls = p.id === this.myId ? "lb-row me" : "lb-row";
        return `<div class="${cls}">
          <span class="lb-rank">${rank}</span>
          <span class="team-dot" style="background:${TEAMS[p.team].color}"></span>
          <span class="lb-name">${escapeHtml(p.name)}</span>
          <span class="lb-score">${p.score}</span>
        </div>`;
      })
      .join("");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
