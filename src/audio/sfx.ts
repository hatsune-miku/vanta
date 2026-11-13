/** Fully synthesised sound: no audio files. Starts on the first user gesture. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private musicOn = false;
  volume = 0.7;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      this.master.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  private n(dur: number, f0: number, f1: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  private o(type: OscillatorType, dur: number, f0: number, f1: number, vol: number, delay = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const os = c.createOscillator(); os.type = type;
    os.frequency.setValueAtTime(f0, t); os.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g); g.connect(this.master); os.start(t); os.stop(t + dur + 0.02);
  }

  play(name: string) {
    if (!this.ctx) return;
    switch (name) {
      case 'swing': this.n(0.13, 900, 5200, 1.2, 0.22); break;
      case 'swingHeavy': this.n(0.24, 400, 3600, 0.9, 0.34); this.o('sine', 0.2, 180, 60, 0.12); break;
      case 'hit': this.n(0.09, 3800, 900, 0.8, 0.5); this.o('square', 0.07, 220, 70, 0.16); this.o('sine', 0.1, 150, 50, 0.3); break;
      case 'hitHeavy': this.n(0.2, 2600, 300, 0.7, 0.7); this.o('sine', 0.26, 130, 34, 0.6); this.o('sawtooth', 0.12, 320, 60, 0.16); break;
      case 'clang': this.o('square', 0.16, 1900, 1500, 0.1); this.o('triangle', 0.3, 2840, 2600, 0.1); this.n(0.06, 6000, 3000, 2, 0.3); break;
      case 'dash': this.n(0.18, 2400, 500, 0.6, 0.26, 'highpass'); break;
      case 'jump': this.n(0.1, 600, 1600, 1, 0.12); break;
      case 'land': this.n(0.08, 500, 120, 0.8, 0.22, 'lowpass'); break;
      case 'perfect': this.o('sine', 0.5, 1760, 1740, 0.22); this.o('sine', 0.6, 2637, 2620, 0.16, 0.04); this.o('sine', 0.7, 3520, 3500, 0.1, 0.08); this.n(0.4, 8000, 2000, 2, 0.12); break;
      case 'hurt': this.o('sawtooth', 0.22, 300, 70, 0.3); this.n(0.16, 1400, 200, 0.7, 0.4); break;
      case 'shoot': this.o('sawtooth', 0.14, 1300, 240, 0.14); this.n(0.07, 5000, 1500, 1, 0.14); break;
      case 'warn': this.o('square', 0.07, 1250, 1250, 0.07); this.o('square', 0.07, 1250, 1250, 0.07, 0.1); break;
      case 'break': this.n(0.35, 5000, 400, 0.6, 0.5); this.o('triangle', 0.5, 880, 110, 0.3); this.o('sine', 0.4, 2200, 2100, 0.1); break;
      case 'die': this.n(0.4, 3000, 120, 0.5, 0.5); this.o('sine', 0.35, 200, 30, 0.4); break;
      case 'exStart': this.n(0.5, 200, 7000, 1.4, 0.3); this.o('sine', 0.6, 60, 240, 0.4); break;
      case 'exCut': this.n(0.12, 7000, 1800, 1.5, 0.6); this.o('square', 0.06, 2400, 600, 0.12); break;
      case 'exGlint': this.o('sine', 0.5, 3136, 3100, 0.16); this.o('sine', 0.5, 4186, 4150, 0.1, 0.03); break;
      case 'exBoom': this.o('sine', 0.9, 110, 24, 0.9); this.n(0.7, 2400, 60, 0.5, 0.7, 'lowpass'); this.n(0.5, 9000, 1200, 0.8, 0.35, 'bandpass', 0.02); this.o('sine', 1.4, 1320, 660, 0.12, 0.05); break;
      case 'special': this.n(0.45, 500, 6000, 1, 0.4); this.o('sawtooth', 0.4, 140, 520, 0.18); break;
      case 'slam': this.o('sine', 0.4, 90, 26, 0.8); this.n(0.3, 900, 80, 0.6, 0.6, 'lowpass'); break;
      case 'gate': this.o('sawtooth', 0.5, 80, 320, 0.2); this.n(0.4, 300, 3000, 2, 0.16); break;
      case 'ui': this.o('sine', 0.12, 880, 1320, 0.14); break;
      case 'clear': this.o('sine', 0.5, 660, 660, 0.16); this.o('sine', 0.6, 990, 990, 0.14, 0.1); this.o('sine', 0.9, 1320, 1320, 0.14, 0.2); break;
    }
  }

  /** A quiet generative pulse so the fight has momentum. */
  startMusic() {
    const c = this.ctx; if (!c || this.musicOn) return;
    this.musicOn = true;
    const bus = c.createGain(); bus.gain.value = 0.16; bus.connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(bus);
    const roots = [55, 55, 65.4, 49];
    const arp = [1, 1.5, 2, 3, 2.4, 2, 1.5, 3];
    const spb = 60 / 132 / 2;
    let next = c.currentTime + 0.1, step = 0;
    const tick = () => {
      if (!this.musicOn || !this.ctx) return;
      // timers are throttled while the tab is hidden; on return, resume from now instead of replaying the gap
      if (next < c.currentTime - 0.1) next = c.currentTime + 0.05;
      while (next < c.currentTime + 0.3) {
        const root = roots[Math.floor(step / 32) % roots.length];
        if (step % 2 === 0) {
          const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = root * (step % 8 === 6 ? 2 : 1);
          g.gain.setValueAtTime(0.5, next); g.gain.exponentialRampToValueAtTime(0.001, next + spb * 1.7);
          o.connect(g); g.connect(lp); o.start(next); o.stop(next + spb * 2);
        }
        const o2 = c.createOscillator(), g2 = c.createGain(); o2.type = 'triangle'; o2.frequency.value = root * 4 * arp[step % 8];
        g2.gain.setValueAtTime(0.12, next); g2.gain.exponentialRampToValueAtTime(0.001, next + spb * 0.9);
        o2.connect(g2); g2.connect(bus); o2.start(next); o2.stop(next + spb);
        if (step % 4 === 0) {
          const k = c.createOscillator(), kg = c.createGain(); k.frequency.setValueAtTime(140, next); k.frequency.exponentialRampToValueAtTime(40, next + 0.12);
          kg.gain.setValueAtTime(0.9, next); kg.gain.exponentialRampToValueAtTime(0.001, next + 0.16); k.connect(kg); kg.connect(bus); k.start(next); k.stop(next + 0.2);
        }
        next += spb; step++;
      }
      setTimeout(tick, 100);
    };
    tick();
  }
  stopMusic() { this.musicOn = false; }
}
