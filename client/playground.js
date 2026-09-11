import * as THREE from "three";

// GHOSTCAM playground layer. Soldiers are passive test subjects by default, but recoverable
// knockdowns still use the active-ragdoll controller so hits can become stumbles/falls rather
// than permanently frozen bodies. Manual sandbox flops remain pinned down until released.
const dummies=new Set();
let sceneRef=null,cameraRef=null,SoldierCtor=null,nextIndex=5000,grab=null,lastSpawn=0;
const raycaster=new THREE.Raycaster(),origin=new THREE.Vector3(),direction=new THREE.Vector3(),target=new THREE.Vector3(),delta=new THREE.Vector3();

const nativeAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){
  const result=nativeAdd.apply(this,objects);if(!sceneRef)sceneRef=this;
  for(const o of objects){
    if(o?.isPerspectiveCamera)cameraRef=o;
    if(o?.userData?.soldier){const s=o.userData.soldier;SoldierCtor ||= s.constructor;registerDummy(s)}
  }
  return result
};

function registerDummy(s){
  if(!s||s.__playground)return;s.__playground=true;dummies.add(s);s.manualRagdollHold=false;s.autoRecoverAt=0;
  const baseFall=s.fall?.bind(s),baseDispose=s.dispose?.bind(s),baseRecover=s.recover?.bind(s),baseTakeHit=s.takeHit?.bind(s);

  if(baseFall)s.fall=function(dir,recoverable=true){
    const out=baseFall(dir,recoverable);
    if(this.ragdoll){
      this.ragdoll.__owner=this;
      // Damage-caused recoverable falls are allowed to settle and stand again. Sandbox-triggered
      // flops set manualRagdollHold immediately after this call and therefore stay down.
      if(recoverable&&!this.manualRagdollHold){
        this.autoRecoverAt=performance.now()+1450+Math.random()*850;
        this.recoverAt=this.autoRecoverAt;
      }else this.recoverAt=Infinity;
    }
    return out
  };

  if(baseRecover)s.recover=function(){
    if(!this.alive||!this.ragdoll)return;
    // Never snap an unstable body upright. Keep letting the weak active controller brace and
    // organise the body until it is actually balanced enough to hand control back to animation.
    if(this.ragdoll.canRecover&&!this.ragdoll.canRecover()){
      this.autoRecoverAt=performance.now()+180;
      this.recoverAt=this.autoRecoverAt;
      return
    }
    this.manualRagdollHold=false;this.autoRecoverAt=0;
    return baseRecover()
  };

  if(baseTakeHit)s.takeHit=function(damage,dir,part="torso",source="unknown"){
    // A fresh live-fire hit should release a manually pinned test body only when the soldier was
    // standing. Existing manually-flopped bodies remain sandbox objects and still take impulses.
    const wasStanding=!this.ragdoll;
    const out=baseTakeHit(damage,dir,part,source);
    if(wasStanding&&this.ragdoll?.recoverable&&this.alive){this.manualRagdollHold=false;this.autoRecoverAt=performance.now()+1350+Math.random()*900;this.recoverAt=this.autoRecoverAt}
    return out
  };

  if(baseDispose)s.dispose=function(){dummies.delete(this);if(grab?.owner===this)grab=null;return baseDispose()};

  // No target selection, flanking, cover seeking or return fire in playground mode. Standing
  // dummies breathe and sway; recoverable ragdolls are still fully simulated and can stand again.
  s.closestEnemy=()=>null;
  s.update=function(dt,now){
    if(this.ragdoll){
      this.ragdoll.update(dt);const p=this.ragdoll.getPosition();this.pos.set(p.x,0,p.z);
      if(this.alive&&!this.manualRagdollHold&&this.ragdoll.recoverable&&now>=this.autoRecoverAt&&this.ragdoll.age>1.25){
        if(this.ragdoll.canRecover?.())this.recover?.();else{this.autoRecoverAt=now+180;this.recoverAt=this.autoRecoverAt}
      }
      return
    }
    if(!this.alive)return;this.target=null;this.nextShot=Infinity;
    this.velocity?.set?.(0,0);this.stagger=Math.max(0,(this.stagger||0)-dt*.75);
    this.group.position.x=this.pos.x;this.group.position.z=this.pos.z;
    this.group.rotation.x=Math.sin(now*.0017+(this.index||0))*.007;
    this.group.rotation.z=Math.sin(now*.0012+(this.index||0)*.73)*.009;
    if(this.legs)for(let i=0;i<this.legs.length;i++)this.legs[i].rotation.x=THREE.MathUtils.lerp(this.legs[i].rotation.x,0,Math.min(1,dt*7));
    if(this.arms)for(let i=0;i<this.arms.length;i++)this.arms[i].rotation.x=THREE.MathUtils.lerp(this.arms[i].rotation.x,0,Math.min(1,dt*7));
  };
}

function aimedHit(includeStanding=true,includeRagdolls=true){
  if(!cameraRef)return null;cameraRef.getWorldPosition(origin);cameraRef.getWorldDirection(direction);raycaster.set(origin,direction);raycaster.far=30;
  const meshes=[];
  for(const s of dummies){
    if(includeStanding&&s.group?.visible)s.group.traverse(o=>{if(o.isMesh)meshes.push(o)});
    if(includeRagdolls&&s.ragdoll)for(const {mesh} of s.ragdoll.parts.values())meshes.push(mesh)
  }
  const hit=raycaster.intersectObjects(meshes,false)[0];if(!hit)return null;
  const rag=hit.object.userData.ragdoll,owner=rag?.__owner||hit.object.userData.soldier||null;
  return{hit,owner,rag,part:hit.object.userData.bodyPart||"torso"}
}

function spawnDummy(){
  const now=performance.now();if(!SoldierCtor||!cameraRef||now-lastSpawn<180)return;lastSpawn=now;
  cameraRef.getWorldPosition(origin);cameraRef.getWorldDirection(direction);direction.y=0;if(direction.lengthSq()<.001)direction.set(0,0,-1);direction.normalize();
  const side=new THREE.Vector3(direction.z,0,-direction.x),slot=(nextIndex%5)-2;
  target.copy(origin).addScaledVector(direction,3.8+Math.random()*1.5).addScaledVector(side,slot*.48);target.y=0;
  const team=nextIndex%2?"red":"blue";new SoldierCtor(team,nextIndex++,[target.x,target.z]);toast("DUMMY SPAWNED")
}

function flopDummy(s,push=1){
  if(!s?.alive||s.ragdoll)return;cameraRef?.getWorldDirection(direction);direction.y=.02;direction.normalize();
  s.manualRagdollHold=true;s.fall?.(direction,true);
  if(s.ragdoll){s.ragdoll.__owner=s;s.recoverAt=Infinity;s.autoRecoverAt=Infinity;s.ragdoll.impulse(direction,2.4*push,"torso")}
}
function flopAimed(){const x=aimedHit(true,false);if(x?.owner){flopDummy(x.owner,1.3);toast("PHYSICS RELEASED // HOLD")}}
function flopAll(){for(const s of dummies)flopDummy(s,.65);toast("ALL DUMMIES RAGDOLLED // HOLD")}

function standAimed(){
  const x=aimedHit(false,true),s=x?.owner;if(!s?.ragdoll||!s.alive)return;
  // Y now releases the hold and asks the active controller to recover instead of teleporting the
  // body upright. A small pelvis/torso lift helps badly folded poses start the recovery sequence.
  s.manualRagdollHold=false;s.ragdoll.recoverable=true;s.ragdoll.dead=false;s.ragdoll.settleTime=Math.max(s.ragdoll.settleTime||0,.2);s.ragdoll.age=Math.max(s.ragdoll.age||0,1.25);
  const pelvis=s.ragdoll.parts.get("pelvis")?.body,torso=s.ragdoll.parts.get("torso")?.body;
  pelvis?.applyImpulse({x:0,y:.055,z:0},true);torso?.applyImpulse({x:0,y:.045,z:0},true);
  s.autoRecoverAt=performance.now()+120;s.recoverAt=s.autoRecoverAt;toast("ACTIVE RECOVERY ENABLED")
}
function deleteAimed(){const x=aimedHit(true,true),s=x?.owner;if(!s)return;s.dispose?.();toast("DUMMY REMOVED")}

function resetPlayground(){
  const old=[...dummies];for(const s of old)s.dispose?.();grab=null;
  if(!SoldierCtor||!cameraRef)return;cameraRef.getWorldPosition(origin);cameraRef.getWorldDirection(direction);direction.y=0;direction.normalize();const side=new THREE.Vector3(direction.z,0,-direction.x);
  for(let i=0;i<6;i++){
    const row=Math.floor(i/3),col=i%3-1;target.copy(origin).addScaledVector(direction,5+row*2.1).addScaledVector(side,col*1.35);target.y=0;
    new SoldierCtor(i%2?"red":"blue",nextIndex++,[target.x,target.z])
  }
  toast("PLAYGROUND RESET")
}

function beginGrab(){
  const x=aimedHit(false,true);if(!x?.rag)return;const part=x.rag.parts.get(x.part)||x.rag.parts.get("torso");if(!part)return;grab={body:part.body,owner:x.owner,distance:THREE.MathUtils.clamp(x.hit.distance,1.2,5.5)};toast("RAGDOLL GRAB")
}
function updateGrab(dt){
  if(!grab||!cameraRef)return;const body=grab.body;if(!body){grab=null;return}
  cameraRef.getWorldPosition(origin);cameraRef.getWorldDirection(direction);target.copy(origin).addScaledVector(direction,grab.distance);
  const p=body.translation(),v=body.linvel();delta.set(target.x-p.x,target.y-p.y,target.z-p.z);
  const dist=delta.length(),spring=dist>2.2?.13:.18,damping=dist>2.2?.018:.012,k=Math.min(1,dt*60),impulse=delta.multiplyScalar(spring*k);
  impulse.x-=v.x*damping*k;impulse.y-=v.y*damping*k;impulse.z-=v.z*damping*k;
  // Clamp grab impulse so rapidly turning the camera cannot inject absurd energy into the joint chain.
  const maxImpulse=.42;if(impulse.length()>maxImpulse)impulse.setLength(maxImpulse);
  body.applyImpulse({x:impulse.x,y:impulse.y,z:impulse.z},true)
}

function shoveAimed(){
  const x=aimedHit(true,true);if(!x)return;cameraRef.getWorldDirection(direction);direction.normalize();
  if(x.rag)x.rag.impulse?.(direction,4.8,x.part);else if(x.owner){flopDummy(x.owner,1.6)}toast("SHOVE")
}

const toastEl=document.createElement("div");toastEl.style.cssText="position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:15;color:#f1efe4;font:800 11px ui-monospace,monospace;letter-spacing:.16em;text-shadow:0 2px 8px #000;pointer-events:none;opacity:0;transition:opacity .12s";document.body.appendChild(toastEl);
let toastTimer=0;function toast(text){toastEl.textContent=text;toastEl.style.opacity="1";clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.style.opacity="0",650)}

const panel=document.createElement("div");panel.id="playgroundHelp";panel.style.cssText="position:fixed;left:22px;bottom:74px;z-index:9;padding:9px 11px;border-left:2px solid rgba(230,230,218,.36);background:rgba(5,6,6,.22);color:rgba(237,237,227,.72);font:700 9px/1.65 ui-monospace,monospace;letter-spacing:.1em;pointer-events:none;text-shadow:0 1px 4px #000";panel.innerHTML="<b style='color:#fff'>RAGDOLL PLAYGROUND</b><br>T SPAWN · K FLOP AIMED · J FLOP ALL<br>E HOLD/DRAG BODY · Q SHOVE · Y ACTIVE RECOVERY<br>DEL REMOVE AIMED · H RESET PLAYGROUND";document.body.appendChild(panel);

window.addEventListener("keydown",e=>{
  if(e.repeat||!document.pointerLockElement)return;
  if(e.code==="KeyT"){e.preventDefault();spawnDummy()}
  else if(e.code==="KeyK"){e.preventDefault();flopAimed()}
  else if(e.code==="KeyJ"){e.preventDefault();flopAll()}
  else if(e.code==="KeyY"){e.preventDefault();standAimed()}
  else if(e.code==="KeyQ"){e.preventDefault();shoveAimed()}
  else if(e.code==="KeyH"){e.preventDefault();resetPlayground()}
  else if(e.code==="Delete"){e.preventDefault();deleteAimed()}
  else if(e.code==="KeyE"){e.preventDefault();beginGrab()}
},{capture:true});
window.addEventListener("keyup",e=>{if(e.code==="KeyE")grab=null},{capture:true});

let last=performance.now(),uiAt=0;function frame(now){const dt=Math.min(.04,(now-last)/1000||.016);last=now;updateGrab(dt);
  if(now-uiAt>150){uiAt=now;const objective=document.getElementById("objective"),teams=document.getElementById("teams"),mission=document.querySelector(".mission small");let standing=0,ragdolled=0,recovering=0;for(const s of dummies){if(s.ragdoll){ragdolled++;if(!s.manualRagdollHold&&s.ragdoll.recoverable)recovering++}else if(s.alive)standing++}if(objective)objective.textContent="RAGDOLL PLAYGROUND";if(teams)teams.textContent=`STANDING ${standing} · RAGDOLLS ${ragdolled} · RECOVERING ${recovering}`;if(mission)mission.textContent="BODYCAM PHYSICS LAB // FREE PLAY"}
  requestAnimationFrame(frame)
}requestAnimationFrame(frame);

window.__GHOSTCAM_PLAYGROUND__={dummies,spawnDummy,flopAll,resetPlayground};
