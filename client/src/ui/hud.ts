import { MAX_HP, RESPAWN_DELAY_S } from "../../../shared/src/constants";
import type { PlayerInfo, Scores } from "../../../shared/src/protocol";
import { WEAPONS } from "../../../shared/src/weapons";
import { weaponIcon } from "../weaponIcons";


/** In-game HUD: crosshair, HP bar, weapon chip, kill feed, leaderboard, respawn timer. */
export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private weaponChip: HTMLDivElement;
  private killfeed: HTMLDivElement;
  private leaderboard: HTMLDivElement;
  private respawnMsg: HTMLDivElement;
  private myId: string | null = null;
  private players = new Map<string, PlayerInfo>();
  private respawnTimer: number | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="crosshair"><span></span></div>
      <div class="dmg-arc"></div>
      <canvas class="minimap" width="180" height="180"></canvas>
      <div class="hp-wrap"><div class="hp-fill"></div><span class="hp-num">100</span></div>
      <div class="weapon-chip"></div>
      <div class="killfeed"></div>
      <div class="leaderboard"><h3>LEADERBOARD</h3><div class="lb-rows"></div></div>
      <button class="lb-button" aria-label="leaderboard" title="Leaderboard (Tab)">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3h14v2h3v3c0 2.5-1.9 4.5-4.3 4.9A7 7 0 0 1 13 16.9V19h3v2H8v-2h3v-2.1a7 7 0 0 1-4.7-3.9A5 5 0 0 1 2 8V5h3V3zm-1 4v1a3 3 0 0 0 1.6 2.7A7 7 0 0 1 5 8V7H4zm16 0h-1v1c0 .9-.2 1.8-.6 2.7A3 3 0 0 0 20 8V7z"/></svg>
      </button>
      <button class="unstuck-button" aria-label="unstuck" title="Stuck? Respawn nearby (U)">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 0 1 3.2.93l-2.1 2.1a3 3 0 0 0-2.2 0l-2.1-2.1A6 6 0 0 1 12 6zM6.93 8.8l2.1 2.1a3 3 0 0 0 0 2.2l-2.1 2.1a6 6 0 0 1 0-6.4zm10.14 0a6 6 0 0 1 0 6.4l-2.1-2.1a3 3 0 0 0 0-2.2l2.1-2.1zM12 18a6 6 0 0 1-3.2-.93l2.1-2.1a3 3 0 0 0 2.2 0l2.1 2.1A6 6 0 0 1 12 18z"/></svg>
      </button>
      <div class="respawn-msg"></div>`;
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector<HTMLDivElement>(".hp-fill")!;
    this.weaponChip = this.root.querySelector<HTMLDivElement>(".weapon-chip")!;
    this.killfeed = this.root.querySelector<HTMLDivElement>(".killfeed")!;
    this.leaderboard = this.root.querySelector<HTMLDivElement>(".leaderboard")!;
    this.respawnMsg = this.root.querySelector<HTMLDivElement>(".respawn-msg")!;
    this.setLoadout("blaster", "", -1, 0);

    // Desktop: keys only (Tab = leaderboard held, U = unstuck); the corner
    // buttons exist for touch, where there is no keyboard.
    window.addEventListener("keydown", (e) => {
      if (e.code === "Tab") {
        e.preventDefault();
        this.toggleLeaderboard(true);
      }
      if (e.code === "KeyU") this.triggerUnstuck();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Tab") this.toggleLeaderboard(false);
    });
    this.root.querySelector<HTMLButtonElement>(".lb-button")!.addEventListener("click", () => {
      this.toggleLeaderboard();
    });
    this.root.querySelector<HTMLButtonElement>(".unstuck-button")!.addEventListener("click", () => {
      this.triggerUnstuck();
    });
  }

  private unstuckCooldownUntil = 0;
  private triggerUnstuck(): void {
    // mirror the server's 5 s cooldown so the button/key telegraphs it
    if (performance.now() < this.unstuckCooldownUntil) return;
    this.unstuckCooldownUntil = performance.now() + 5000;
    this.onUnstuck?.();
    const btn = this.root.querySelector<HTMLButtonElement>(".unstuck-button")!;
    btn.disabled = true;
    setTimeout(() => {
      btn.disabled = false;
    }, 5000);
  }

  /** Wired by main.ts: sends the unstuck request to the server. */
  onUnstuck: (() => void) | null = null;

  setMyId(id: string): void {
    this.myId = id;
  }

  /** Crosshair only makes sense when aiming forward (back/first person). */
  setCrosshairVisible(visible: boolean): void {
    this.root.querySelector<HTMLDivElement>(".crosshair")!.style.display = visible ? "" : "none";
  }

  /** Sniper scope ring + vignette while zoomed in first person. */
  private scopeEl: HTMLDivElement | null = null;
  setScopeOverlay(on: boolean): void {
    if (on && !this.scopeEl) {
      this.scopeEl = document.createElement("div");
      this.scopeEl.className = "scope-overlay";
      this.root.appendChild(this.scopeEl);
    }
    if (this.scopeEl) this.scopeEl.style.display = on ? "" : "none";
  }

  // ---- Minimap: static street layer drawn once, arrow per frame ----------
  private mmStatic: HTMLCanvasElement | null = null;
  private mmScale = 1;
  private mmSpan = 1;
  /** Draw the static layer from map data (streets + island bounds). */
  initMinimap(map: {
    grounds: { x0: number; z0: number; x1: number; z1: number }[];
    tiles: { gx: number; gz: number; model: string }[];
    crateSpawns: { x: number; z: number }[];
    size: number;
  }, tileToWorld: (g: number, size: number) => number): void {
    const g = map.grounds[0];
    this.mmSpan = Math.max(g.x1 - g.x0, g.z1 - g.z0);
    this.mmScale = 168 / this.mmSpan;
    const c = document.createElement("canvas");
    c.width = 180;
    c.height = 180;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(23, 28, 43, 0.82)";
    ctx.fillRect(0, 0, 180, 180);
    const px = (x: number) => 90 + x * this.mmScale;
    // island
    ctx.fillStyle = "rgba(99, 102, 109, 0.55)";
    ctx.fillRect(px(g.x0), px(g.z0), (g.x1 - g.x0) * this.mmScale, (g.z1 - g.z0) * this.mmScale);
    // streets
    ctx.fillStyle = "rgba(200, 208, 224, 0.5)";
    for (const t of map.tiles) {
      if (!t.model.startsWith("Street_")) continue;
      const x = tileToWorld(t.gx, map.size);
      const z = tileToWorld(t.gz, map.size);
      ctx.fillRect(px(x) - 3 * this.mmScale, px(z) - 3 * this.mmScale, 6 * this.mmScale, 6 * this.mmScale);
    }
    // pickups
    ctx.fillStyle = "rgba(255, 213, 74, 0.9)";
    for (const cs of map.crateSpawns) {
      ctx.beginPath();
      ctx.arc(px(cs.x), px(cs.z), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    this.mmStatic = c;
  }

  /** Per-frame: static layer + own position arrow. */
  updateMinimap(x: number, z: number, yaw: number): void {
    if (!this.mmStatic) return;
    const canvas = this.root.querySelector<HTMLCanvasElement>(".minimap")!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 180, 180);
    ctx.drawImage(this.mmStatic, 0, 0);
    const pxx = 90 + x * this.mmScale;
    const pxz = 90 + z * this.mmScale;
    ctx.save();
    ctx.translate(pxx, pxz);
    // world yaw 0 faces +z = DOWN on the map (north-up, +z south)
    ctx.rotate(Math.PI - yaw);
    ctx.fillStyle = "#ffd54a";
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.4, 4);
    ctx.lineTo(-3.4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Red arc at the screen edge pointing toward whoever just hit you.
   * `angle` is radians clockwise from screen-up. */
  private dmgTimer: number | null = null;
  showDamageFrom(angle: number): void {
    const arc = this.root.querySelector<HTMLDivElement>(".dmg-arc")!;
    arc.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    arc.classList.add("show");
    if (this.dmgTimer !== null) clearTimeout(this.dmgTimer);
    this.dmgTimer = window.setTimeout(() => arc.classList.remove("show"), 700);
  }

  /** Flash the crosshair on a confirmed hit of yours; headshots flash harder. */
  hitMarker(headshot = false): void {
    const x = this.root.querySelector<HTMLDivElement>(".crosshair")!;
    x.classList.remove("hit", "crit");
    void x.offsetWidth; // restart the animation
    x.classList.add("hit");
    if (headshot) x.classList.add("crit");
  }

  private lastHp = MAX_HP;
  setHp(hp: number): void {
    const frac = Math.max(0, Math.min(1, hp / MAX_HP));
    this.hpFill.style.width = `${frac * 100}%`;
    this.hpFill.classList.toggle("low", frac < 0.3);
    this.root.querySelector<HTMLSpanElement>(".hp-num")!.textContent = String(Math.round(hp));
    // hurt vignette: quick red edge flash on any HP drop, held while critical
    if (hp < this.lastHp - 0.5) this.flashHurt();
    this.ensureVignette().classList.toggle("critical", frac < 0.3 && hp > 0);
    this.lastHp = hp;
  }

  private vignetteEl: HTMLDivElement | null = null;
  private ensureVignette(): HTMLDivElement {
    if (!this.vignetteEl) {
      this.vignetteEl = document.createElement("div");
      this.vignetteEl.className = "hurt-vignette";
      this.root.appendChild(this.vignetteEl);
    }
    return this.vignetteEl;
  }

  private flashHurt(): void {
    const v = this.ensureVignette();
    v.classList.remove("flash");
    void v.offsetWidth; // restart the animation
    v.classList.add("flash");
  }

  /** Two-slot loadout readout: the actual gun models + ammo, grenades. */
  private loadoutKey = "";
  setLoadout(active: string, slot2: string, ammo: number, grenades: number): void {
    const key = `${active}|${slot2}|${ammo}|${grenades}`;
    if (key === this.loadoutKey) return; // avoid image churn at 20 Hz
    this.loadoutKey = key;
    const clip = ammo < 0 ? "∞" : String(ammo);
    const name = (id: string) => (WEAPONS[id]?.id ?? id).toUpperCase();
    const parts = [
      `<span class="slot active"><img class="gun-img" data-gun="${active}" alt="${name(active)}" /><b>${clip}</b></span>`,
    ];
    if (slot2) parts.push(`<span class="slot holstered"><img class="gun-img" data-gun="${slot2}" alt="${name(slot2)}" /><span class="swap-hint">Q</span></span>`);
    if (grenades > 0) parts.push(`<span class="slot nades"><img class="gun-img" data-gun="grenade" alt="grenades" /><b>${grenades}</b></span>`);
    this.weaponChip.innerHTML = parts.join("");
    this.weaponChip.querySelectorAll<HTMLImageElement>(".gun-img").forEach((img) => {
      weaponIcon(img.dataset.gun!).then((url) => (img.src = url));
    });
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
    for (const e of scores.players) {
      const p = this.players.get(e.id);
      if (p) {
        p.score = e.score;
        if (e.deaths !== undefined) p.deaths = e.deaths;
      }
    }
    this.renderLeaderboard();
  }

  addKill(attackerId: string, victimId: string): void {
    const attacker = this.players.get(attackerId);
    const victim = this.players.get(victimId);
    const row = document.createElement("div");
    row.className = "kill-row";
    const name = (p: PlayerInfo | undefined, me: boolean) =>
      p ? `<span class="${me ? "kill-me" : "kill-name"}">${escapeHtml(p.name)}</span>` : "?";
    const dartIcon =
      '<svg class="kill-icon" viewBox="0 0 24 12" fill="currentColor" aria-hidden="true">' +
      '<path d="M1 5h10l3-3 2 2-2 2h9v0.5l-9 0.5 2 2-2 2-3-3H1z"/></svg>';
    row.innerHTML = `${name(attacker, attackerId === this.myId)} ${dartIcon} ${name(victim, victimId === this.myId)}`;
    this.killfeed.appendChild(row);
    const maxRows = window.matchMedia("(max-width: 820px)").matches ? 4 : 6;
    while (this.killfeed.children.length > maxRows) this.killfeed.firstChild?.remove();
    setTimeout(() => row.classList.add("fading"), 4500);
    setTimeout(() => row.remove(), 5200);
  }

  /** Big center-screen streak banner ("DOUBLE KNOCKOUT!"), briefly. */
  private streakEl: HTMLDivElement | null = null;
  private streakTimer: number | null = null;
  showStreak(text: string): void {
    if (!this.streakEl) {
      this.streakEl = document.createElement("div");
      this.streakEl.className = "streak-banner";
      this.root.appendChild(this.streakEl);
    }
    this.streakEl.textContent = text;
    this.streakEl.classList.remove("show");
    void this.streakEl.offsetWidth;
    this.streakEl.classList.add("show");
    if (this.streakTimer !== null) clearTimeout(this.streakTimer);
    this.streakTimer = window.setTimeout(() => this.streakEl?.classList.remove("show"), 1800);
  }

  showRespawnCountdown(): void {
    if (this.respawnTimer !== null) clearInterval(this.respawnTimer);
    let remaining = RESPAWN_DELAY_S;
    this.respawnMsg.classList.add("show");
    const update = () => {
      this.respawnMsg.textContent = `TAGGED OUT! Respawn in ${remaining}…`;
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
          <span class="lb-name">${escapeHtml(p.name)}</span>
          <span class="lb-score">${p.score}</span>
          <span class="lb-deaths">${p.deaths ?? 0}</span>
        </div>`;
      })
      .join("");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
