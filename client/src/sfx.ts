/**
 * Procedural sound effects (WebAudio, no assets): toy-blaster pews, foam
 * thuds, grenade booms. Distance attenuates remote events. The context is
 * created lazily on the first user gesture (browser autoplay policy).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  constructor() {
    const arm = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this.startAmbient();
      }
      this.ctx.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", arm, { passive: true });
    window.addEventListener("keydown", arm);
  }

  /** Endless city-air bed: two looped noise layers (wind rumble + distant
   * hiss) whose filters drift slowly out of phase so it never sounds like a
   * loop. Very quiet — atmosphere, not music. */
  private startAmbient(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const bed = ctx.createGain();
    bed.gain.value = 0;
    // fade in over 4 s so joining isn't a hiss slap
    bed.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 4);
    bed.connect(this.master);
    // 4 s looped noise buffer shared by both layers
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
    };
    layer("lowpass", 160, 0.7, 0.9, 0.05, 60); // wind rumble
    layer("bandpass", 1100, 0.4, 0.12, 0.023, 350); // distant city hiss
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

  /** Own footstep: a very short, quiet filtered-noise tap. */
  footstep(): void {
    if (!this.ctx) return;
    const g = this.env(0.06, 0.003, 0.04);
    if (!g) return;
    const t = this.ctx.currentTime;
    const dur = 0.04;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 750 * (0.8 + Math.random() * 0.4); // ±20% so steps vary
    bp.Q.value = 1.2;
    src.connect(bp);
    bp.connect(g);
    src.start(t);
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
