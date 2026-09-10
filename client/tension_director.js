import * as THREE from "three";
import { AudioSystem } from "./audio.js";

// Adaptive atmosphere only. No fake enemies, no damage, no gameplay authority.
let sceneRef=null;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!sceneRef)sceneRef=this;return originalAdd.apply(this,objects)};

const overlay=document.createElement("div");overlay.id="nullspaceBrownout";overlay.style.cssText="position:fixed;inset:0;z-index:16;pointer-events:none;background:#050704;opacity:0;transition:opacity .08s";document.body.appendChild(overlay);

function phase(){return (document.querySelector("#phaseLabel")?.textContent||"").toLowerCase()}
function gameplayVisible(){const hud=document.querySelector("#hud");return !!hud&&!hud.hidden}
function ambientLights(){const out=[];sceneRef?.traverse(o=>{if(o?.isAmbientLight||o?.isHemisphereLight)out.push(o)});return out}
function brownout(){
  if(!sceneRef||!gameplayVisible())return;const lights=ambientLights(),saved=lights.map(l=>[l,l.intensity]);
  for(const [l,v] of saved)l.intensity=v*.18;overlay.style.opacity=".16";
  setTimeout(()=>{for(const [l,v] of saved)l.intensity=v*.7;overlay.style.opacity=".05"},95);
  setTimeout(()=>{for(const [l,v] of saved)l.intensity=v*.1;overlay.style.opacity=".23"},160);
  setTimeout(()=>{for(const [l,v] of saved)l.intensity=v;overlay.style.opacity="0"},285)
}
function audioFootsteps(sys){
  const clips=sys.buffers?.steps||[];if(!clips.length)return;const count=4+Math.floor(Math.random()*3),left=Math.random()>.5?-.72:.72;
  for(let i=0;i<count;i++)setTimeout(()=>sys.playBuffer(clips[Math.floor(Math.random()*clips.length)],.018+i*.002,.76+Math.random()*.13,left*(1-i/count*.55),sys.ambBus),i*(330+Math.random()*90))
}
function radioBurst(sys){
  sys.noise(.18,.012,3300,850,sys.ambBus);setTimeout(()=>sys.tone(1180,.045,.009,"square",sys.ambBus),70);setTimeout(()=>sys.noise(.09,.009,4100,1300,sys.ambBus),125);setTimeout(()=>sys.tone(860,.035,.006,"sine",sys.ambBus),230)
}
function lowRumble(sys){sys.tone(31+Math.random()*7,.85,.014,"sine",sys.ambBus);sys.noise(.32,.012,150,15,sys.ambBus)}

const priorEnsure=AudioSystem.prototype.ensure;
AudioSystem.prototype.ensure=function(...args){const out=priorEnsure.apply(this,args);if(this.ctx&&!this.__directorReady){this.__directorReady=true;this.__directorNext=performance.now()+16000+Math.random()*16000}return out};
const priorUpdate=AudioSystem.prototype.update;
AudioSystem.prototype.update=function(now){
  priorUpdate.call(this,now);if(!this.ctx||!this.__directorReady||!gameplayVisible()||now<(this.__directorNext||0))return;
  const extraction=phase().includes("extraction"),active=phase().includes("active")||extraction;if(!active){this.__directorNext=now+9000;return}
  this.__directorNext=now+(extraction?7000+Math.random()*9000:13000+Math.random()*18000);
  const r=Math.random();if(r<.3)audioFootsteps(this);else if(r<.53)radioBurst(this);else if(r<.72)lowRumble(this);else if(r<.88){brownout();this.noise(.06,.012,4700,1800,this.ambBus)}else{audioFootsteps(this);setTimeout(()=>brownout(),850+Math.random()*700)}
};

window.__NULLSPACE_TENSION_DIRECTOR__=true;
