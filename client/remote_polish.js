import * as THREE from "three";

// Visual-only remote smoothing layered on top of authoritative snapshots.
// It does not modify local movement or send additional state to the server.
let sceneRef=null,cameraRef=null;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){
  if(!sceneRef)sceneRef=this;
  for(const o of objects)if(o?.isPerspectiveCamera)cameraRef=o;
  return originalAdd.apply(this,objects)
};

const state=new WeakMap();
const scratch=new THREE.Vector3(),predicted=new THREE.Vector3();
function wrapAngle(a){while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a}
function remoteGroups(){
  const out=[];if(!sceneRef)return out;
  sceneRef.traverse(o=>{if(o?.isGroup&&o.userData?.target?.isVector3&&o.userData?.visual)out.push(o)});return out
}
function ensureState(g,now){
  let s=state.get(g);if(s)return s;
  s={pos:new THREE.Vector3(g.position.x,g.position.y,g.position.z),lastTarget:g.userData.target.clone(),lastTargetAt:now,velocity:new THREE.Vector3(),yaw:g.rotation.y,lastFrame:now,lastVisiblePos:new THREE.Vector3(g.position.x,g.position.y,g.position.z)};state.set(g,s);return s
}
function setAnim(g,name,fade=.12){
  const v=g.userData.visual,action=v?.actions?.[name]||v?.actions?.idle;if(!action||v.__remoteAction===name)return;
  const old=v.activeAction;action.reset().fadeIn(fade).play();if(old&&old!==action)old.fadeOut(fade);v.activeAction=action;v.__remoteAction=name
}
function updateOne(g,now,dt){
  const s=ensureState(g,now),target=g.userData.target;
  if(!target)return;
  if(target.distanceToSquared(s.lastTarget)>.000001){
    const snapDt=Math.max(.025,Math.min(.3,(now-s.lastTargetAt)/1000));scratch.copy(target).sub(s.lastTarget).multiplyScalar(1/snapDt);if(scratch.length()>8)scratch.setLength(8);s.velocity.lerp(scratch,.55);s.lastTarget.copy(target);s.lastTargetAt=now
  }
  predicted.copy(target).addScaledVector(s.velocity,.055);
  const dist=s.pos.distanceTo(predicted);if(dist>4.5)s.pos.copy(target);else s.pos.lerp(predicted,1-Math.exp(-dt*11.5));
  const visibleSpeed=s.pos.distanceTo(s.lastVisiblePos)/Math.max(dt,.001);s.lastVisiblePos.copy(s.pos);
  g.position.x=s.pos.x;g.position.z=s.pos.z;
  const targetYaw=Number(g.userData.yaw)||0;s.yaw+=wrapAngle(targetYaw-s.yaw)*(1-Math.exp(-dt*10));g.rotation.y=s.yaw;
  const v=g.userData.visual;if(!v)return;
  if(g.userData.dead){setAnim(g,"death",.08);v.tag.material.opacity=THREE.MathUtils.lerp(v.tag.material.opacity,0,.08);return}
  if(g.userData.escaped){g.visible=false;return}
  if(visibleSpeed>4.3)setAnim(g,"run");else if(visibleSpeed>.28)setAnim(g,"walk");else setAnim(g,"idle");
  const distanceToCamera=cameraRef?g.position.distanceTo(cameraRef.position):10;const targetOpacity=THREE.MathUtils.clamp(1-distanceToCamera/24,.12,.68);v.tag.material.opacity=THREE.MathUtils.lerp(v.tag.material.opacity,targetOpacity,.18)
}

let last=performance.now();
function loop(now){
  const dt=Math.min(.05,(now-last)/1000||.016);last=now;
  for(const g of remoteGroups())updateOne(g,now,dt);
  requestAnimationFrame(loop)
}
window.addEventListener("load",()=>setTimeout(()=>requestAnimationFrame(loop),1500));
window.__NULLSPACE_REMOTE_POLISH__=true;
