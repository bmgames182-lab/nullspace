export class BodycamAudio{
  constructor(){this.ctx=null;this.master=null;this.sfx=null;this.amb=null;this.noiseBuffer=null;this.volume=.72;this.lastStep=0;this.nextDistant=0}
  ensure(){
    if(this.ctx){if(this.ctx.state==="suspended")this.ctx.resume().catch(()=>{});return}
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return;this.ctx=new C({latencyHint:"interactive"});this.master=this.ctx.createGain();this.sfx=this.ctx.createGain();this.amb=this.ctx.createGain();this.master.gain.value=this.volume;this.sfx.gain.value=.92;this.amb.gain.value=.34;this.sfx.connect(this.master);this.amb.connect(this.master);this.master.connect(this.ctx.destination);
    const n=Math.floor(this.ctx.sampleRate*2.5),b=this.ctx.createBuffer(1,n,this.ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=Math.random()*2-1;this.noiseBuffer=b;this.startAmbience();this.nextDistant=performance.now()+5000
  }
  setVolume(v){this.volume=Math.max(0,Math.min(1,Number(v)||0));if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.03)}
  nodePan(pan=0,bus=this.sfx){const g=this.ctx.createGain();if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,pan));p.connect(g);g.connect(bus);return{input:p,gain:g}}g.connect(bus);return{input:g,gain:g}}
  noise(duration=.12,volume=.1,low=5000,high=40,pan=0,bus=this.sfx){this.ensure();if(!this.ctx)return;const src=this.ctx.createBufferSource(),hp=this.ctx.createBiquadFilter(),lp=this.ctx.createBiquadFilter(),out=this.nodePan(pan,bus);src.buffer=this.noiseBuffer;src.loop=true;hp.type="highpass";hp.frequency.value=high;lp.type="lowpass";lp.frequency.value=low;out.gain.gain.setValueAtTime(Math.max(.0001,volume),this.ctx.currentTime);out.gain.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+duration);src.connect(hp);hp.connect(lp);lp.connect(out.input);src.start(this.ctx.currentTime,Math.random()*1.8);src.stop(this.ctx.currentTime+duration)}
  tone(freq,duration,volume,type="sine",pan=0,bus=this.sfx){this.ensure();if(!this.ctx)return;const o=this.ctx.createOscillator(),out=this.nodePan(pan,bus);o.type=type;o.frequency.setValueAtTime(freq,this.ctx.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(18,freq*.55),this.ctx.currentTime+duration);out.gain.gain.setValueAtTime(Math.max(.0001,volume),this.ctx.currentTime);out.gain.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+duration);o.connect(out.input);o.start();o.stop(this.ctx.currentTime+duration)}
  startAmbience(){const wind=this.ctx.createBufferSource(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();wind.buffer=this.noiseBuffer;wind.loop=true;f.type="lowpass";f.frequency.value=520;g.gain.value=.035;wind.connect(f);f.connect(g);g.connect(this.amb);wind.start();const hum=this.ctx.createOscillator(),hg=this.ctx.createGain();hum.type="sine";hum.frequency.value=43;hg.gain.value=.018;hum.connect(hg);hg.connect(this.amb);hum.start()}
  gun(local=true,pan=0,scale=1){this.ensure();const k=local?1:.62;this.noise(.055,.48*k*scale,10000,110,pan);this.noise(.22,.22*k*scale,1900,45,pan);this.tone(105,.09,.14*k*scale,"square",pan);setTimeout(()=>this.noise(.13,.06*k*scale,700,60,pan),38)}
  impact(pan=0,metal=false){this.noise(.045,metal?.11:.075,metal?8500:2600,metal?900:180,pan);if(metal)this.tone(1500+Math.random()*900,.045,.035,"triangle",pan)}
  bodyHit(pan=0){this.noise(.06,.11,780,70,pan);this.tone(86,.055,.035,"triangle",pan)}
  playerHit(){this.noise(.09,.16,950,55,0);this.tone(61,.15,.07,"sawtooth",0)}
  step(run=false,crouch=false){this.ensure();const now=performance.now(),gap=crouch?460:run?235:330;if(now-this.lastStep<gap)return;this.lastStep=now;const v=crouch?.045:run?.105:.075;this.noise(.04,v,520,80,(Math.random()-.5)*.12);this.tone(78+Math.random()*22,.024,v*.24,"triangle")}
  reload(){this.tone(780,.025,.045,"square");setTimeout(()=>this.noise(.035,.055,4800,700),180);setTimeout(()=>this.tone(520,.035,.055,"square"),470)}
  dry(){this.tone(420,.025,.055,"square")}
  flashlight(on){this.tone(on?880:620,.02,.025,"square")}
  explosion(pan=0,scale=1){this.noise(.65,.5*scale,1100,25,pan);this.tone(42,.65,.17*scale,"sawtooth",pan)}
  update(now){if(!this.ctx||now<this.nextDistant)return;this.nextDistant=now+5000+Math.random()*11000;const pan=(Math.random()-.5)*1.7;if(Math.random()<.72){this.gun(false,pan,.25+Math.random()*.2);if(Math.random()<.35)setTimeout(()=>this.gun(false,pan+.1,.2),120+Math.random()*220)}else this.explosion(pan,.18)}
}
