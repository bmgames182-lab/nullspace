// Live-war controller layered over the ragdoll playground.
// B toggles between the physics-lab behaviour and the original Soldier combat AI.
let warMode=true,lastUi=0;
const configured=new WeakSet();

function configureSoldier(s){
  if(!s||configured.has(s))return;configured.add(s);
  const proto=Object.getPrototypeOf(s);
  s.__gcSandboxUpdate=s.update?.bind(s);s.__gcSandboxClosest=s.closestEnemy?.bind(s);
  s.__gcCombatUpdate=typeof proto?.update==="function"?proto.update:null;
  s.__gcCombatClosest=typeof proto?.closestEnemy==="function"?proto.closestEnemy:null;
  s.__gcWarApplied=null
}
function applyMode(s){
  configureSoldier(s);if(s.__gcWarApplied===warMode)return;s.__gcWarApplied=warMode;
  if(warMode&&s.__gcCombatUpdate&&s.__gcCombatClosest){
    s.closestEnemy=function(){return this.__gcCombatClosest.call(this)};
    s.update=function(dt,now){
      if(this.__playgroundDisposed)return;
      const out=this.__gcCombatUpdate.call(this,dt,now);
      // Keep battles energetic without turning every NPC into a laser beam.
      if(this.alive&&!this.ragdoll&&Number.isFinite(this.nextShot)&&this.nextShot-now>760)this.nextShot=now+520+Math.random()*240;
      return out
    };
    if(s.alive&&!s.ragdoll){s.nextDecision=0;s.nextShot=performance.now()+180+Math.random()*520}
  }else{
    if(s.__gcSandboxClosest)s.closestEnemy=s.__gcSandboxClosest;
    if(s.__gcSandboxUpdate)s.update=s.__gcSandboxUpdate;
    s.target=null;s.nextShot=Infinity
  }
}
function toast(text){
  let el=document.getElementById("warzoneToast");if(!el){el=document.createElement("div");el.id="warzoneToast";el.style.cssText="position:fixed;left:50%;top:13%;transform:translateX(-50%);z-index:18;color:#fff4df;font:900 11px ui-monospace,monospace;letter-spacing:.16em;text-shadow:0 2px 10px #000;pointer-events:none";document.body.appendChild(el)}
  el.textContent=text;el.style.opacity="1";clearTimeout(el.__timer);el.__timer=setTimeout(()=>el.style.opacity="0",900)
}
function toggleWar(){warMode=!warMode;const pg=window.__GHOSTCAM_PLAYGROUND__;if(pg?.dummies)for(const s of pg.dummies){s.__gcWarApplied=null;applyMode(s)}toast(warMode?"LIVE WAR // AI ENGAGED":"PHYSICS LAB // AI HOLD")}
window.addEventListener("keydown",e=>{if(e.code==="KeyB"&&!e.repeat&&document.pointerLockElement){e.preventDefault();toggleWar()}},{capture:true});

function frame(now){
  const pg=window.__GHOSTCAM_PLAYGROUND__;if(pg?.dummies){
    for(const s of pg.dummies)applyMode(s);
    if(now-lastUi>120){
      lastUi=now;let blue=0,red=0,down=0;
      for(const s of pg.dummies){if(s.__playgroundDisposed)continue;if(s.ragdoll)down++;if(s.alive){if(s.team==="blue")blue++;else red++}}
      const objective=document.getElementById("objective"),teams=document.getElementById("teams"),mission=document.querySelector(".mission small"),status=document.getElementById("statusText");
      if(objective)objective.textContent=warMode?"LIVE WARZONE":"RAGDOLL PLAYGROUND";
      if(teams)teams.textContent=warMode?`BLUE ${blue} · RED ${red} · DOWN ${down}`:`AI HOLD · B START WAR · DOWN ${down}`;
      if(mission)mission.textContent=warMode?"BODYCAM // ACTIVE CONTACT":"BODYCAM PHYSICS LAB // FREE PLAY";
      if(status&&warMode&&status.textContent==="SANDBOX ACTIVE")status.textContent="CONTACT ACTIVE"
    }
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame);
window.__GHOSTCAM_WARZONE__={get active(){return warMode},toggle:toggleWar};
