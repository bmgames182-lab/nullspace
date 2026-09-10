const CDN="https://cdn.jsdelivr.net/gh/Nazarwadim/School-Hooligan@master/assets/kenney_rpgaudio/Audio/";
const ASSETS={
  steps:["footstep00.ogg","footstep01.ogg","footstep02.ogg","footstep03.ogg","footstep04.ogg"],
  doorOpen:["doorOpen_1.ogg","doorOpen_2.ogg"],
  doorClose:["doorClose_1.ogg","doorClose_2.ogg"],
  metal:["metalClick.ogg","metalLatch.ogg","metalPot1.ogg"]
};

export class AudioSystem{
  constructor(){
    this.ctx=null;this.master=null;this.sfxBus=null;this.ambBus=null;this.hum=null;this.noiseBuffer=null;
    this.volume=.52;this.buffers={steps:[],doorOpen:[],doorClose:[],metal:[]};this.loading=false;this.loaded=false;
    this.lastStep=0;this.nextAmbient=0;this.lastUpdate=0;
  }

  ensure(){
    if(this.ctx){if(this.ctx.state==="suspended")this.ctx.resume().catch(()=>{});return}
    const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
    this.ctx=new Ctx();this.master=this.ctx.createGain();this.sfxBus=this.ctx.createGain();this.ambBus=this.ctx.createGain();
    this.master.gain.value=this.volume;this.sfxBus.gain.value=.9;this.ambBus.gain.value=.72;
    this.sfxBus.connect(this.master);this.ambBus.connect(this.master);this.master.connect(this.ctx.destination);
    this.noiseBuffer=this.makeNoiseBuffer(2.2);this.startHum();this.loadAssets();this.nextAmbient=performance.now()+3500+Math.random()*4000
  }
  setVolume(v){this.volume=Math.max(0,Math.min(1,Number(v)||0));if(this.master&&this.ctx)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.035)}
  makeNoiseBuffer(seconds){
    const len=Math.max(1,Math.floor(this.ctx.sampleRate*seconds)),b=this.ctx.createBuffer(1,len,this.ctx.sampleRate),d=b.getChannelData(0);
    let smooth=0;for(let i=0;i<len;i++){smooth=smooth*.86+(Math.random()*2-1)*.14;d[i]=smooth*.65+(Math.random()*2-1)*.35}return b
  }
  async loadOne(url){
    const r=await fetch(url,{mode:"cors",cache:"force-cache"});if(!r.ok)throw new Error(`audio ${r.status}`);
    return await this.ctx.decodeAudioData((await r.arrayBuffer()).slice(0))
  }
  async loadAssets(){
    if(!this.ctx||this.loading||this.loaded)return;this.loading=true;
    const tasks=[];
    for(const [group,names] of Object.entries(ASSETS))for(const name of names)tasks.push(this.loadOne(CDN+name).then(b=>this.buffers[group].push(b)).catch(()=>{}));
    await Promise.all(tasks);this.loading=false;this.loaded=true
  }

  startHum(){
    if(!this.ctx||this.hum)return;
    const humGain=this.ctx.createGain(),buzzGain=this.ctx.createGain(),buzzFilter=this.ctx.createBiquadFilter();
    humGain.gain.value=.055;buzzGain.gain.value=.034;buzzFilter.type="bandpass";buzzFilter.frequency.value=1800;buzzFilter.Q.value=.55;
    humGain.connect(this.ambBus);buzzFilter.connect(buzzGain);buzzGain.connect(this.ambBus);
    const a=this.ctx.createOscillator(),b=this.ctx.createOscillator(),c=this.ctx.createOscillator();
    a.type="sine";b.type="sine";c.type="triangle";a.frequency.value=59.7;b.frequency.value=119.4;c.frequency.value=179.1;
    const ag=this.ctx.createGain(),bg=this.ctx.createGain(),cg=this.ctx.createGain();ag.gain.value=.9;bg.gain.value=.28;cg.gain.value=.08;
    a.connect(ag);b.connect(bg);c.connect(cg);ag.connect(humGain);bg.connect(humGain);cg.connect(humGain);a.start();b.start();c.start();
    const n=this.ctx.createBufferSource();n.buffer=this.noiseBuffer;n.loop=true;n.connect(buzzFilter);n.start();
    this.hum={a,b,c,n,humGain,buzzGain,buzzFilter}
  }
  playBuffer(buffer,volume=.1,rate=1,pan=0,bus=this.sfxBus){
    this.ensure();if(!this.ctx||!buffer||!bus)return false;
    const src=this.ctx.createBufferSource(),gain=this.ctx.createGain();src.buffer=buffer;src.playbackRate.value=rate;gain.gain.value=volume;
    if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,pan));src.connect(p);p.connect(gain)}else src.connect(gain);
    gain.connect(bus);src.start();return true
  }
  tone(freq=440,duration=.08,volume=.08,type="sine",bus=this.sfxBus){
    this.ensure();if(!this.ctx||!bus)return;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(Math.max(.0001,volume),this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+duration);
    o.connect(g);g.connect(bus);o.start();o.stop(this.ctx.currentTime+duration)
  }
  noise(duration=.12,volume=.12,lowpass=900,highpass=0,bus=this.sfxBus){
    this.ensure();if(!this.ctx||!this.noiseBuffer||!bus)return;
    const src=this.ctx.createBufferSource(),lp=this.ctx.createBiquadFilter(),g=this.ctx.createGain();src.buffer=this.noiseBuffer;lp.type="lowpass";lp.frequency.value=lowpass;g.gain.value=volume;
    if(highpass>0){const hp=this.ctx.createBiquadFilter();hp.type="highpass";hp.frequency.value=highpass;src.connect(hp);hp.connect(lp)}else src.connect(lp);
    lp.connect(g);g.connect(bus);src.start();src.stop(this.ctx.currentTime+Math.min(duration,1.8))
  }

  step(running=false,crouching=false){
    this.ensure();const now=performance.now(),delay=crouching?500:running?245:340;if(now-this.lastStep<delay)return;this.lastStep=now;
    const vol=crouching?.055:running?.19:.13,clips=this.buffers.steps;
    if(clips.length)this.playBuffer(clips[Math.floor(Math.random()*clips.length)],vol,.9+Math.random()*.18,(Math.random()-.5)*.08);
    else{this.noise(.055,vol*.6,340,55);this.tone(72+Math.random()*20,.028,vol*.18,"triangle")}
  }
  gunshot(scale=1){this.ensure();this.noise(.16,.34*scale,2600,70);this.tone(82,.12,.18*scale,"square");setTimeout(()=>this.noise(.12,.08*scale,900,90),38)}
  dryfire(){const c=this.buffers.metal;if(c.length)this.playBuffer(c[0],.1,1.25);else this.tone(520,.03,.08,"square")}
  reload(){const c=this.buffers.metal;if(c.length){this.playBuffer(c[0],.07,1.15);setTimeout(()=>this.playBuffer(c[Math.min(1,c.length-1)],.08,.95),210)}else{this.tone(720,.025,.05,"square");setTimeout(()=>this.tone(460,.035,.06,"square"),210)}}
  gateOpen(){const c=this.buffers.doorOpen;if(c.length)this.playBuffer(c[Math.floor(Math.random()*c.length)],.24,.72);else{this.noise(.6,.13,450,35);this.tone(96,.55,.05,"sawtooth")}}
  gateClose(){const c=this.buffers.doorClose;if(c.length)this.playBuffer(c[Math.floor(Math.random()*c.length)],.2,.8);else this.noise(.34,.12,520,50)}
  interact(){const c=this.buffers.metal;if(c.length)this.playBuffer(c[Math.floor(Math.random()*Math.min(2,c.length))],.075,1.1);else this.tone(610,.035,.045,"square")}
  ui(ok=true){this.tone(ok?690:190,.065,.045,ok?"sine":"sawtooth")}
  alert(){this.tone(205,.24,.075,"sawtooth");setTimeout(()=>this.tone(154,.3,.065,"sawtooth"),290)}
  anomaly(){this.noise(.42,.16,560,22);this.tone(48,.55,.09,"sawtooth")}
  hit(){this.noise(.08,.15,760,85)}
  flashlight(on=true){const c=this.buffers.metal;if(c.length)this.playBuffer(c[0],.052,on?1.3:.92);else this.tone(on?780:430,.025,.032,"square")}

  update(now){
    if(!this.ctx)return;if(now-this.lastUpdate<100)this.lastUpdate=now;else this.lastUpdate=now;
    if(now<this.nextAmbient)return;
    this.nextAmbient=now+4500+Math.random()*10500;
    if(Math.random()<.72){
      const c=this.buffers.metal;if(c.length)this.playBuffer(c[Math.floor(Math.random()*c.length)],.018+Math.random()*.025,.55+Math.random()*.35,(Math.random()-.5)*1.6,this.ambBus);
      else this.noise(.025+.06*Math.random(),.018,1700+Math.random()*900,300,this.ambBus)
    }else{
      this.noise(.04+.08*Math.random(),.025,2600,550,this.ambBus)
    }
  }
}
