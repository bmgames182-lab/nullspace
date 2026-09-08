export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.hum = null;
    this.lastStep = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
    this.startHum();
  }

  startHum() {
    if (!this.ctx || this.hum) return;
    const mix = this.ctx.createGain();
    mix.gain.value = 0.055;
    mix.connect(this.master);
    const a = this.ctx.createOscillator();
    const b = this.ctx.createOscillator();
    a.type = "sine"; b.type = "triangle";
    a.frequency.value = 59.8; b.frequency.value = 119.6;
    a.connect(mix); b.connect(mix);
    a.start(); b.start();
    this.hum = [a,b,mix];
  }

  tone(freq=440, duration=.08, volume=.08, type="sine") {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(volume, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, this.ctx.currentTime + duration);
    o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + duration);
  }

  noise(duration=.12, volume=.12, lowpass=900) {
    if (!this.ctx) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<len;i++) data[i]=(Math.random()*2-1) * (1-i/len);
    const src = this.ctx.createBufferSource(); src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter(); filter.type="lowpass"; filter.frequency.value=lowpass;
    const g = this.ctx.createGain(); g.gain.value=volume;
    src.connect(filter); filter.connect(g); g.connect(this.master); src.start();
  }

  gunshot() { this.noise(.11,.34,1800); this.tone(95,.09,.18,"square"); }
  dryfire() { this.tone(480,.03,.08,"square"); }
  reload() { this.tone(760,.025,.045,"square"); setTimeout(()=>this.tone(510,.035,.05,"square"),220); }
  ui(ok=true) { this.tone(ok?730:180,.07,.04,ok?"sine":"sawtooth"); }
  alert() { this.tone(220,.28,.09,"sawtooth"); setTimeout(()=>this.tone(165,.32,.08,"sawtooth"),310); }
  anomaly() { this.noise(.38,.18,460); this.tone(52,.5,.12,"sawtooth"); }
  hit() { this.noise(.06,.13,650); }

  step(running=false) {
    const now = performance.now();
    if (now-this.lastStep < (running?270:390)) return;
    this.lastStep = now;
    this.noise(.055,running?.07:.045,260);
  }
}
