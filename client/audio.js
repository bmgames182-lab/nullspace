export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.hum = null;
    this.noiseBuffer = null;
    this.lastStep = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.29;
    this.master.connect(this.ctx.destination);

    const seconds = 0.85;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last;
    }

    this.startHum();
  }

  startHum() {
    if (!this.ctx || this.hum) return;
    const mix = this.ctx.createGain();
    mix.gain.value = 0.045;
    mix.connect(this.master);

    const low = this.ctx.createOscillator();
    const mains = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    low.type = "sine";
    mains.type = "triangle";
    low.frequency.value = 29.9;
    mains.frequency.value = 59.8;
    filter.type = "lowpass";
    filter.frequency.value = 150;
    low.connect(filter);
    mains.connect(filter);
    filter.connect(mix);
    low.start();
    mains.start();
    this.hum = [low, mains, filter, mix];
  }

  tone(freq = 440, duration = 0.08, volume = 0.08, type = "sine") {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(Math.max(0.0001, volume), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    o.connect(g);
    g.connect(this.master);
    o.start(now);
    o.stop(now + duration + 0.01);
  }

  noise(duration = 0.12, volume = 0.12, lowpass = 900) {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(Math.max(0.0001, volume), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - 0.01);
    src.start(now, Math.random() * maxOffset, Math.min(duration, this.noiseBuffer.duration));
  }

  gunshot() { this.noise(0.12, 0.31, 2300); this.tone(82, 0.10, 0.14, "square"); }
  dryfire() { this.tone(480, 0.03, 0.07, "square"); }
  reload() { this.tone(760, 0.025, 0.04, "square"); setTimeout(() => this.tone(510, 0.035, 0.045, "square"), 220); }
  ui(ok = true) { this.tone(ok ? 730 : 180, 0.07, 0.035, ok ? "sine" : "sawtooth"); }
  alert() { this.tone(220, 0.28, 0.075, "sawtooth"); setTimeout(() => this.tone(165, 0.32, 0.07, "sawtooth"), 310); }
  anomaly() { this.noise(0.38, 0.15, 460); this.tone(52, 0.5, 0.10, "sawtooth"); }
  hit() { this.noise(0.06, 0.11, 650); }

  step(running = false) {
    const now = performance.now();
    if (now - this.lastStep < (running ? 270 : 390)) return;
    this.lastStep = now;
    this.noise(0.05, running ? 0.055 : 0.035, 310);
  }
}
