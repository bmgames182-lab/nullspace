// Verified public-domain / CC0 voice samples mirrored on Wikimedia Commons.
// Keeping the URLs here makes the provenance auditable and avoids depending on
// an unversioned sound-effect repository. Test mode disables all network audio.
const COMMONS = "https://commons.wikimedia.org/wiki/Special:Redirect/file/";

const SAMPLE_URLS = Object.freeze({
  screamShort: COMMONS + "Nl-scream.ogg",
  screamSharp: COMMONS + "En-us-scream.ogg",
  screamLong: COMMONS + "UncleSigmund_-_ahhh_%28cc0%29_%28freesound%29.mp3",
  painGrunts: COMMONS + "Male_pain_grunts.ogg",
});

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export class PainAudio {
  constructor() {
    const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
    this.disabled = !!params?.has("test");
    this.lastImpactAt = -Infinity;
    this.lastGroundVoiceAt = -Infinity;
    this.lastVoiceAt = -Infinity;
    this.groundInterval = 1.05;
    this.ctx = null;
    this.active = new Set();
    this.lastMode = "calm";
    this.wasGrounded = false;
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
    this.lastVoiceAt = -Infinity;
    this.lastMode = "calm";
    this.wasGrounded = false;
  }

  now() {
    return typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000;
  }

  trimVoices(max = 3) {
    while (this.active.size >= max) {
      const audio = this.active.values().next().value;
      if (!audio) break;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
      this.active.delete(audio);
    }
  }

  playSample(url, volume = 0.7, rate = 1) {
    if (this.disabled || typeof Audio === "undefined") return;
    this.trimVoices(3);
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.volume = clamp(volume, 0, 1);
    audio.playbackRate = clamp(rate, 0.78, 1.18);
    this.active.add(audio);
    this.lastVoiceAt = this.now();
    const cleanup = () => this.active.delete(audio);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    const promise = audio.play();
    if (promise?.catch) {
      promise.catch(() => {
        cleanup();
        this.synthPain(volume, rate < 0.98 ? 1 : 0.7);
      });
    }
  }

  chooseImpactSample(mode, strength) {
    if (mode === "panic") {
      const roll = Math.random();
      if (roll < 0.34) return SAMPLE_URLS.screamSharp;
      if (roll < 0.7) return SAMPLE_URLS.screamShort;
      return SAMPLE_URLS.screamLong;
    }
    if (strength >= 18 && Math.random() < 0.34) return SAMPLE_URLS.screamShort;
    return SAMPLE_URLS.painGrunts;
  }

  impact({ human, part, strength = 18, event = null }) {
    if (this.disabled) return;
    const torso = /^(chest|abdomen|pelvis)$/.test(part || "");
    const head = part === "head";
    if (!torso && !head) return;

    const now = this.now();
    const mode = human?.traumaSnapshot?.()?.mode || "calm";
    const cooldown = mode === "panic" ? 0.3 : 0.52;
    if (now - this.lastImpactAt < cooldown) return;
    this.lastImpactAt = now;

    const pain = clamp(event?.painSpike ?? strength / 22, 0.15, 1);
    const volume = clamp(0.3 + pain * 0.44 + (mode === "panic" ? 0.18 : 0), 0.28, 0.96);
    const rate = 0.91 + Math.random() * 0.12 - (mode === "panic" ? 0.035 : 0);
    this.playSample(this.chooseImpactSample(mode, strength), volume, rate);
  }

  panicTransition(trauma) {
    const now = this.now();
    if (now - this.lastVoiceAt < 0.22) return;
    const score = clamp(trauma?.panicScore ?? 0.8, 0, 1.4);
    const url = Math.random() < 0.52 ? SAMPLE_URLS.screamSharp : SAMPLE_URLS.screamLong;
    this.playSample(url, clamp(0.54 + score * 0.26, 0.5, 0.96), 0.87 + Math.random() * 0.09);
  }

  groundArrival(trauma) {
    const now = this.now();
    if (now - this.lastVoiceAt < 0.28) return;
    const url = Math.random() < 0.5 ? SAMPLE_URLS.painGrunts : SAMPLE_URLS.screamShort;
    this.playSample(url, trauma?.mode === "panic" ? 0.58 : 0.42, 0.86 + Math.random() * 0.1);
  }

  update(human) {
    if (this.disabled || !human) return;
    const trauma = human.traumaSnapshot?.();
    if (!trauma) return;

    if (trauma.mode === "panic" && this.lastMode !== "panic") this.panicTransition(trauma);
    if (trauma.groundActive && !this.wasGrounded) this.groundArrival(trauma);
    this.lastMode = trauma.mode;
    this.wasGrounded = !!trauma.groundActive;

    if (!trauma.groundActive || trauma.mode !== "panic") return;
    const now = this.now();
    if (now - this.lastGroundVoiceAt < this.groundInterval) return;
    this.lastGroundVoiceAt = now;
    this.groundInterval = 0.9 + Math.random() * 1.45;

    // Grounded vocalisations become less frequent and less intense as the
    // physical panic decays. They are intentionally asynchronous with limbs.
    const decay = Math.exp(-(trauma.groundAge ?? 0) / 5.6);
    if (Math.random() > 0.38 + decay * 0.42) return;
    const roll = Math.random();
    const url = roll < 0.64
      ? SAMPLE_URLS.painGrunts
      : roll < 0.84
        ? SAMPLE_URLS.screamShort
        : SAMPLE_URLS.screamLong;
    this.playSample(url, 0.22 + decay * 0.32, 0.84 + Math.random() * 0.13);
  }

  ensureContext() {
    if (this.disabled || typeof window === "undefined") return null;
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return null;
    if (!this.ctx) this.ctx = new AudioContextType();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Offline fallback if a remote CC0 sample cannot load. It is deliberately a
  // breathy non-speech pain transient rather than pretending synthesized noise
  // is a recorded human voice.
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
