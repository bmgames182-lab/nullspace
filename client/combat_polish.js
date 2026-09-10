import * as THREE from "three";

// Cosmetic combat layer. It never decides whether a shot hit a player; the server remains authoritative.
let sceneRef=null,cameraRef=null;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){
  if(!sceneRef)sceneRef=this;
  for(const o of objects)if(o?.isPerspectiveCamera)cameraRef=o;
  return originalAdd.apply(this,objects)
};

const raycaster=new THREE.Raycaster();
const forward=new THREE.Vector3(),worldNormal=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),right=new THREE.Vector3();
const impactGeom=new THREE.CircleGeometry(.055,12);
const impactMat=new THREE.MeshBasicMaterial({color:0x191713,transparent:true,opacity:.82,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
const dustGeom=new THREE.SphereGeometry(.012,4,3),dustMat=new THREE.MeshBasicMaterial({color:0x8e8354,transparent:true,opacity:.7});
const sparkGeom=new THREE.SphereGeometry(.008,4,3),sparkMat=new THREE.MeshBasicMaterial({color:0xf0bd67,transparent:true,opacity:.9,toneMapped:false});
const shellGeom=new THREE.CylinderGeometry(.011,.011,.032,7),shellMat=new THREE.MeshStandardMaterial({color:0xa47c32,roughness:.38,metalness:.74});
const poolGeom=new THREE.CircleGeometry(.58,24),poolMat=new THREE.MeshBasicMaterial({color:0x2a0505,transparent:true,opacity:.62,depthWrite:false});

const decals=[],particles=[],shells=[],aftermath=new WeakSet(),pools=[];
function cameraDescendant(o){for(let p=o;p;p=p.parent)if(p===cameraRef)return true;return false}
function materialMetalness(o){const mats=Array.isArray(o.material)?o.material:[o.material];let best=0;for(const m of mats)best=Math.max(best,Number(m?.metalness)||0);return best}
function validSurface(hit){const o=hit.object;return !!o?.isMesh&&o.visible&&!cameraDescendant(o)&&!o.userData.nullspaceImpact&&!o.userData.nullspaceDust}

function spawnParticle(pos,vel,metal=false){
  if(!sceneRef)return;
  const m=new THREE.Mesh(metal?sparkGeom:dustGeom,metal?sparkMat:dustMat);m.position.copy(pos);m.userData.nullspaceImpact=true;m.userData.vel=vel;m.userData.life=metal?.22:.38;m.userData.drag=metal?.93:.9;sceneRef.add(m);particles.push(m)
}
function spawnImpact(){
  if(!sceneRef||!cameraRef)return;
  cameraRef.getWorldDirection(forward);raycaster.set(cameraRef.getWorldPosition(new THREE.Vector3()),forward);raycaster.far=42;
  const hit=raycaster.intersectObjects(sceneRef.children,true).find(validSurface);if(!hit?.face)return;
  worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
  const decal=new THREE.Mesh(impactGeom,impactMat);decal.position.copy(hit.point).addScaledVector(worldNormal,.003);decal.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),worldNormal);decal.rotateZ(Math.random()*Math.PI*2);decal.scale.setScalar(.72+Math.random()*.55);decal.userData.nullspaceImpact=true;sceneRef.add(decal);decals.push(decal);
  while(decals.length>56){const old=decals.shift();sceneRef.remove(old)}
  const metal=materialMetalness(hit.object)>.22;
  for(let i=0;i<(metal?7:5);i++){
    const tangent=new THREE.Vector3((Math.random()-.5)*.9,Math.random()*.8,(Math.random()-.5)*.9).addScaledVector(worldNormal,.55+Math.random()*.8);
    spawnParticle(hit.point.clone().addScaledVector(worldNormal,.02),tangent,metal)
  }
}
function ejectShell(){
  if(!sceneRef||!cameraRef)return;
  const ammo=Number(document.querySelector("#ammoCurrent")?.textContent||0);if(ammo<=0)return;
  const shell=new THREE.Mesh(shellGeom,shellMat);shell.rotation.z=Math.PI/2;
  shell.position.copy(cameraRef.localToWorld(new THREE.Vector3(.18,-.12,-.31)));right.set(1,0,0).applyQuaternion(cameraRef.quaternion).normalize();
  shell.userData.nullspaceImpact=true;shell.userData.vel=right.multiplyScalar(.95+Math.random()*.45).addScaledVector(up,.62+Math.random()*.35).add(new THREE.Vector3((Math.random()-.5)*.18,0,(Math.random()-.5)*.18));shell.userData.spin=new THREE.Vector3(8+Math.random()*7,5+Math.random()*8,9+Math.random()*8);shell.userData.life=1.25;sceneRef.add(shell);shells.push(shell);
  while(shells.length>20){const old=shells.shift();sceneRef.remove(old)}
}
function addAftermath(group){
  if(!sceneRef||aftermath.has(group))return;aftermath.add(group);
  const pool=new THREE.Mesh(poolGeom,poolMat);pool.rotation.x=-Math.PI/2;pool.position.set(group.position.x,.012,group.position.z);pool.scale.set(.15,.15,.15);pool.userData.nullspaceImpact=true;pool.userData.targetScale=.78+Math.random()*.7;sceneRef.add(pool);pools.push(pool);
  while(pools.length>12){const old=pools.shift();sceneRef.remove(old)}
  const radio=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.15,.055,.09),new THREE.MeshStandardMaterial({color:0x20231f,roughness:.76,metalness:.25})),antenna=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.16,5),new THREE.MeshBasicMaterial({color:0x111310}));body.rotation.z=(Math.random()-.5)*.5;antenna.position.set(.055,.07,0);radio.add(body,antenna);radio.position.set(group.position.x+.28,.045,group.position.z+.16);radio.rotation.y=Math.random()*Math.PI*2;radio.userData.nullspaceImpact=true;sceneRef.add(radio)
}

window.addEventListener("mousedown",e=>{
  if(e.button!==0||!document.pointerLockElement)return;
  const hud=document.querySelector("#hud");if(hud?.hidden)return;
  const ammo=Number(document.querySelector("#ammoCurrent")?.textContent||0);if(ammo<=0)return;
  setTimeout(()=>{spawnImpact();ejectShell()},0)
},{capture:true});

let last=performance.now();
function loop(now){
  const dt=Math.min(.04,(now-last)/1000||.016);last=now;
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.userData.life-=dt;p.userData.vel.multiplyScalar(Math.pow(p.userData.drag,dt*60));p.userData.vel.y-=2.6*dt;p.position.addScaledVector(p.userData.vel,dt);p.material.opacity=Math.max(0,p.userData.life/.38);if(p.userData.life<=0){sceneRef?.remove(p);particles.splice(i,1)}}
  for(let i=shells.length-1;i>=0;i--){const s=shells[i];s.userData.life-=dt;s.userData.vel.y-=7.2*dt;s.position.addScaledVector(s.userData.vel,dt);s.rotation.x+=s.userData.spin.x*dt;s.rotation.y+=s.userData.spin.y*dt;s.rotation.z+=s.userData.spin.z*dt;if(s.position.y<.035){s.position.y=.035;if(Math.abs(s.userData.vel.y)>.4)s.userData.vel.y*=-.28;else s.userData.vel.y=0;s.userData.vel.x*=.72;s.userData.vel.z*=.72}s.material.opacity=Math.min(1,Math.max(0,s.userData.life/.25));s.material.transparent=s.userData.life<.25;if(s.userData.life<=0){sceneRef?.remove(s);shells.splice(i,1)}}
  if(sceneRef){sceneRef.traverse(o=>{if(o?.isGroup&&o.userData?.target?.isVector3&&o.userData.dead)addAftermath(o)});for(const p of pools){const t=p.userData.targetScale||1;p.scale.x=THREE.MathUtils.lerp(p.scale.x,t,1-Math.exp(-dt*1.7));p.scale.y=p.scale.x}}
  requestAnimationFrame(loop)
}
window.addEventListener("load",()=>setTimeout(()=>requestAnimationFrame(loop),1200));
window.__NULLSPACE_COMBAT_POLISH__=true;
