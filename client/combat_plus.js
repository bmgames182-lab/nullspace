import * as THREE from "three";

// Extra simulation layer kept separate from the core loop so it can be tuned aggressively
// without destabilising movement or Rapier stepping.
const soldiers=new Set(),ragdollMeshes=new Set(),grenades=[],fx=[];
let sceneRef=null,cameraRef=null,grenadesLeft=3,lastThrow=0,blastShake=0,lastFrame=performance.now();
const raycaster=new THREE.Raycaster(),rayDir=new THREE.Vector3(),rayOrigin=new THREE.Vector3(),tmp=new THREE.Vector3();

const nativeAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){
  const result=nativeAdd.apply(this,objects);if(!sceneRef)sceneRef=this;
  for(const o of objects){
    if(o?.isPerspectiveCamera)cameraRef=o;
    if(o?.userData?.soldier){soldiers.add(o.userData.soldier);patchSoldier(o.userData.soldier)}
    if(o?.userData?.ragdoll)ragdollMeshes.add(o);
  }
  return result
};

function patchSoldier(s){
  if(!s||s.__ghostcamPlus)return;s.__ghostcamPlus=true;s.suppressedUntil=0;s.lastDive=0;
  const fall=s.fall?.bind(s),recover=s.recover?.bind(s),takeHit=s.takeHit?.bind(s),update=s.update?.bind(s);
  if(fall)s.fall=function(dir,recoverable){
    // Core death marks alive=false before asking fall() for a corpse. Temporarily allow that
    // one call so lethal hits always produce a physical body rather than a disappearing actor.
    if(!recoverable&&!this.alive&&!this.ragdoll){const alive=this.alive;this.alive=true;const out=fall(dir,false);this.alive=alive;this.state="dead";return out}
    return fall(dir,recoverable)
  };
  if(recover)s.recover=function(){
    if(this.ragdoll?.canRecover&&!this.ragdoll.canRecover()){this.recoverAt=performance.now()+220;return}
    return recover()
  };
  if(takeHit)s.takeHit=function(damage,dir,part="torso",source="unknown"){
    const out=takeHit(damage,dir,part,source);if(this.alive){const now=performance.now();this.suppressedUntil=Math.max(this.suppressedUntil,now+650+Math.min(1300,damage*14));if(part.startsWith("leg"))this.stagger=Math.max(this.stagger||0,.95)}return out
  };
  if(update)s.update=function(dt,now){
    const ox=this.pos?.x??0,oz=this.pos?.z??0;
    if(this.alive&&this.suppressedUntil>now)this.nextShot=Math.max(this.nextShot||0,now+170+Math.random()*220);
    const out=update(dt,now);
    if(this.alive&&!this.ragdoll&&this.state==="active"&&this.pos&&this.group){
      const wounded=THREE.MathUtils.clamp(.56+(this.hp||100)/225,.58,1),suppressed=this.suppressedUntil>now?.72:1,factor=wounded*suppressed;
      this.pos.x=ox+(this.pos.x-ox)*factor;this.pos.z=oz+(this.pos.z-oz)*factor;this.group.position.x=this.pos.x;this.group.position.z=this.pos.z;
      const hurt=1-THREE.MathUtils.clamp((this.hp||100)/100,0,1);this.group.rotation.x=Math.sin(now*.009+(this.index||0))*hurt*.035
    }
    return out
  }
}

function audioBoom(scale=1){
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=audioBoom.ctx||(audioBoom.ctx=new C());if(ctx.state==="suspended")ctx.resume().catch(()=>{});
  const len=Math.floor(ctx.sampleRate*.7),buffer=ctx.createBuffer(1,len,ctx.sampleRate),data=buffer.getChannelData(0);let smooth=0;for(let i=0;i<len;i++){smooth=smooth*.82+(Math.random()*2-1)*.18;data[i]=smooth*(1-i/len)}
  const src=ctx.createBufferSource(),lp=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=buffer;lp.type="lowpass";lp.frequency.value=520;gain.gain.setValueAtTime(.55*scale,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.65);src.connect(lp);lp.connect(gain);gain.connect(ctx.destination);src.start()
}

function addFx(mesh,velocity,life,g=0,grow=0,fade=true){sceneRef?.add(mesh);fx.push({mesh,velocity,life,max:life,g,grow,fade})}
function bloodBurst(point,dir,count=7){for(let i=0;i<count;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.012+Math.random()*.018,4,3),new THREE.MeshBasicMaterial({color:Math.random()<.3?0x86140f:0x4c0908}));m.position.copy(point);const v=dir.clone().multiplyScalar(.45+Math.random()*1.4).add(new THREE.Vector3((Math.random()-.5)*.9,.15+Math.random()*.9,(Math.random()-.5)*.9));addFx(m,v,.45+Math.random()*.35,3.5)}}

function throwGrenade(){
  const now=performance.now();if(!sceneRef||!cameraRef||grenadesLeft<=0||now-lastThrow<550||!document.pointerLockElement)return;lastThrow=now;grenadesLeft--;updateGrenadeHud();
  cameraRef.getWorldPosition(rayOrigin);cameraRef.getWorldDirection(rayDir);const mat=new THREE.MeshStandardMaterial({color:0x202522,roughness:.72,metalness:.58}),mesh=new THREE.Mesh(new THREE.SphereGeometry(.075,10,7),mat);mesh.scale.set(1,.82,1);mesh.position.copy(rayOrigin).addScaledVector(rayDir,.48).add(new THREE.Vector3(0,-.12,0));sceneRef.add(mesh);
  grenades.push({mesh,vel:rayDir.clone().multiplyScalar(12).add(new THREE.Vector3(0,4.4,0)),fuse:2.15,bounces:0})
}
function explode(g){
  const p=g.mesh.position.clone();sceneRef.remove(g.mesh);g.mesh.geometry.dispose();g.mesh.material.dispose();audioBoom(1);const cp=cameraRef?.position||p;blastShake=Math.max(blastShake,THREE.MathUtils.clamp(1-p.distanceTo(cp)/15,0,1));
  const light=new THREE.PointLight(0xff9c45,18,13,2);light.position.copy(p).add(new THREE.Vector3(0,.5,0));sceneRef.add(light);setTimeout(()=>sceneRef?.remove(light),75);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.16,.3,28),new THREE.MeshBasicMaterial({color:0xffb15b,transparent:true,opacity:.75,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));ring.position.copy(p).add(new THREE.Vector3(0,.045,0));ring.rotation.x=-Math.PI/2;addFx(ring,new THREE.Vector3(),.38,0,12,true);
  for(let i=0;i<12;i++){const smoke=new THREE.Mesh(new THREE.SphereGeometry(.16+Math.random()*.22,7,5),new THREE.MeshBasicMaterial({color:0x4f504c,transparent:true,opacity:.24,depthWrite:false}));smoke.position.copy(p).add(new THREE.Vector3((Math.random()-.5)*.5,.1+Math.random()*.45,(Math.random()-.5)*.5));addFx(smoke,new THREE.Vector3((Math.random()-.5)*1.5,.65+Math.random()*1.5,(Math.random()-.5)*1.5),1.2+Math.random()*.8,-.2,.5,true)}
  for(const s of soldiers){if(!s?.pos)continue;const sp=new THREE.Vector3(s.pos.x,1,s.pos.z),d=sp.distanceTo(p);if(d>9)returnForNothing();if(d>9)continue;const dir=sp.sub(p).normalize(),force=(1-d/9);if(s.alive)s.takeHit?.(24+force*78,dir,"torso","player");if(s.ragdoll)s.ragdoll.impulse?.(dir,5+force*10,"torso")}
}
// Kept as a tiny named no-op so minifiers/debuggers preserve the branch above while tuning blast range.
function returnForNothing(){}

function updateGrenades(dt){for(let i=grenades.length-1;i>=0;i--){const g=grenades[i];g.fuse-=dt;g.vel.y-=9.81*dt;g.mesh.position.addScaledVector(g.vel,dt);if(g.mesh.position.y<.09){g.mesh.position.y=.09;if(Math.abs(g.vel.y)>.7){g.vel.y=Math.abs(g.vel.y)*.43;g.vel.x*=.72;g.vel.z*=.72;g.bounces++}else g.vel.y=0}for(const axis of ["x","z"]){if(Math.abs(g.mesh.position[axis])>34.2){g.mesh.position[axis]=Math.sign(g.mesh.position[axis])*34.2;g.vel[axis]*=-.48}}g.mesh.rotation.x+=dt*9;g.mesh.rotation.z+=dt*6;if(g.fuse<=0){grenades.splice(i,1);explode(g)}}}
function updateFx(dt){for(let i=fx.length-1;i>=0;i--){const e=fx[i];e.life-=dt;e.velocity.y-=e.g*dt;e.mesh.position.addScaledVector(e.velocity,dt);if(e.grow)e.mesh.scale.addScalar(e.grow*dt);if(e.fade&&e.mesh.material)e.mesh.material.opacity=Math.max(0,e.mesh.material.opacity*(e.life/e.max));if(e.life<=0){sceneRef?.remove(e.mesh);e.mesh.geometry?.dispose?.();e.mesh.material?.dispose?.();fx.splice(i,1)}}}

function onPlayerShot(){
  if(!cameraRef||!document.pointerLockElement)return;cameraRef.getWorldPosition(rayOrigin);cameraRef.getWorldDirection(rayDir);
  // Corpses/downed bodies remain interactive and receive the shot impulse at the body part hit.
  const bodies=[...ragdollMeshes].filter(m=>m.parent);raycaster.set(rayOrigin,rayDir);raycaster.far=70;const hit=raycaster.intersectObjects(bodies,false)[0];if(hit?.object?.userData?.ragdoll){const rag=hit.object.userData.ragdoll,part=hit.object.userData.bodyPart||"torso";rag.impulse?.(rayDir,2.6,part);bloodBurst(hit.point,rayDir,5)}
  // Near misses suppress hostiles and occasionally make them dive/lose balance.
  const now=performance.now();for(const s of soldiers){if(!s?.alive||s.team!=="red"||s.ragdoll)continue;tmp.set(s.pos.x,1.2,s.pos.z).sub(rayOrigin);const dist=tmp.length();if(dist<1||dist>34)continue;tmp.multiplyScalar(1/dist);const dot=rayDir.dot(tmp);if(dot<.992)continue;const miss=dist*Math.sqrt(Math.max(0,1-dot*dot));if(miss>1.35)continue;s.suppressedUntil=Math.max(s.suppressedUntil||0,now+850+Math.random()*900);if(miss<.5&&now-(s.lastDive||0)>4200&&Math.random()<.16){s.lastDive=now;s.fall?.(rayDir,true)}}
}

document.addEventListener("keydown",e=>{if(e.code==="KeyG"&&!e.repeat){e.preventDefault();throwGrenade()}},{capture:true});
document.addEventListener("pointerdown",e=>{if(e.button===0)onPlayerShot()},{capture:true});

const grenadeHud=document.createElement("div");grenadeHud.id="grenadeHud";grenadeHud.style.cssText="position:fixed;right:22px;bottom:78px;z-index:9;color:rgba(238,238,228,.72);font:700 10px ui-monospace,monospace;letter-spacing:.12em;pointer-events:none;text-shadow:0 1px 4px #000";document.body.appendChild(grenadeHud);
function updateGrenadeHud(){grenadeHud.textContent=`G  FRAG × ${grenadesLeft}`}
updateGrenadeHud();for(const id of ["deployBtn","restartBtn"]){document.getElementById(id)?.addEventListener("click",()=>{grenadesLeft=3;updateGrenadeHud()})}

function frame(now){const dt=Math.min(.04,(now-lastFrame)/1000||.016);lastFrame=now;updateGrenades(dt);updateFx(dt);for(const m of [...ragdollMeshes])if(!m.parent)ragdollMeshes.delete(m);for(const s of [...soldiers])if(!s?.group?.parent&&!s?.ragdoll)soldiers.delete(s);if(blastShake>0&&cameraRef){blastShake=Math.max(0,blastShake-dt*2.4);const amount=blastShake*blastShake*4;const canvas=document.getElementById("game");if(canvas)canvas.style.transform=`scale(1.012) translate(${(Math.random()-.5)*amount}px,${(Math.random()-.5)*amount}px)`}else{const canvas=document.getElementById("game");if(canvas&&canvas.style.transform)canvas.style.transform=""}requestAnimationFrame(frame)}requestAnimationFrame(frame);

window.__GHOSTCAM_COMBAT_PLUS__={soldiers,ragdollMeshes};
