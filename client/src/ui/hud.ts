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
    // tap/click-to-select on the hotbar (delegated — cells rerender at 20 Hz)
    this.weaponChip.addEventListener("pointerdown", (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".hb-slot");
      if (cell?.dataset.n) this.onHotbarSelect?.(Number(cell.dataset.n));
    });
    this.killfeed = this.root.querySelector<HTMLDivElement>(".killfeed")!;
    this.leaderboard = this.root.querySelector<HTMLDivElement>(".leaderboard")!;
    this.respawnMsg = this.root.querySelector<HTMLDivElement>(".respawn-msg")!;
    this.setLoadout("blaster", -1, 0);
    // hidden until the player actually drops in (the join menu was showing
    // the HP bar, hotbar, minimap... of a game you weren't in yet)
    this.root.style.display = "none";

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

  /** Build-block stock (v5 voxel mode); highlighted while the tool is out. */
  private blocksEl: HTMLDivElement | null = null;
  setBlocks(count: number | null, toolOut: boolean): void {
    if (count === null) {
      this.blocksEl?.remove();
      this.blocksEl = null;
      return;
    }
    if (!this.blocksEl) {
      this.blocksEl = document.createElement("div");
      this.blocksEl.className = "block-stock";
      this.root.appendChild(this.blocksEl);
    }
    const txt = `${count}`;
    if (this.blocksEl.dataset.v !== txt + toolOut) {
      this.blocksEl.dataset.v = txt + toolOut;
      this.blocksEl.innerHTML = `<span class="block-cube"></span>${txt}${toolOut ? '<span class="block-hint">LMB break · RMB place · B gun</span>' : '<span class="block-hint">B to build</span>'}`;
      this.blocksEl.classList.toggle("armed", toolOut);
    }
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
    if (!g) {
      // voxel sky mode has no ground slab — hide the street minimap entirely
      const mm = this.root.querySelector<HTMLDivElement>(".minimap");
      if (mm) mm.style.display = "none";
      return;
    }
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

  // ---- Zone banner: face name slides in when you cross a cube edge -------
  private zoneEl: HTMLDivElement | null = null;
  private zoneTimer: number | null = null;
  showZone(name: string): void {
    if (!this.zoneEl) {
      this.zoneEl = document.createElement("div");
      this.zoneEl.className = "zone-banner";
      this.root.appendChild(this.zoneEl);
    }
    this.zoneEl.textContent = name;
    this.zoneEl.classList.remove("show");
    void this.zoneEl.offsetWidth; // restart the animation
    this.zoneEl.classList.add("show");
    if (this.zoneTimer !== null) clearTimeout(this.zoneTimer);
    this.zoneTimer = window.setTimeout(() => this.zoneEl?.classList.remove("show"), 2400);
  }

  /** Heavy red frame while dead (death cam); cleared on respawn. */
  setDeathTint(on: boolean): void {
    this.ensureVignette().classList.toggle("death", on);
  }

  private flashHurt(): void {
    const v = this.ensureVignette();
    v.classList.remove("flash");
    void v.offsetWidth; // restart the animation
    v.classList.add("flash");
  }

  /** Tapping/clicking a hotbar cell selects it (mobile has no digit keys). */
  onHotbarSelect: ((n: number) => void) | null = null;

  /** Minecraft-style HOTBAR, bottom center (4 slots): 1 THE gun,
   * 2 destroy tool, 3 throwables, 4 blocks. `sel` highlights selection. */
  private loadoutKey = "";
  setLoadout(gun: string, ammo: number, grenades: number, blocks = 0, sel = 1): void {
    const key = `${gun}|${ammo}|${grenades}|${blocks}|${sel}`;
    if (key === this.loadoutKey) return; // avoid image churn at 20 Hz
    this.loadoutKey = key;
    const clip = ammo < 0 ? "∞" : String(ammo);
    // low-ammo warning: amber pulse in the last quarter mag, red when dry
    const cap = WEAPONS[gun]?.ammoCap ?? 0;
    const ammoCls = ammo === 0 ? "out" : cap > 0 && ammo > 0 && ammo <= Math.ceil(cap * 0.25) ? "low" : "";
    const cell = (n: number, inner: string, filled: boolean) =>
      `<span class="hb-slot${sel === n ? " sel" : ""}${filled ? "" : " empty"}" data-n="${n}"><i>${n}</i>${inner}</span>`;
    const pick =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.5 2.5c3 .5 6 2.6 7 5.5-2.4-1.6-5-2.3-7.6-1.9l-9.6 14a2 2 0 0 1-3-2.6l9.9-13.7c.9-1 2-1.4 3.3-1.3z"/></svg>';
    this.weaponChip.innerHTML = [
      cell(1, `<img class="gun-img" data-gun="${gun}" alt="${gun}" /><b class="${ammoCls}">${clip}</b>`, true),
      cell(2, `<span class="hb-tool">${pick}</span>`, true),
      cell(3, grenades > 0 ? `<img class="gun-img" data-gun="grenade" alt="grenades" /><b>${grenades}</b>` : "", grenades > 0),
      cell(4, `<span class="block-cube"></span><b>${blocks}</b>`, blocks > 0),
    ].join("");
    this.weaponChip.querySelectorAll<HTMLImageElement>(".gun-img").forEach((img) => {
      weaponIcon(img.dataset.gun!).then((url) => (img.src = url));
    });
  }

  /** Reveal the HUD (call once the player has actually spawned). */
  show(): void {
    this.root.style.display = "";
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
    const maxRows = window.matchMedia("(max-width: 820px)").matches ? 3 : 5;
    while (this.killfeed.children.length > maxRows) this.killfeed.firstChild?.remove();
    setTimeout(() => row.classList.add("fading"), 3000);
    setTimeout(() => row.remove(), 3700);
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

  showRespawnCountdown(killer?: string, weapon?: string): void {
    if (this.respawnTimer !== null) clearInterval(this.respawnTimer);
    let remaining = RESPAWN_DELAY_S;
    this.respawnMsg.classList.add("show");
    // build with textContent (killer names are player input — never innerHTML)
    this.respawnMsg.textContent = "";
    const title = document.createElement("div");
    title.className = "rm-title";
    title.textContent = "TAGGED OUT";
    const by = document.createElement("div");
    by.className = "rm-by";
    if (killer) by.textContent = weapon ? `by ${killer} · ${weapon}` : `by ${killer}`;
    const count = document.createElement("div");
    count.className = "rm-count";
    this.respawnMsg.append(title, by, count);
    const update = () => {
      count.textContent = `Respawn in ${remaining}…`;
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
        const cls = p.id === this.myId ? "lb-row me" : p.bot ? "lb-row lb-bot" : "lb-row";
        return `<div class="${cls}">
          <span class="lb-rank">${rank}</span>
          <span class="lb-name">${escapeHtml(p.name)}${p.bot ? '<i class="lb-tag">BOT</i>' : ""}</span>
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
