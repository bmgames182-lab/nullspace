import * as THREE from "three";
import { NetClient } from "./network.js";

// Client presentation for server-owned loot caches. The Worker decides whether loot exists and what it awards.
let sceneRef=null,cameraRef=null,netRef=null,built=false;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!sceneRef)sceneRef=this;for(const o of objects)if(o?.isPerspectiveCamera)cameraRef=o;return originalAdd.apply(this,objects)};
const originalConnect=NetClient.prototype.connect;
NetClient.prototype.connect=function(...args){netRef=this;return originalConnect.apply(this,args)};

const CACHES=[
  {id:"a",kind:"supplyA",x:-6,z:14,label:"EMERGENCY ARMS CACHE",accent:0xb58a39},
  {id:"b",kind:"supplyB",x:6,z:-10,label:"FIELD MEDICAL CACHE",accent:0x668b70},
  {id:"c",kind:"supplyC",x:-2,z:2,label:"AMMUNITION CACHE",accent:0x9b8240}
];
const groups=new Map();
const prompt=document.createElement("div");prompt.id="scavengePrompt";prompt.style.cssText="position:fixed;left:50%;bottom:28%;transform:translateX(-50%);z-index:31;padding:8px 12px;border:1px solid rgba(207,193,129,.5);background:rgba(8,9,7,.72);color:#e6e0c5;font:600 12px ui-monospace,monospace;letter-spacing:.08em;pointer-events:none;display:none";document.body.appendChild(prompt);
function mat(color,rough=.75,metal=.2){return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal})}
function build(){
  if(!sceneRef||built)return;built=true;
  for(const c of CACHES){
    const g=new THREE.Group();g.position.set(c.x,0,c.z);g.userData.nullspaceScavenge=true;
    const base=new THREE.Mesh(new THREE.BoxGeometry(.78,.42,.58),mat(0x252822,.7,.3));base.position.y=.21;const lid=new THREE.Mesh(new THREE.BoxGeometry(.82,.12,.62),mat(0x34382f,.62,.36));lid.position.y=.48;
    const stripe=new THREE.Mesh(new THREE.BoxGeometry(.68,.045,.025),new THREE.MeshStandardMaterial({color:c.accent,emissive:c.accent,emissiveIntensity:.48,roughness:.55}));stripe.position.set(0,.34,-.302);
    const lamp=new THREE.PointLight(c.accent,.55,2.2,2);lamp.position.set(0,.72,0);g.add(base,lid,stripe,lamp);sceneRef.add(g);groups.set(c.id,g)
  }
}
function available(c){return !!netRef&&["active","extraction"].includes(netRef.round?.phase)&&!netRef.round?.supplyTaken?.[c.id]}
function nearest(){
  if(!cameraRef||!document.pointerLockElement)return null;let best=null,bestD=1.85;
  for(const c of CACHES){if(!available(c))continue;const d=Math.hypot(cameraRef.position.x-c.x,cameraRef.position.z-c.z);if(d<bestD){bestD=d;best=c}}return best
}
window.addEventListener("keydown",e=>{
  if(e.code!=="KeyE"||e.repeat)return;const c=nearest();if(!c)return;e.preventDefault();e.stopImmediatePropagation();netRef?.interact(c.kind);prompt.style.display="none"
},{capture:true});
function loop(){
  if(!built)build();for(const c of CACHES){const g=groups.get(c.id);if(g)g.visible=available(c)}
  const c=nearest();if(c){prompt.textContent=`[ E ] SEARCH ${c.label}`;prompt.style.display="block"}else prompt.style.display="none";
  requestAnimationFrame(loop)
}
window.addEventListener("load",()=>setTimeout(()=>requestAnimationFrame(loop),1100));
window.__NULLSPACE_SCAVENGE__=true;
