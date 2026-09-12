const SAMPLE_ROOT = "https://raw.githubusercontent.com/jonjonsson/SoundMonster/main/Public%20domain/";

const SAMPLE_URLS = Object.freeze({
  gasp: SAMPLE_ROOT + "shock%20gasp.mp3",
  screamA: SAMPLE_ROOT + "scream%20pain%20man%202.mp3",
  screamB: SAMPLE_ROOT + "scream%20pain%20man%203.mp3",
});

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export class PainAudio {
  constructor() {
    const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
    this.disabled = !!params?.has("test");
    this.lastImpactAt = -Infinity;
    this.lastGroundVoiceAt = -Infinity;
    this.groundInterval = 1.2;
    this.ctx = null;
    this.active = new Set();
  }

  reset() {
    for (const audio of this.active) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
    }
    this.active.clear();
    this.lastImpactAt = -Infinity;
    this.lastGroundVoiceAt = -Infinity;
  }

  now() {
    return typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000;
  }

  chooseImpactSample(mode, strength) {
    if (mode === "panic") return Math.random() < 0.52 ? SAMPLE_URLS.screamA : SAMPLE_URLS.screamB;
    if (strength >= 18 && Math.random() < 0.42) return SAMPLE_URLS.screamB;
    return SAMPLE_URLS.gasp;
  }

  playSample(url, volume = 0.7, rate = 1) {
    if (this.disabled || typeof Audio === "undefined") return;
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = clamp(volume, 0, 1);
    audio.playbackRate = clamp(rate, 0.82, 1.16);
    this.active.add(audio);
    const cleanup = () => this.active.delete(audio);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    const promise = audio.play();
    if (promise?.catch) {
      promise.catch(() => {
        cleanup();
        this.synthPain(volume, rate < 0.98 ? 1 : 0.65);
      });
    }
  }

  impact({ human, part, strength = 18, event = null }) {
    if (this.disabled) return;
    const torso = /^(chest|abdomen|pelvis)$/.test(part || "");
    const head = part === "head";
    if (!torso && !head) return;

    const now = this.now();
    const mode = human?.traumaSnapshot?.()?.mode || "calm";
    const cooldown = mode === "panic" ? 0.38 : 0.58;
    if (now - this.lastImpactAt < cooldown) return;
    this.lastImpactAt = now;

    const pain = clamp(event?.painSpike ?? strength / 22, 0.15, 1);
    const volume = clamp(0.34 + pain * 0.42 + (mode === "panic" ? 0.16 : 0), 0.28, 0.94);
    const rate = 0.93 + Math.random() * 0.1 - (mode === "panic" ? 0.025 : 0);
    this.playSample(this.chooseImpactSample(mode, strength), volume, rate);
  }

  update(human) {
    if (this.disabled || !human) return;
    const trauma = human.traumaSnapshot?.();
    if (!trauma?.groundActive || trauma.mode !== "panic") return;

    const now = this.now();
    if (now - this.lastGroundVoiceAt < this.groundInterval) return;
    this.lastGroundVoiceAt = now;
    this.groundInterval = 1.15 + Math.random() * 1.35;

    // Grounded vocalisations become quieter and less frequent as the physical
    // panic decays. They are deliberately not synchronized to limb movement.
    const decay = Math.exp(-(trauma.groundAge ?? 0) / 5.2);
    if (Math.random() > 0.42 + decay * 0.38) return;
    const url = Math.random() < 0.58 ? SAMPLE_URLS.screamB : SAMPLE_URLS.gasp;
    this.playSample(url, 0.25 + decay * 0.28, 0.88 + Math.random() * 0.12);
  }

  ensureContext() {
    if (this.disabled || typeof window === "undefined") return null;
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return null;
    if (!this.ctx) this.ctx = new AudioContextType();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Network-free fallback. It is not meant to impersonate speech; it gives a
  // short breathy pain/noise transient if the optional CC0 sample cannot load.
  synthPain(volume = 0.55, harshness = 0.75) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const duration = 0.32 + harshness * 0.26;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(Math.max(0.01, volume * 0.22), now + 0.018);
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180 + harshness * 70, now);
    osc.frequency.exponentialRampToValueAtTime(105, now + duration);
    oscGain.gain.value = 0.24;
    osc.connect(oscGain).connect(master);
    osc.start(now);
    osc.stop(now + duration);

    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const envelope = Math.sin(Math.PI * i / data.length);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 760 + harshness * 420;
    filter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.34;
    noise.connect(filter).connect(noiseGain).connect(master);
    noise.start(now);
  }
}

export { SAMPLE_URLS };
