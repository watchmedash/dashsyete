import { MAX_HP, RESPAWN_DELAY_S } from "../../../shared/src/constants";
import type { PlayerInfo, Scores } from "../../../shared/src/protocol";

/** Representative CSS colors per block id (mirrors voxelRender's textures)
 * for the hotbar swatches. */
const BLOCK_SWATCH: Record<number, string> = {
  1: "#4a8f3c", // grass
  2: "#7a5a3a", // dirt
  3: "#8a8a8a", // stone
  4: "#6b4e2a", // wood
  5: "#3c7d31", // leaves
  6: "#c2a066", // plank
  7: "#dcc98a", // sand
  8: "#f4f8fb", // snow
  9: "#a8d4e8", // ice
  12: "#5a5a64", // basalt
  14: "#2c5f26", // dark grass
  15: "#b4b9c2", // build panel
  16: "#1c4517", // dark leaves
  17: "#9fc39a", // snowy leaves
  18: "#3f7d33", // cactus
};


/** In-game HUD: crosshair, HP bar, weapon chip, kill feed, leaderboard, respawn timer. */
export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private weaponChip: HTMLDivElement;
  private killfeed: HTMLDivElement;
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
    this.respawnMsg = this.root.querySelector<HTMLDivElement>(".respawn-msg")!;
    this.setInventory([], 1);
    // hidden until the player actually drops in (the join menu was showing
    // the HP bar, hotbar, minimap... of a game you weren't in yet)
    this.root.style.display = "none";
  }

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

  /** Minecraft-style HOTBAR, bottom center: 8 block stacks. Each slot shows
   * a color swatch of the block's material and its count; mined blocks keep
   * their original form, so the swatch IS the block you'll place back. */
  private loadoutKey = "";
  setInventory(inv: [number, number][], sel = 1): void {
    const key = inv.map(([id, n]) => `${id}:${n}`).join("|") + `|${sel}`;
    if (key === this.loadoutKey) return; // avoid DOM churn at 20 Hz
    this.loadoutKey = key;
    const cells: string[] = [];
    for (let n = 1; n <= 8; n++) {
      const stack = inv[n - 1];
      const inner = stack
        ? `<span class="block-cube" style="background:${BLOCK_SWATCH[stack[0]] ?? "#b4b9c2"}"></span><b>${stack[1]}</b>`
        : "";
      cells.push(
        `<span class="hb-slot${sel === n ? " sel" : ""}${stack ? "" : " empty"}" data-n="${n}"><i>${n}</i>${inner}</span>`,
      );
    }
    this.weaponChip.innerHTML = cells.join("");
  }

  /** Reveal the HUD (call once the player has actually spawned). */
  show(): void {
    this.root.style.display = "";
  }

  setPlayers(players: PlayerInfo[]): void {
    this.players = new Map(players.map((p) => [p.id, p]));
  }

  upsertPlayer(p: PlayerInfo): void {
    this.players.set(p.id, p);
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  setScores(scores: Scores): void {
    for (const e of scores.players) {
      const p = this.players.get(e.id);
      if (p) {
        p.score = e.score;
        if (e.deaths !== undefined) p.deaths = e.deaths;
      }
    }
  }

  addKill(attackerId: string, victimId: string, zoneColor?: string): void {
    const attacker = this.players.get(attackerId);
    const victim = this.players.get(victimId);
    const row = document.createElement("div");
    row.className = "kill-row";
    // a sliver of the zone's color says WHERE on the cube it happened
    if (zoneColor) row.style.borderLeft = `3px solid ${zoneColor}`;
    const name = (p: PlayerInfo | undefined, me: boolean) =>
      p ? `<span class="${me ? "kill-me" : "kill-name"}">${escapeHtml(p.name)}</span>` : "?";
    const dartIcon =
      '<svg class="kill-icon" viewBox="0 0 24 12" fill="currentColor" aria-hidden="true">' +
      '<path d="M1 5h10l3-3 2 2-2 2h9v0.5l-9 0.5 2 2-2 2-3-3H1z"/></svg>';
    row.innerHTML =
      attackerId === victimId
        ? `${name(victim, victimId === this.myId)} <span class="kill-self">✕ own grenade</span>`
        : `${name(attacker, attackerId === this.myId)} ${dartIcon} ${name(victim, victimId === this.myId)}`;
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

  // (The in-match Tab leaderboard was removed — the leaderboard lives on the
  // home menu only, fed by /api/leaderboard: global, pure knockout count.)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
