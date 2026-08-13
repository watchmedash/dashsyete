/**
 * Procedural sound effects (WebAudio, no assets): toy-blaster pews, foam
 * thuds, grenade booms. Distance attenuates remote events. The context is
 * created lazily on the first user gesture (browser autoplay policy).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Master volume 0..1 (settings panel); base loudness is 0.5 at volume 1. */
  private volume = 1;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = 0.5 * this.volume;
  }

  constructor() {
    const arm = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5 * this.volume;
        this.master.connect(this.ctx.destination);
        this.startAmbient();
      }
      this.ctx.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", arm, { passive: true });
    window.addEventListener("keydown", arm);
  }

  /** Per-biome ambient bed: looped filtered-noise layers (never sounds like
   * a loop thanks to slow LFO filter drift) + occasional one-shot accents
   * (birds, lava crackles). Crossfades when the player walks onto a new
   * face. Very quiet — atmosphere, not music. */
  private ambientFace = -1;
  private bed: GainNode | null = null;
  private bedSources: AudioScheduledSourceNode[] = [];
  private bedAccent: ReturnType<typeof setInterval> | null = null;

  /** Which cube face (biome) the player stands on — drives the ambient bed. */
  setBiome(face: number): void {
    if (face === this.ambientFace) return;
    this.ambientFace = face;
    if (this.ctx) this.buildBed(face, 1.5);
  }

  private startAmbient(): void {
    this.buildBed(Math.max(0, this.ambientFace), 4); // slow first fade — joining isn't a hiss slap
  }

  private buildBed(face: number, fadeS: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    // fade out + retire the previous face's bed
    if (this.bed) {
      const old = this.bed;
      const oldSrcs = this.bedSources;
      old.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.setValueAtTime(old.gain.value, ctx.currentTime);
      old.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => { oldSrcs.forEach((s) => { try { s.stop(); } catch {} }); old.disconnect(); }, 1700);
    }
    if (this.bedAccent) { clearInterval(this.bedAccent); this.bedAccent = null; }
    this.bedSources = [];

    const bed = ctx.createGain();
    bed.gain.value = 0;
    bed.gain.linearRampToValueAtTime(0.05, ctx.currentTime + fadeS);
    bed.connect(this.master);
    this.bed = bed;

    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const layer = (type: BiquadFilterType, freq: number, q: number, vol: number, lfoHz: number, lfoDepth: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      // slow LFO wanders the filter cutoff — the "gusts"
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lfoG = ctx.createGain();
      lfoG.gain.value = lfoDepth;
      lfo.connect(lfoG);
      lfoG.connect(f.frequency);
      src.connect(f);
      f.connect(g);
      g.connect(bed);
      src.start();
      lfo.start();
      this.bedSources.push(src, lfo);
    };
    const drone = (freq: number, vol: number) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g);
      g.connect(bed);
      o.start();
      this.bedSources.push(o);
    };
    // one-shot accent scheduler (bird chirps / lava crackles)
    const accents = (everyMs: number, chance: number, play: () => void) => {
      this.bedAccent = setInterval(() => { if (Math.random() < chance) play(); }, everyMs);
    };
    const chirp = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      g.connect(bed);
      const o = this.ctx.createOscillator();
      o.type = "sine";
      const f0 = 2400 + Math.random() * 1600;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * (1.1 + Math.random() * 0.3), t + 0.08);
      o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.2);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.3);
    };
    const crackle = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      g.connect(bed);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.4 + Math.random() * 0.5;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 300 + Math.random() * 500;
      f.Q.value = 2;
      src.connect(f);
      f.connect(g);
      src.start(t);
      src.stop(t + 0.18);
    };

    switch (face) {
      case 1: // volcanic: deep magma rumble + surface crackles
        layer("lowpass", 85, 0.8, 1.5, 0.04, 30);
        drone(38, 0.28);
        accents(900, 0.5, crackle);
        break;
      case 2: // desert: dry breathy wind, strong slow gusts
        layer("bandpass", 650, 0.35, 0.4, 0.03, 400);
        layer("lowpass", 200, 0.7, 0.6, 0.06, 90);
        break;
      case 3: // antarctic: icy whistling wind over a cold low bed
        layer("bandpass", 1600, 6, 0.25, 0.05, 500);
        layer("lowpass", 170, 0.7, 0.8, 0.045, 70);
        break;
      case 4: // forest: leaf rustle + soft breeze + busy birds
        layer("highpass", 2600, 0.4, 0.07, 0.08, 700);
        layer("lowpass", 190, 0.7, 0.7, 0.05, 60);
        accents(1400, 0.55, chirp);
        break;
      case 5: // moon: near-vacuum — a faint eerie drone, nothing else
        drone(52, 0.1);
        drone(52.7, 0.08); // slow beat-frequency shimmer
        break;
      default: // grassland: gentle meadow breeze + sparse birdsong
        layer("lowpass", 220, 0.7, 0.9, 0.05, 70);
        layer("bandpass", 1100, 0.4, 0.1, 0.023, 350);
        accents(2200, 0.4, chirp);
        break;
    }
  }

  /** Critical-HP heartbeat: soft double lub-dub loop while below 30 HP. */
  private heartTimer: ReturnType<typeof setInterval> | null = null;
  setCritical(on: boolean): void {
    if (on && this.heartTimer === null) {
      const beat = () => {
        const thump = (delay: number, vol: number) => {
          if (!this.ctx) return;
          const g = this.ctx.createGain();
          const t = this.ctx.currentTime + delay;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(vol, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
          g.connect(this.master!);
          const o = this.ctx.createOscillator();
          o.type = "sine";
          o.frequency.setValueAtTime(58, t);
          o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
          o.connect(g);
          o.start(t);
          o.stop(t + 0.18);
        };
        thump(0, 0.22);
        thump(0.22, 0.15);
      };
      beat();
      this.heartTimer = setInterval(beat, 1050);
    } else if (!on && this.heartTimer !== null) {
      clearInterval(this.heartTimer);
      this.heartTimer = null;
    }
  }

  /** 0..1 loudness from distance in meters (1 at 0 m, 0 at `range`). */
  private falloff(dist: number, range = 60): number {
    return Math.max(0, 1 - dist / range);
  }

  private env(gainPeak: number, attack: number, decay: number, pan = 0): GainNode | null {
    if (!this.ctx || !this.master) return null;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    if (pan !== 0 && typeof this.ctx.createStereoPanner === "function") {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  /** Toy blaster shot; pitch/length vary per weapon. `pan` -1..1 = left..right. */
  pew(weapon: string, dist = 0, pan = 0): void {
    const loud = this.falloff(dist);
    if (!this.ctx || loud <= 0) return;
    const cfg =
      weapon === "rapid"
        ? { f0: 1300, f1: 500, dur: 0.07, vol: 0.18 }
        : weapon === "heavy"
          ? { f0: 620, f1: 120, dur: 0.22, vol: 0.34 }
          : { f0: 950, f1: 260, dur: 0.12, vol: 0.25 };
    const g = this.env(cfg.vol * loud, 0.004, cfg.dur, pan);
    if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "square";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(cfg.f0, t);
    o.frequency.exponentialRampToValueAtTime(cfg.f1, t + cfg.dur);
    o.connect(g);
    o.start(t);
    o.stop(t + cfg.dur + 0.05);
  }

  /** Own footstep: a very short, quiet filtered-noise tap whose timbre
   * matches the surface underfoot (grass thud, sand shuffle, snow crunch,
   * ice click, hard stone tap). */
  footstep(surface: "grass" | "dirt" | "sand" | "snow" | "ice" | "hard" = "hard"): void {
    if (!this.ctx) return;
    const P = {
      grass: { f: 420, q: 0.9, dur: 0.05, vol: 0.05 },
      dirt: { f: 560, q: 1.0, dur: 0.05, vol: 0.055 },
      sand: { f: 320, q: 0.6, dur: 0.09, vol: 0.05 },
      snow: { f: 720, q: 0.8, dur: 0.09, vol: 0.06 },
      ice: { f: 1900, q: 4, dur: 0.03, vol: 0.05 },
      hard: { f: 950, q: 1.4, dur: 0.035, vol: 0.06 },
    }[surface];
    const tap = (delay: number, vol: number, dur: number) => {
      const g = this.env(vol, 0.003, dur);
      if (!g || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = P.f * (0.8 + Math.random() * 0.4); // ±20% so steps vary
      bp.Q.value = P.q;
      src.connect(bp);
      bp.connect(g);
      src.start(t);
    };
    tap(0, P.vol, P.dur);
    if (surface === "snow") tap(0.045, P.vol * 0.6, 0.05); // the second crunch grain
  }

  /** Confirmed hit on someone else (crisp tick; headshots ring brighter). */
  hitConfirm(headshot = false): void {
    if (!this.ctx) return;
    const g = this.env(headshot ? 0.3 : 0.22, 0.002, headshot ? 0.16 : 0.07);
    if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    const t = this.ctx.currentTime;
    if (headshot) {
      // two-note rising chime — unmistakably a crit
      o.frequency.setValueAtTime(1300, t);
      o.frequency.setValueAtTime(1950, t + 0.07);
    } else {
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.06);
    }
    o.connect(g);
    o.start(t);
    o.stop(t + (headshot ? 0.2 : 0.1));
  }

  /** You got tagged (dull foam thud). */
  hurt(): void {
    if (!this.ctx) return;
    const g = this.env(0.32, 0.004, 0.16);
    if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.14);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Grenade explosion: noise burst + sub thump. `pan` -1..1 = left..right. */
  boom(dist = 0, pan = 0): void {
    const loud = this.falloff(dist, 90);
    if (!this.ctx || loud <= 0) return;
    const t = this.ctx.currentTime;
    // noise burst through a closing lowpass
    const noiseG = this.env(0.5 * loud, 0.005, 0.5, pan);
    if (!noiseG) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.45);
    src.connect(lp);
    lp.connect(noiseG);
    src.start(t);
    // sub thump
    const subG = this.env(0.5 * loud, 0.004, 0.3);
    if (subG) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
      o.connect(subG);
      o.start(t);
      o.stop(t + 0.35);
    }
  }

  /** Weapon draw/swap (quick two-click ratchet). */
  draw(): void {
    if (!this.ctx || !this.master) return;
    for (const [dt, f] of [[0, 900], [0.07, 1400]] as const) {
      const t = this.ctx.currentTime + dt;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      g.connect(this.master);
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(f, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.05);
    }
  }

  /** Grenade bouncing off the street (hollow plastic thock). */
  thock(dist = 0, pan = 0): void {
    const loud = this.falloff(dist, 40);
    if (!this.ctx || loud <= 0) return;
    const g = this.env(0.16 * loud, 0.002, 0.09, pan);
    if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(340, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Knockout sting (descending womp-womp). */
  knockout(mine: boolean): void {
    if (!this.ctx) return;
    const g = this.env(mine ? 0.36 : 0.16, 0.01, 0.5);
    if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(330, t);
    o.frequency.setValueAtTime(247, t + 0.16);
    o.frequency.setValueAtTime(165, t + 0.32);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.55);
  }

  /** Empty-mag dry click. */
  dryClick(): void {
    if (!this.ctx) return;
    const g = this.env(0.14, 0.002, 0.05);
    if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "square";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.03);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.06);
  }

  /** Streak sting: rising arpeggio, one extra note per streak tier. */
  streak(tier: number): void {
    if (!this.ctx || !this.master) return;
    const notes = [523, 659, 784, 1047, 1319].slice(0, Math.max(3, Math.min(tier, 5)));
    for (let i = 0; i < notes.length; i++) {
      const t = this.ctx.currentTime + i * 0.07;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      g.connect(this.master);
      const o = this.ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(notes[i], t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.28);
    }
  }

  /** A nearby crate finished rearming (soft two-note chime). */
  rearm(dist = 0, pan = 0): void {
    const loud = this.falloff(dist, 30);
    if (!this.ctx || loud <= 0) return;
    for (const [dt, f] of [[0, 620], [0.09, 930]] as const) {
      const g = this.env(0.08 * loud, 0.01, 0.2, pan);
      if (!g) return;
      const o = this.ctx.createOscillator();
      o.type = "sine";
      const t = this.ctx.currentTime + dt;
      o.frequency.setValueAtTime(f, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.25);
    }
  }

  /** Weapon pickup chirp (rising). */
  pickup(): void {
    if (!this.ctx) return;
    const g = this.env(0.2, 0.005, 0.18);
    if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(520, t);
    o.frequency.setValueAtTime(780, t + 0.07);
    o.frequency.setValueAtTime(1040, t + 0.14);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.24);
  }
}
