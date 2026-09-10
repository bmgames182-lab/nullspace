const FOOTSTEP_URLS = [
  "https://cdn.jsdelivr.net/gh/Nazarwadim/School-Hooligan@master/assets/kenney_rpgaudio/Audio/footstep00.ogg",
  "https://cdn.jsdelivr.net/gh/Nazarwadim/School-Hooligan@master/assets/kenney_rpgaudio/Audio/footstep01.ogg",
  "https://cdn.jsdelivr.net/gh/Nazarwadim/School-Hooligan@master/assets/kenney_rpgaudio/Audio/footstep02.ogg"
];

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.hum = null;
    this.lastStep = 0;
    this.noiseBuffer = null;
    this.volume = 0.38;
    this.footsteps = [];
    this.loadingAssets = false;
    this.assetLoadAttempted = false;
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
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoiseBuffer(0.7);
    this.startHum();
    this.loadAssets();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
  }

  makeNoiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<len;i++) data[i]=Math.random()*2-1;
    return buffer;
  }

  async loadAssets() {
    if (!this.ctx || this.loadingAssets || this.assetLoadAttempted) return;
    this.loadingAssets = true;
    this.assetLoadAttempted = true;
    try {
      const loaded = await Promise.allSettled(FOOTSTEP_URLS.map(async (url) => {
        const response = await fetch(url, { mode: "cors", cache: "force-cache" });
        if (!response.ok) throw new Error(`audio ${response.status}`);
        const bytes = await response.arrayBuffer();
        return await this.ctx.decodeAudioData(bytes.slice(0));
      }));
      this.footsteps = loaded.filter(x => x.status === "fulfilled").map(x => x.value);
    } catch {}
    this.loadingAssets = false;
  }

  startHum() {
    if (!this.ctx || this.hum) return;
    const mix = this.ctx.createGain();
    mix.gain.value = 0.075;
    mix.connect(this.master);
    const a = this.ctx.createOscillator(), b = this.ctx.createOscillator(), c = this.ctx.createOscillator();
    a.type="sine"; b.type="triangle"; c.type="sine";
    a.frequency.value=59.8; b.frequency.value=119.6; c.frequency.value=29.9;
    const cg = this.ctx.createGain(); cg.gain.value=.16;
    a.connect(mix); b.connect(mix); c.connect(cg); cg.connect(mix);
    a.start(); b.start(); c.start();
    this.hum=[a,b,c,cg,mix];
  }

  playBuffer(buffer, volume=.12, rate=1) {
    this.ensure();
    if (!this.ctx || !this.master || !buffer) return false;
    const src=this.ctx.createBufferSource(),g=this.ctx.createGain();
    src.buffer=buffer;src.playbackRate.value=rate;g.gain.value=volume;
    src.connect(g);g.connect(this.master);src.start();
    return true;
  }

  tone(freq=440,duration=.08,volume=.08,type="sine") {
    this.ensure();
    if (!this.ctx || !this.master) return;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(Math.max(.0001,volume),this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+duration);
    o.connect(g);g.connect(this.master);o.start();o.stop(this.ctx.currentTime+duration);
  }

  noise(duration=.12,volume=.12,lowpass=900) {
    this.ensure();
    if (!this.ctx || !this.noiseBuffer || !this.master) return;
    const src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;
    const filter=this.ctx.createBiquadFilter();filter.type="lowpass";filter.frequency.value=lowpass;
    const g=this.ctx.createGain();g.gain.value=volume;
    src.connect(filter);filter.connect(g);g.connect(this.master);src.start();src.stop(this.ctx.currentTime+Math.min(duration,.68));
  }

  gunshot(){this.ensure();this.noise(.13,.38,2100);this.tone(88,.1,.18,"square")}
  dryfire(){this.ensure();this.tone(480,.035,.1,"square")}
  reload(){this.ensure();this.tone(760,.03,.055,"square");setTimeout(()=>this.tone(510,.04,.065,"square"),220)}
  ui(ok=true){this.ensure();this.tone(ok?730:180,.07,.05,ok?"sine":"sawtooth")}
  alert(){this.ensure();this.tone(220,.28,.11,"sawtooth");setTimeout(()=>this.tone(165,.32,.1,"sawtooth"),310)}
  anomaly(){this.ensure();this.noise(.38,.2,460);this.tone(52,.5,.14,"sawtooth")}
  hit(){this.ensure();this.noise(.07,.16,650)}

  step(running=false,crouching=false){
    this.ensure();
    const now=performance.now();
    const delay=crouching?520:running?255:355;
    if(now-this.lastStep<delay)return;
    this.lastStep=now;
    const volume=crouching?.045:running?.16:.105;
    if(this.footsteps.length){
      const clip=this.footsteps[Math.floor(Math.random()*this.footsteps.length)];
      this.playBuffer(clip,volume,.92+Math.random()*.16);
    }else{
      this.noise(.065,volume*.72,310);
      this.tone(78+Math.random()*18,.035,volume*.24,"triangle");
    }
  }
}
