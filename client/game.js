import * as THREE from "three";
import {PointerLockControls} from "three/addons/controls/PointerLockControls.js";
import RAPIER from "@dimforge/rapier3d-compat";
import {BodycamAudio} from "./audio.js";
import {CombatRagdoll} from "./ragdoll.js";
import {buildArena,moveCircle,lineBlocked,SPAWNS} from "./world.js";

const $=q=>document.querySelector(q);
const boot=$("#boot"),pause=$("#pause"),settingsPanel=$("#settings"),hud=$("#hud"),bootStatus=$("#bootStatus");
const hpEl=$("#hp"),ammoEl=$("#ammo"),reserveEl=$("#reserve"),teamsEl=$("#teams"),objectiveEl=$("#objective"),feed=$("#feed"),hitmarker=$("#hitmarker"),damageEl=$("#damage"),deathCard=$("#deathCard"),statusText=$("#statusText");
const canvas=$("#game");

const DEFAULTS={sensitivity:.72,fov:92,renderScale:.9,volume:.72,shake:.8,aiCount:12,blood:true,highQuality:true};
let settings={...DEFAULTS};try{settings={...settings,...JSON.parse(localStorage.getItem("ghostcam.settings")||"{}")}}catch{}
let settingsFrom="boot";

bootStatus.textContent="Loading Rapier physics…";
await RAPIER.init();
bootStatus.textContent="Physics online. Ready for live fire.";

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;renderer.shadowMap.enabled=!!settings.highQuality;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(settings.fov,1,.045,130);scene.add(camera);
camera.rotation.order="YXZ";
const controls=new PointerLockControls(camera,document.body),audio=new BodycamAudio();
controls.minPolarAngle=.07;controls.maxPolarAngle=Math.PI-.07;
const lookEuler=new THREE.Euler(0,0,0,"YXZ");
function stabiliseLook(){
  const q=camera.quaternion;
  if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||!Number.isFinite(q.z)||!Number.isFinite(q.w)||q.lengthSq()<.0001){q.identity();return}
  q.normalize();lookEuler.setFromQuaternion(q,"YXZ");
  lookEuler.x=THREE.MathUtils.clamp(lookEuler.x,-Math.PI/2+.07,Math.PI/2-.07);lookEuler.z=0;
  q.setFromEuler(lookEuler).normalize()
}
controls.addEventListener("change",stabiliseLook);
const physics=new RAPIER.World({x:0,y:-9.81,z:0});physics.timestep=1/60;
let arena=buildArena(scene,physics,RAPIER,{highQuality:settings.highQuality});

const player={pos:new THREE.Vector3(-28,1.66,-26),velocity:new THREE.Vector2(),hp:100,maxHp:100,ammo:30,reserve:120,alive:true,stamina:100,team:"blue",recoil:0,walk:0,travel:0};
camera.position.copy(player.pos);
const keys=new Set();let running=false,aiming=false,flashlightOn=false,last=performance.now(),physicsAcc=0,lastShot=0,mouseSwayX=0,mouseSwayY=0,screenKick=0,bodycamLean=0,roundWon=false;
const soldiers=[],hitMeshes=[],effects=[],raycaster=new THREE.Raycaster(),rayOrigin=new THREE.Vector3(),rayDir=new THREE.Vector3(),tmpA=new THREE.Vector3(),tmpB=new THREE.Vector3();

// Tactical light.
const flashlight=new THREE.SpotLight(0xfff2d2,7.2,27,.26,.64,1.55);flashlight.position.set(.06,-.05,.02);flashlight.target.position.set(0,-.04,-9);flashlight.visible=false;camera.add(flashlight,flashlight.target);
const lightFill=new THREE.PointLight(0xffe7c2,.3,3,2);lightFill.position.set(.05,-.08,-.18);lightFill.visible=false;camera.add(lightFill);

// First-person rifle/viewmodel: intentionally procedural so the prototype has no proprietary weapon assets.
const viewmodel=new THREE.Group();camera.add(viewmodel);viewmodel.position.set(.30,-.29,-.58);
const rifle=new THREE.Group();viewmodel.add(rifle);
const gunMat=new THREE.MeshStandardMaterial({color:0x181b1a,roughness:.34,metalness:.72}),polyMat=new THREE.MeshStandardMaterial({color:0x252a27,roughness:.86,metalness:.1}),glassMat=new THREE.MeshStandardMaterial({color:0x25373a,roughness:.18,metalness:.6,emissive:0x122326,emissiveIntensity:.45});
function vmBox(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);rifle.add(m);return m}
vmBox(.13,.13,.63,gunMat,0,.02,-.10);vmBox(.17,.18,.30,polyMat,0,-.08,.16);const grip=vmBox(.115,.27,.13,polyMat,0,-.24,.13);grip.rotation.x=-.19;vmBox(.16,.13,.36,polyMat,0,.02,-.48);vmBox(.06,.06,.46,gunMat,0,.03,-.82);
const muzzle=new THREE.Mesh(new THREE.CylinderGeometry(.035,.042,.13,10),gunMat);muzzle.rotation.x=Math.PI/2;muzzle.position.set(0,.03,-1.09);rifle.add(muzzle);
const optic=vmBox(.11,.105,.18,gunMat,0,.145,-.10);vmBox(.085,.07,.025,glassMat,0,.15,-.205);const stock=vmBox(.15,.17,.36,polyMat,0,-.01,.47);stock.rotation.x=.04;
const handMat=new THREE.MeshStandardMaterial({color:0x5c4e43,roughness:.96}),sleeveMat=new THREE.MeshStandardMaterial({color:0x35403a,roughness:.96});
for(const [x,y,z,r] of [[.11,-.25,-.4,-.7],[-.08,-.31,.13,-.3]]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.055,.28,4,8),sleeveMat);arm.position.set(x,y,z);arm.rotation.x=1.15;arm.rotation.z=r;rifle.add(arm);const hand=new THREE.Mesh(new THREE.SphereGeometry(.065,8,6),handMat);hand.position.set(x*.45,y+.09,z-.12);rifle.add(hand)}
const muzzleFlash=new THREE.PointLight(0xffb35a,0,4.2,2);muzzleFlash.position.set(0,.03,-1.16);rifle.add(muzzleFlash);

function materialForTeam(team){return{cloth:new THREE.MeshStandardMaterial({color:team==="blue"?0x3d5559:0x58433d,roughness:.93}),vest:new THREE.MeshStandardMaterial({color:team==="blue"?0x253233:0x342a27,roughness:.86}),skin:new THREE.MeshStandardMaterial({color:0x9b735e,roughness:.96}),dark:new THREE.MeshStandardMaterial({color:0x171918,roughness:.9}),gun:new THREE.MeshStandardMaterial({color:0x202321,roughness:.42,metalness:.55})}}

class Soldier{
  constructor(team,index,pos){
    this.team=team;this.index=index;this.hp=100;this.alive=true;this.state="active";this.ragdoll=null;this.recoverAt=0;this.stagger=0;this.nextShot=performance.now()+500+Math.random()*1500;this.nextDecision=0;this.target=null;this.strafe=Math.random()<.5?-1:1;this.pos=new THREE.Vector3(pos[0]+(Math.random()-.5)*1.3,0,pos[1]+(Math.random()-.5)*1.3);this.velocity=new THREE.Vector2();this.group=this.build();this.group.position.copy(this.pos);scene.add(this.group)
  }
  build(){
    const m=materialForTeam(this.team),g=new THREE.Group();g.userData.soldier=this;const add=(geo,mat,x,y,z,part)=>{const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.castShadow=!!settings.highQuality;mesh.receiveShadow=!!settings.highQuality;mesh.userData.soldier=this;mesh.userData.bodyPart=part;g.add(mesh);hitMeshes.push(mesh);return mesh};
    this.torso=add(new THREE.BoxGeometry(.44,.62,.27),m.cloth,0,1.16,0,"torso");this.vest=add(new THREE.BoxGeometry(.50,.48,.31),m.vest,0,1.20,-.01,"torso");this.head=add(new THREE.SphereGeometry(.16,12,9),m.skin,0,1.68,-.01,"head");
    const helmet=add(new THREE.SphereGeometry(.175,12,7,0,Math.PI*2,0,Math.PI*.58),m.dark,0,1.75,-.005,"head");helmet.scale.y=.72;
    this.arms=[];this.legs=[];for(const side of [-1,1]){const arm=add(new THREE.CapsuleGeometry(.065,.38,4,7),m.cloth,side*.31,1.17,0,side<0?"armL":"armR");this.arms.push(arm);const leg=add(new THREE.CapsuleGeometry(.078,.50,4,7),m.cloth,side*.13,.48,0,side<0?"legL":"legR");this.legs.push(leg);const boot=add(new THREE.BoxGeometry(.17,.13,.30),m.dark,side*.13,.12,-.07,side<0?"legL":"legR");boot.rotation.x=-.04}
    const gun=add(new THREE.BoxGeometry(.10,.10,.70),m.gun,.12,1.20,-.38,"weapon");gun.rotation.x=-.05;this.rifle=gun;return g
  }
  clearHitMeshes(){this.group.traverse(o=>{if(!o.isMesh)return;const i=hitMeshes.indexOf(o);if(i>=0)hitMeshes.splice(i,1)})}
  closestEnemy(){
    let best=null,bd=1e9;if(this.team==="red"&&player.alive){const d=this.pos.distanceTo(player.pos);best={player:true,pos:player.pos,team:"blue"};bd=d}
    for(const s of soldiers){if(s===this||!s.alive||s.team===this.team||s.state==="dead")continue;const d=this.pos.distanceTo(s.pos);if(d<bd){bd=d;best=s}}
    return best
  }
  takeHit(damage,dir,part="torso",source="unknown"){
    if(!this.alive)return;const mult=part==="head"?1.75:(part.startsWith("leg")||part.startsWith("arm"))?.68:1;const dealt=Math.round(damage*mult);this.hp-=dealt;spawnBlood(this.pos.clone().add(new THREE.Vector3(0,part==="head"?1.65:1.05,0)),dir,dealt);audio.bodyHit(panFor(this.pos));
    if(this.hp<=0||part==="head"&&dealt>=65){this.die(dir,part,source);return dealt}
    this.stagger=Math.min(1.3,this.stagger+.45+dealt/100);if(dealt>=24&&Math.random()<.62)this.fall(dir,true);return dealt
  }
  fall(dir,recoverable){
    if(this.ragdoll||!this.alive)return;this.state=recoverable?"down":"dead";this.clearHitMeshes();this.group.visible=false;this.ragdoll=new CombatRagdoll(scene,physics,RAPIER,{x:this.pos.x,y:0,z:this.pos.z,team:this.team,yaw:this.group.rotation.y,recoverable});this.ragdoll.impulse(dir,4.2+Math.random()*2.2,Math.random()<.2?"head":"torso");if(recoverable)this.recoverAt=performance.now()+1050+Math.random()*950
  }
  die(dir,part,source){
    if(!this.alive)return;this.alive=false;this.state="dead";this.hp=0;if(!this.ragdoll){this.fall(dir,false)}else{this.ragdoll.recoverable=false;this.ragdoll.dead=true;this.ragdoll.impulse(dir,3.8,part==="head"?"head":"torso")}
    addFeed(`${this.team==="red"?"HOSTILE":"FRIENDLY"} DOWN // ${source==="player"?"BODYCAM-07":"AI"}`,true);updateScore()
  }
  recover(){
    if(!this.ragdoll||!this.alive)return;const p=this.ragdoll.getPosition();this.pos.set(THREE.MathUtils.clamp(p.x,-33,33),0,THREE.MathUtils.clamp(p.z,-33,33));this.ragdoll.destroy();this.ragdoll=null;this.group.position.copy(this.pos);this.group.visible=true;this.state="active";this.stagger=.55;this.nextShot=performance.now()+650
  }
  update(dt,now){
    if(this.ragdoll){this.ragdoll.update(dt);const p=this.ragdoll.getPosition();this.pos.set(p.x,0,p.z);if(this.alive&&now>=this.recoverAt&&this.ragdoll.age>.9)this.recover();return}
    if(!this.alive)return;
    if(now>this.nextDecision){this.nextDecision=now+220+Math.random()*220;this.target=this.closestEnemy();if(Math.random()<.16)this.strafe*=-1}
    const target=this.target;if(!target)return;const tp=target.player?player.pos:target.pos,dx=tp.x-this.pos.x,dz=tp.z-this.pos.z,dist=Math.hypot(dx,dz);if(dist<.01)return;const nx=dx/dist,nz=dz/dist,blocked=lineBlocked(this.pos,tp,arena.obstacles);
    let mx=0,mz=0;if(blocked){mx=-nz*this.strafe;mz=nx*this.strafe}else if(dist>12){mx=nx;mz=nz}else if(dist<6){mx=-nx*.65;mz=-nz*.65}else{mx=-nz*this.strafe*.48;mz=nx*this.strafe*.48}
    const moveSpeed=blocked?2.5:dist>12?3.15:1.35,desired={x:this.pos.x+mx*moveSpeed*dt,z:this.pos.z+mz*moveSpeed*dt},resolved=moveCircle(this.pos,desired,arena.obstacles,.31);const vx=(resolved.x-this.pos.x)/Math.max(dt,.001),vz=(resolved.z-this.pos.z)/Math.max(dt,.001);this.pos.x=resolved.x;this.pos.z=resolved.z;this.group.position.x=this.pos.x;this.group.position.z=this.pos.z;
    const wantYaw=Math.atan2(dx,dz);let dy=((wantYaw-this.group.rotation.y+Math.PI)%(Math.PI*2))-Math.PI;this.group.rotation.y+=dy*Math.min(1,dt*8.5);this.stagger=Math.max(0,this.stagger-dt*2.0);this.group.rotation.z=Math.sin(now*.021)*this.stagger*.12;
    const speed=Math.hypot(vx,vz),phase=now*.009+this.index;for(let i=0;i<2;i++){this.legs[i].rotation.x=Math.sin(phase+(i?Math.PI:0))*Math.min(.55,speed*.12);this.arms[i].rotation.x=-this.legs[i].rotation.x*.45}
    if(!blocked&&dist<31&&now>=this.nextShot){this.nextShot=now+260+Math.random()*680;aiShoot(this,target,dist)}
  }
  dispose(){this.clearHitMeshes();if(this.ragdoll)this.ragdoll.destroy();scene.remove(this.group);this.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(o.material?.dispose)o.material.dispose()}})}
}

function panFor(pos){const dx=pos.x-player.pos.x,dz=pos.z-player.pos.z;camera.getWorldDirection(tmpA);const rightX=tmpA.z,rightZ=-tmpA.x;return THREE.MathUtils.clamp((dx*rightX+dz*rightZ)/18,-1,1)}
function effectMesh(mesh,vel,life,gravity=0){scene.add(mesh);effects.push({mesh,vel,life,gravity})}
function updateEffects(dt){for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;e.vel.y-=e.gravity*dt;e.mesh.position.addScaledVector(e.vel,dt);if(e.life<=0){scene.remove(e.mesh);e.mesh.geometry.dispose();if(e.mesh.material?.dispose)e.mesh.material.dispose();effects.splice(i,1)}}}
function spawnBlood(point,dir,amount=20){if(!settings.blood)return;const count=Math.min(12,4+Math.floor(amount/9));for(let i=0;i<count;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.012+Math.random()*.022,4,3),new THREE.MeshBasicMaterial({color:Math.random()<.3?0x7d1713:0x54100e}));m.position.copy(point);const v=new THREE.Vector3(dir.x*(.4+Math.random()*1.6)+(Math.random()-.5)*1.3,.25+Math.random()*1.5,dir.z*(.4+Math.random()*1.6)+(Math.random()-.5)*1.3);effectMesh(m,v,.55+Math.random()*.7,3.8)}}
function spawnShell(){const m=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.055,6),new THREE.MeshStandardMaterial({color:0xb59a4b,metalness:.75,roughness:.35}));camera.localToWorld(m.position.set(.18,-.13,-.42));const dir=new THREE.Vector3(.8,.45,.2).applyQuaternion(camera.quaternion).multiplyScalar(1.3+Math.random());effectMesh(m,dir,.9,3.2)}
function tracer(a,b,color=0xffd889){const geo=new THREE.BufferGeometry().setFromPoints([a,b]),mat=new THREE.LineBasicMaterial({color,transparent:true,opacity:.62});const l=new THREE.Line(geo,mat);scene.add(l);setTimeout(()=>{scene.remove(l);geo.dispose();mat.dispose()},48)}
function worldImpact(hit){const normal=hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld)||new THREE.Vector3(0,1,0),p=hit.point.clone().addScaledVector(normal,.008);const mark=new THREE.Mesh(new THREE.CircleGeometry(.035+Math.random()*.035,8),new THREE.MeshBasicMaterial({color:0x171716,transparent:true,opacity:.7,depthWrite:false}));mark.position.copy(p);mark.lookAt(p.clone().add(normal));scene.add(mark);setTimeout(()=>{scene.remove(mark);mark.geometry.dispose();mark.material.dispose()},20000);for(let i=0;i<4;i++){const dust=new THREE.Mesh(new THREE.SphereGeometry(.008+Math.random()*.012,4,3),new THREE.MeshBasicMaterial({color:0xa49e8b}));dust.position.copy(p);effectMesh(dust,normal.clone().multiplyScalar(.2+Math.random()*.5).add(new THREE.Vector3((Math.random()-.5)*.4,Math.random()*.35,(Math.random()-.5)*.4)),.3+Math.random()*.35,1.4)}audio.impact(panFor(p),hit.object.material?.metalness>.25)}
function hitPulse(){hitmarker.classList.add("on");setTimeout(()=>hitmarker.classList.remove("on"),95)}
function damagePulse(){damageEl.classList.add("on");setTimeout(()=>damageEl.classList.remove("on"),145)}
function addFeed(text,kill=false){const d=document.createElement("div");d.className=`feed-item${kill?" kill":""}`;d.textContent=text;feed.prepend(d);setTimeout(()=>d.remove(),4800)}

function aiShoot(shooter,target,dist){
  const origin=shooter.pos.clone().add(new THREE.Vector3(0,1.32,0)),targetPos=(target.player?player.pos:target.pos).clone().add(new THREE.Vector3(0,target.player?1.45:1.15,0)),dir=targetPos.clone().sub(origin).normalize();const spread=.025+dist*.0018;dir.x+=(Math.random()-.5)*spread;dir.y+=(Math.random()-.5)*spread;dir.z+=(Math.random()-.5)*spread;dir.normalize();const end=origin.clone().addScaledVector(dir,Math.min(34,dist+2));tracer(origin,end,shooter.team==="red"?0xffb76a:0xffe0a2);audio.gun(false,panFor(shooter.pos),.72);
  const chance=THREE.MathUtils.clamp(.79-dist*.016, .22,.72);
  if(Math.random()>chance)return;
  if(target.player){damagePlayer(7+Math.floor(Math.random()*11),dir,shooter)}else if(target.alive){target.takeHit(14+Math.random()*13,dir,"torso","AI")}
}
function damagePlayer(amount,dir,shooter){if(!player.alive)return;player.hp=Math.max(0,player.hp-amount);hpEl.textContent=Math.ceil(player.hp);screenKick=Math.min(.16,screenKick+.055);damagePulse();audio.playerHit();statusText.textContent=player.hp<35?"CRITICAL":player.hp<65?"WOUNDED":"COMBAT EFFECTIVE";if(player.hp<=0)killPlayer(dir,shooter)}
function killPlayer(dir,shooter){player.alive=false;keys.clear();aiming=false;bodycamLean=0;document.body.classList.remove("aiming","sprinting");controls.unlock();deathCard.hidden=false;statusText.textContent="NO SIGNAL";addFeed("BODYCAM-07 DOWN",true);updateScore()}

function localShoot(){
  if(!running||!player.alive||!controls.isLocked)return;const now=performance.now();if(now-lastShot<92)return;lastShot=now;if(player.ammo<=0){audio.dry();return}player.ammo--;ammoEl.textContent=player.ammo;audio.gun(true);spawnShell();player.recoil=Math.min(.24,player.recoil+(aiming?.055:.085));screenKick=Math.min(.12,screenKick+.026);muzzleFlash.intensity=12;setTimeout(()=>muzzleFlash.intensity=0,32);
  camera.getWorldPosition(rayOrigin);camera.getWorldDirection(rayDir);rayDir.x+=(Math.random()-.5)*(aiming?.0025:.009);rayDir.y+=(Math.random()-.5)*(aiming?.0025:.009);rayDir.z+=(Math.random()-.5)*(aiming?.0025:.009);rayDir.normalize();raycaster.set(rayOrigin,rayDir);raycaster.far=70;
  const intersections=raycaster.intersectObjects([...hitMeshes,...arena.shootableMeshes],false);let end=rayOrigin.clone().addScaledVector(rayDir,70);if(intersections.length){const hit=intersections[0];end.copy(hit.point);const soldier=hit.object.userData.soldier;if(soldier?.alive){const dealt=soldier.takeHit(31,rayDir,hit.object.userData.bodyPart||"torso","player");hitPulse();addFeed(`HIT ${dealt} // ${hit.object.userData.bodyPart?.toUpperCase()||"BODY"}`)}else worldImpact(hit)}tracer(rayOrigin.clone(),end)
}
function reload(){if(!player.alive||player.ammo>=30||player.reserve<=0)return;const take=Math.min(30-player.ammo,player.reserve);player.ammo+=take;player.reserve-=take;ammoEl.textContent=player.ammo;reserveEl.textContent=player.reserve;audio.reload()}

function updateMovement(dt,now){
  if(!running||!player.alive||!controls.isLocked){player.velocity.x=THREE.MathUtils.lerp(player.velocity.x,0,1-Math.exp(-dt*12));player.velocity.y=THREE.MathUtils.lerp(player.velocity.y,0,1-Math.exp(-dt*12));bodycamLean=THREE.MathUtils.lerp(bodycamLean,0,1-Math.exp(-dt*10));return}
  stabiliseLook();
  const forward=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0),side=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0),crouch=keys.has("ControlLeft")||keys.has("ControlRight"),sprint=(keys.has("ShiftLeft")||keys.has("ShiftRight"))&&forward>0&&!crouch&&!aiming;
  document.body.classList.toggle("sprinting",sprint);const speed=crouch?2.15:sprint?6.7:aiming?2.65:4.25;camera.getWorldDirection(tmpA);tmpA.y=0;tmpA.normalize();tmpB.set(tmpA.z,0,-tmpA.x);const wish=tmpA.multiplyScalar(forward).addScaledVector(tmpB,side);if(wish.lengthSq()>1)wish.normalize();const response=forward||side?12:18,targetX=wish.x*speed,targetZ=wish.z*speed;player.velocity.x=THREE.MathUtils.lerp(player.velocity.x,targetX,1-Math.exp(-dt*response));player.velocity.y=THREE.MathUtils.lerp(player.velocity.y,targetZ,1-Math.exp(-dt*response));const desired={x:player.pos.x+player.velocity.x*dt,z:player.pos.z+player.velocity.y*dt},r=moveCircle(player.pos,desired,arena.obstacles,.31),moved=Math.hypot(r.x-player.pos.x,r.z-player.pos.z);player.pos.x=r.x;player.pos.z=r.z;
  if(moved>.0001){player.walk+=moved*(sprint?3.2:crouch?2.1:2.65);player.travel+=moved;const stride=sprint?.82:crouch?1.05:.94;if(player.travel>=stride){player.travel%=stride;audio.step(sprint,crouch)}}
  const motion=Math.min(1,moved/Math.max(dt,.001)/4),bob=Math.sin(player.walk*2)*.020*motion*(sprint?1.45:1);const targetY=crouch?1.23:1.66;player.pos.y=THREE.MathUtils.lerp(player.pos.y,targetY+bob,1-Math.exp(-dt*15));camera.position.copy(player.pos);
  // Bodycam lean is presentation only. Never write camera.rotation.z: PointerLockControls owns the look quaternion.
  const shake=THREE.MathUtils.clamp(Number(settings.shake)||0,0,1.4),adsFactor=aiming?.08:1,leanTarget=(-(side*.006+Math.sin(player.walk)*.0035*motion)-screenKick*.018)*shake*adsFactor;
  bodycamLean=THREE.MathUtils.lerp(bodycamLean,THREE.MathUtils.clamp(leanTarget,-.018,.018),1-Math.exp(-dt*(aiming?15:9)));
  screenKick=THREE.MathUtils.lerp(screenKick,0,1-Math.exp(-dt*9));const targetFov=Number(settings.fov)+(sprint?4:0)-(aiming?13:0);camera.fov=THREE.MathUtils.lerp(camera.fov,targetFov,1-Math.exp(-dt*9));camera.updateProjectionMatrix()
}
function updateWeapon(dt){
  player.recoil=THREE.MathUtils.lerp(player.recoil,0,1-Math.exp(-dt*15));mouseSwayX=THREE.MathUtils.lerp(mouseSwayX,0,1-Math.exp(-dt*10));mouseSwayY=THREE.MathUtils.lerp(mouseSwayY,0,1-Math.exp(-dt*10));const sprint=document.body.classList.contains("sprinting"),aim=aiming;
  const tx=aim?.005:.30-mouseSwayX,ty=aim?-.16:(sprint?-.43:-.29)-mouseSwayY,tz=aim?-.43:(sprint?-.42:-.58)+player.recoil*.34;viewmodel.position.x=THREE.MathUtils.lerp(viewmodel.position.x,tx,1-Math.exp(-dt*15));viewmodel.position.y=THREE.MathUtils.lerp(viewmodel.position.y,ty,1-Math.exp(-dt*15));viewmodel.position.z=THREE.MathUtils.lerp(viewmodel.position.z,tz,1-Math.exp(-dt*15));viewmodel.rotation.x=THREE.MathUtils.lerp(viewmodel.rotation.x,-player.recoil*.82+(sprint?.42:0),1-Math.exp(-dt*14));viewmodel.rotation.y=THREE.MathUtils.lerp(viewmodel.rotation.y,-mouseSwayX*.7,1-Math.exp(-dt*12));
  const presentationRoll=(sprint?-.18:0)+bodycamLean;viewmodel.rotation.z=THREE.MathUtils.lerp(viewmodel.rotation.z,aim?bodycamLean*.18:presentationRoll,1-Math.exp(-dt*(aim?16:10)))
}

function spawnSquads(){
  for(const s of soldiers)s.dispose();soldiers.length=0;hitMeshes.length=0;const total=Math.round(settings.aiCount/2)*2,half=total/2;
  for(let i=0;i<half;i++)soldiers.push(new Soldier("blue",i,SPAWNS.blue[i%SPAWNS.blue.length]));for(let i=0;i<half;i++)soldiers.push(new Soldier("red",i+half,SPAWNS.red[i%SPAWNS.red.length]));roundWon=false;objectiveEl.textContent="ELIMINATE HOSTILE FORCE";updateScore()
}
function resetPlayer(){player.pos.set(-28,1.66,-26);player.velocity.set(0,0);player.hp=100;player.ammo=30;player.reserve=120;player.alive=true;player.recoil=0;screenKick=0;bodycamLean=0;camera.position.copy(player.pos);stabiliseLook();hpEl.textContent="100";ammoEl.textContent="30";reserveEl.textContent="120";deathCard.hidden=true;statusText.textContent="COMBAT EFFECTIVE"}
function restartSkirmish(){resetPlayer();spawnSquads();pause.hidden=true;hud.hidden=false;running=true;controls.lock();audio.ensure();addFeed("NEW CONTACTS // LIVE FIRE RESET")}
function updateScore(){const blue=soldiers.filter(s=>s.team==="blue"&&s.alive).length+(player.alive?1:0),red=soldiers.filter(s=>s.team==="red"&&s.alive).length;teamsEl.textContent=`BLUE ${blue} · RED ${red}`;if(red===0&&!roundWon){roundWon=true;objectiveEl.textContent="AREA SECURE";addFeed("ALL HOSTILES NEUTRALIZED",true)}else if(blue===0&&!roundWon){roundWon=true;objectiveEl.textContent="FRIENDLY FORCE LOST"}}

function applySettings(){
  controls.pointerSpeed=Number(settings.sensitivity);audio.setVolume(Number(settings.volume));renderer.shadowMap.enabled=!!settings.highQuality;arena.sun.castShadow=!!settings.highQuality;resize();
  $("#sens").value=settings.sensitivity;$("#sensValue").textContent=Number(settings.sensitivity).toFixed(2);$("#fov").value=settings.fov;$("#fovValue").textContent=Math.round(settings.fov);$("#scale").value=settings.renderScale;$("#scaleValue").textContent=`${Math.round(settings.renderScale*100)}%`;$("#volume").value=settings.volume;$("#volumeValue").textContent=`${Math.round(settings.volume*100)}%`;$("#shake").value=settings.shake;$("#shakeValue").textContent=Number(settings.shake).toFixed(1);$("#aiCount").value=settings.aiCount;$("#aiValue").textContent=settings.aiCount;$("#bloodSetting").checked=!!settings.blood;$("#qualitySetting").checked=!!settings.highQuality
}
function save(){localStorage.setItem("ghostcam.settings",JSON.stringify(settings));applySettings()}
function resize(){const w=innerWidth,h=innerHeight;renderer.setPixelRatio(Math.min(devicePixelRatio*Number(settings.renderScale||.9),1.7));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener("resize",resize);

function openSettings(from){settingsFrom=from;settingsPanel.hidden=false;if(from==="boot")boot.hidden=true;if(from==="pause")pause.hidden=true}
function closeSettings(){settingsPanel.hidden=true;if(settingsFrom==="boot")boot.hidden=false;else if(settingsFrom==="pause")pause.hidden=false}
$("#bootSettingsBtn").onclick=()=>openSettings("boot");$("#pauseSettingsBtn").onclick=()=>openSettings("pause");$("#closeSettingsBtn").onclick=closeSettings;
for(const [id,key] of [["sens","sensitivity"],["fov","fov"],["scale","renderScale"],["volume","volume"],["shake","shake"],["aiCount","aiCount"]])$("#"+id).addEventListener("input",e=>{settings[key]=Number(e.target.value);save()});$("#bloodSetting").onchange=e=>{settings.blood=e.target.checked;save()};$("#qualitySetting").onchange=e=>{settings.highQuality=e.target.checked;save()};
$("#deployBtn").onclick=()=>{audio.ensure();boot.hidden=true;hud.hidden=false;running=true;resetPlayer();spawnSquads();controls.lock();addFeed("BODYCAM-07 ONLINE // ALPHA DEPLOYED")};
$("#resumeBtn").onclick=()=>{pause.hidden=true;hud.hidden=false;controls.lock()};$("#restartBtn").onclick=restartSkirmish;
controls.addEventListener("lock",()=>{if(running&&player.alive){pause.hidden=true;hud.hidden=false}});controls.addEventListener("unlock",()=>{keys.clear();if(running&&player.alive&&!settingsPanel.hidden){return}if(running&&player.alive){pause.hidden=false;hud.hidden=true}});

const handled=new Set(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","ControlLeft","ControlRight","KeyR","KeyF","Space"]);
window.addEventListener("keydown",e=>{if(controls.isLocked&&handled.has(e.code))e.preventDefault();if(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","ControlLeft","ControlRight"].includes(e.code))keys.add(e.code);if(e.repeat)return;if(e.code==="KeyR")reload();if(e.code==="KeyF"){flashlightOn=!flashlightOn;flashlight.visible=lightFill.visible=flashlightOn;audio.flashlight(flashlightOn)}if(e.code==="Space"&&!player.alive)restartSkirmish()},{passive:false});
window.addEventListener("keyup",e=>keys.delete(e.code));window.addEventListener("blur",()=>keys.clear());
document.addEventListener("pointermove",e=>{if(!controls.isLocked)return;mouseSwayX=THREE.MathUtils.clamp(mouseSwayX+e.movementX*.00035,-.04,.04);mouseSwayY=THREE.MathUtils.clamp(mouseSwayY+e.movementY*.00028,-.032,.032)});
document.addEventListener("mousedown",e=>{if(!controls.isLocked)return;if(e.button===0)localShoot();if(e.button===2){aiming=true;document.body.classList.add("aiming")}});document.addEventListener("mouseup",e=>{if(e.button===2){aiming=false;document.body.classList.remove("aiming")}});document.addEventListener("contextmenu",e=>e.preventDefault());
window.addEventListener("pointerdown",()=>audio.ensure(),{capture:true});window.addEventListener("keydown",()=>audio.ensure(),{capture:true});

applySettings();spawnSquads();
function tick(now){
  requestAnimationFrame(tick);const dt=Math.min(.04,(now-last)/1000||.016);last=now;if(running){updateMovement(dt,now);updateWeapon(dt);for(const s of soldiers)s.update(dt,now);audio.update(now)}
  physicsAcc+=dt;let steps=0;while(physicsAcc>=1/60&&steps<3){physics.step();physicsAcc-=1/60;steps++}arena.update();updateEffects(dt);
  stabiliseLook();
  const t=new Date(),clock=$("#clock");clock.textContent=`${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}:${String(t.getSeconds()).padStart(2,"0")}`;renderer.render(scene,camera)
}
requestAnimationFrame(tick);
