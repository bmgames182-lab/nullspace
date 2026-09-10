import { AudioSystem } from "./audio.js";

// Lightweight presentation layer. It deliberately avoids touching movement/netcode.
// Everything here is cosmetic and has graceful fallbacks.
const style=document.createElement("style");
style.textContent=`
#hitmarker{position:fixed;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%) scale(.7);z-index:30;pointer-events:none;opacity:0;transition:opacity .05s,transform .08s}
#hitmarker:before,#hitmarker:after{content:"";position:absolute;left:16px;top:5px;width:2px;height:24px;background:#eee8cf;box-shadow:0 0 5px rgba(255,255,255,.55)}
#hitmarker:before{transform:rotate(45deg)}#hitmarker:after{transform:rotate(-45deg)}
#hitmarker.on{opacity:.92;transform:translate(-50%,-50%) scale(1)}
#screenGrain{position:fixed;inset:-30%;z-index:18;pointer-events:none;opacity:.035;mix-blend-mode:screen;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.8'/%3E%3C/svg%3E");animation:nullgrain .19s steps(2) infinite}
@keyframes nullgrain{0%{transform:translate(0,0)}25%{transform:translate(-2%,1%)}50%{transform:translate(1%,-2%)}75%{transform:translate(2%,2%)}100%{transform:translate(-1%,-1%)}}
#stressVignette{position:fixed;inset:0;z-index:17;pointer-events:none;opacity:0;background:radial-gradient(circle at center,transparent 45%,rgba(28,0,0,.12) 74%,rgba(5,0,0,.42) 100%);transition:opacity .35s}
body.nullspace-stress #stressVignette{opacity:.62}
body.nullspace-shot #game{filter:brightness(1.045)}
`;
document.head.appendChild(style);

const hit=document.createElement("div");hit.id="hitmarker";document.body.appendChild(hit);
const grain=document.createElement("div");grain.id="screenGrain";document.body.appendChild(grain);
const stress=document.createElement("div");stress.id="stressVignette";document.body.appendChild(stress);

let hitTimer=0,shotTimer=0;
function pulseHit(){hit.classList.add("on");clearTimeout(hitTimer);hitTimer=setTimeout(()=>hit.classList.remove("on"),105)}
function shotKick(){document.body.classList.add("nullspace-shot");clearTimeout(shotTimer);shotTimer=setTimeout(()=>document.body.classList.remove("nullspace-shot"),55)}

// Feed events already represent server-confirmed hit messages, so use them for honest hitmarkers.
const feed=document.querySelector("#feed");
if(feed){
  new MutationObserver(records=>{
    for(const r of records)for(const n of r.addedNodes){
      const text=(n.textContent||"").toUpperCase();
      if(text.includes("IMPACT //"))pulseHit();
      if(text.includes("TRAUMA //")){document.body.classList.add("nullspace-stress");setTimeout(()=>document.body.classList.remove("nullspace-stress"),500)}
    }
  }).observe(feed,{childList:true})
}

// Any local left-click while pointer locked gets a tiny visual kick. Actual ammo/fire authority remains in game.js.
window.addEventListener("mousedown",e=>{if(e.button===0&&document.pointerLockElement)shotKick()},{capture:true});

// Extend the existing audio system with more varied, non-repeating liminal incidents.
const originalEnsure=AudioSystem.prototype.ensure;
AudioSystem.prototype.ensure=function(...args){
  const out=originalEnsure.apply(this,args);
  if(this.ctx&&!this.__nullspaceAtmosphereReady){
    this.__nullspaceAtmosphereReady=true;
    this.__nullspaceNextRare=performance.now()+12000+Math.random()*14000;
  }
  return out
};

const originalUpdate=AudioSystem.prototype.update;
AudioSystem.prototype.update=function(now){
  originalUpdate.call(this,now);
  if(!this.ctx||!this.__nullspaceAtmosphereReady||now<(this.__nullspaceNextRare||0))return;
  this.__nullspaceNextRare=now+12000+Math.random()*24000;
  const event=Math.random();
  const pan=(Math.random()-.5)*1.7;
  if(event<.26){
    // distant pipe/door impact
    const clips=this.buffers?.metal||[];
    if(clips.length)this.playBuffer(clips[Math.floor(Math.random()*clips.length)],.035,.42+Math.random()*.18,pan,this.ambBus);
    this.tone(52+Math.random()*26,.22,.014,"triangle",this.ambBus);
  }else if(event<.5){
    // fluorescent ballast stutter
    this.noise(.12,.014,4200,1500,this.ambBus);
    setTimeout(()=>this.noise(.045,.011,4800,1900,this.ambBus),75);
    setTimeout(()=>this.noise(.03,.008,5200,2100,this.ambBus),160);
  }else if(event<.72){
    // far-off low thump with long room tail illusion
    this.noise(.18,.026,190,20,this.ambBus);
    this.tone(38+Math.random()*12,.48,.018,"sine",this.ambBus);
  }else if(event<.88){
    // something dragging briefly beyond the visible rooms
    for(let i=0;i<4;i++)setTimeout(()=>this.noise(.08,.009,650+Math.random()*180,90,this.ambBus),i*105);
  }else{
    // rare electrical sag: hum audibly droops and recovers
    const g=this.hum?.humGain?.gain;
    if(g){const t=this.ctx.currentTime;g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);g.linearRampToValueAtTime(.014,t+.12);g.linearRampToValueAtTime(.055,t+.85)}
    this.tone(61,.42,.012,"sine",this.ambBus);
  }
};

window.__NULLSPACE_FEEDBACK_FX__=true;
