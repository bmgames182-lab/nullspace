import * as THREE from "three";
import { NetClient } from "./network.js";

let sceneRef=null,cameraRef=null,netRef=null,currentId=null,lastCycle=0;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!sceneRef)sceneRef=this;for(const o of objects)if(o?.isPerspectiveCamera)cameraRef=o;return originalAdd.apply(this,objects)};
const originalConnect=NetClient.prototype.connect;
NetClient.prototype.connect=function(...args){netRef=this;return originalConnect.apply(this,args)};

const overlay=document.createElement("div");overlay.id="spectatorOverlay";overlay.style.cssText="position:fixed;left:50%;top:9%;transform:translateX(-50%);z-index:32;padding:8px 14px;border:1px solid rgba(175,187,160,.38);background:rgba(8,10,8,.72);color:#d8ddce;font:600 12px ui-monospace,monospace;letter-spacing:.08em;text-align:center;pointer-events:none;display:none";document.body.appendChild(overlay);
function candidates(){if(!netRef)return[];return [...netRef.players.values()].filter(p=>p.id!==netRef.id&&!p.dead&&!p.escaped)}
function choose(delta=0){const list=candidates();if(!list.length){currentId=null;return null}let i=list.findIndex(p=>p.id===currentId);if(i<0)i=0;else if(delta)i=(i+delta+list.length)%list.length;currentId=list[i].id;return list[i]}
window.addEventListener("keydown",e=>{
  if(!netRef?.self?.dead)return;if(!["ArrowLeft","ArrowRight","Space"].includes(e.code))return;e.preventDefault();e.stopImmediatePropagation();const now=performance.now();if(now-lastCycle<180)return;lastCycle=now;choose(e.code==="ArrowLeft"?-1:1)
},{capture:true});
let last=performance.now();
function loop(now){
  const dt=Math.min(.05,(now-last)/1000||.016);last=now;const dead=!!netRef?.self?.dead;
  if(!dead){overlay.style.display="none";currentId=null;requestAnimationFrame(loop);return}
  const p=netRef.players.get(currentId)||choose(0);overlay.style.display="block";const cross=document.querySelector("#crosshair");if(cross)cross.style.opacity="0";
  if(!p){overlay.textContent="NO ACTIVE SIGNALS // WAIT FOR INCIDENT RESOLUTION";requestAnimationFrame(loop);return}
  overlay.textContent=`SPECTATING // ${p.name}   ·   ← / → / SPACE SWITCH`;
  if(cameraRef){cameraRef.position.x=THREE.MathUtils.lerp(cameraRef.position.x,p.x||0,1-Math.exp(-dt*9));cameraRef.position.z=THREE.MathUtils.lerp(cameraRef.position.z,p.z||0,1-Math.exp(-dt*9));cameraRef.position.y=THREE.MathUtils.lerp(cameraRef.position.y,1.58,1-Math.exp(-dt*10));const pitch=THREE.MathUtils.clamp(Number(p.pitch)||0,-1.35,1.35),yaw=Number(p.yaw)||0;cameraRef.rotation.order="YXZ";cameraRef.rotation.x=THREE.MathUtils.lerp(cameraRef.rotation.x,pitch,1-Math.exp(-dt*7));let dy=((yaw-cameraRef.rotation.y+Math.PI)%(Math.PI*2))-Math.PI;cameraRef.rotation.y+=dy*(1-Math.exp(-dt*7))}
  requestAnimationFrame(loop)
}
window.addEventListener("load",()=>setTimeout(()=>requestAnimationFrame(loop),1600));
window.__NULLSPACE_SPECTATOR__=true;
