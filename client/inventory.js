import { NetClient } from "./network.js";

let netRef=null,open=false;
const originalConnect=NetClient.prototype.connect;
NetClient.prototype.connect=function(...args){netRef=this;return originalConnect.apply(this,args)};

const panel=document.createElement("div");panel.id="quickInventory";panel.style.cssText="position:fixed;right:3.2%;top:50%;transform:translateY(-50%);z-index:33;width:min(320px,38vw);padding:14px 16px;border:1px solid rgba(196,183,117,.42);background:linear-gradient(180deg,rgba(13,15,11,.92),rgba(7,8,6,.9));color:#e5e0c7;font:12px ui-monospace,monospace;letter-spacing:.04em;box-shadow:0 14px 40px rgba(0,0,0,.35);pointer-events:none;display:none";document.body.appendChild(panel);
function roleName(role){return({researcher:"RESEARCH PERSONNEL",security:"SECURITY OFFICER",quarantine:"QUARANTINE OFFICER",anomaly:"MIMIC ANOMALY",observer:"OBSERVER"})[role]||"UNASSIGNED"}
function render(){
  if(!open||!netRef?.self){panel.style.display="none";return}const s=netRef.self,r=netRef.round||{};panel.style.display="block";
  const items=["FLASHLIGHT","PROXIMITY RADIO"];if(s.weapon)items.push(`9MM SIDEARM  ${s.ammo??0}/12  ·  ${s.reserve??0} RESERVE`);else if((s.reserve??0)>0)items.push(`LOOSE 9MM AMMO  ·  ${s.reserve} ROUNDS`);if(s.hasKeycard)items.push("THRESHOLD KEYCARD");
  panel.innerHTML=`<div style="font-size:10px;opacity:.56;margin-bottom:6px">FIELD INVENTORY // ${roleName(s.role)}</div><div style="font-size:15px;font-weight:800;margin-bottom:12px">LOADOUT</div>${items.map((x,i)=>`<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.07)"><span style="opacity:.42;margin-right:8px">0${i+1}</span>${x}</div>`).join("")}<div style="margin-top:12px;padding-top:9px;border-top:1px solid rgba(255,255,255,.08);font-size:10px;opacity:.52">HP ${Math.round(s.hp??100)}/${Math.round(s.maxHp??100)} · ${String(r.phase||"lobby").toUpperCase()}<br>HOLD X TO INSPECT LOADOUT</div>`
}
window.addEventListener("keydown",e=>{if(e.code!=="KeyX"||e.repeat||!netRef?.self)return;if(document.pointerLockElement)e.preventDefault();open=true;render()},{capture:true});
window.addEventListener("keyup",e=>{if(e.code!=="KeyX")return;open=false;render()},{capture:true});
window.addEventListener("blur",()=>{open=false;render()});
setInterval(()=>{if(open)render()},120);
window.__NULLSPACE_INVENTORY__=true;
