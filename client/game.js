import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { NetClient } from "./network.js";
import { AudioSystem } from "./audio.js";
import { createWorld, resolveMovement, nearestInteraction } from "./world.js";

const $=(q)=>document.querySelector(q);
const canvas=$("#game"),menu=$("#menu"),hud=$("#hud"),statusEl=$("#status");
const roomLabel=$("#roomLabel"),playerCount=$("#playerCount"),phaseLabel=$("#phaseLabel");
const roleLabel=$("#roleLabel"),objectiveLabel=$("#objectiveLabel"),timerEl=$("#timer");
const hpEl=$("#hp"),staminaEl=$("#stamina"),ammoCurrent=$("#ammoCurrent"),ammoReserve=$("#ammoReserve");
const feed=$("#feed"),interactionEl=$("#interaction"),centerNotice=$("#centerNotice");
const briefing=$("#briefing"),briefRole=$("#briefRole"),briefText=$("#briefText"),briefLoadout=$("#briefLoadout");
const endScreen=$("#endScreen"),endTitle=$("#endTitle"),endText=$("#endText");

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.72;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(76,1,.05,120);camera.position.set(-14,1.66,-14);
const controls=new PointerLockControls(camera,document.body);controls.pointerSpeed=.78;
const audio=new AudioSystem();
const world=createWorld(scene,"SITE-NULL");

const flashlight=new THREE.SpotLight(0xe7f1eb,10,22,Math.PI/8,.48,1.5);flashlight.position.set(.12,-.04,.05);flashlight.target.position.set(.1,-.05,-7);camera.add(flashlight);camera.add(flashlight.target);
const flashlightFill=new THREE.PointLight(0xc8dbd0,.7,3);flashlightFill.position.set(.15,-.1,-.3);camera.add(flashlightFill);flashlight.visible=flashlightFill.visible=true;
scene.add(camera);

const weapon=new THREE.Group();camera.add(weapon);
const gunMat=new THREE.MeshStandardMaterial({color:0x151a18,roughness:.34,metalness:.72});
const gripMat=new THREE.MeshStandardMaterial({color:0x0b0e0d,roughness:.78});
const slide=new THREE.Mesh(new THREE.BoxGeometry(.16,.16,.59),gunMat);slide.position.set(.31,-.26,-.62);weapon.add(slide);
const grip=new THREE.Mesh(new THREE.BoxGeometry(.13,.32,.18),gripMat);grip.position.set(.31,-.39,-.45);grip.rotation.x=-.18;weapon.add(grip);
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.026,.026,.25,12),gunMat);barrel.rotation.x=Math.PI/2;barrel.position.set(.31,-.24,-.96);weapon.add(barrel);
const muzzleLight=new THREE.PointLight(0xffd18a,0,3,2);muzzleLight.position.set(.31,-.24,-1.08);camera.add(muzzleLight);
weapon.visible=false;

const net=new NetClient();
const remotes=new Map();
const keys=new Set();
let self=null,round=null,currentInteraction=null,last=performance.now(),lastSend=0;
let stamina=100,flashlightOn=true,recoil=0,walkPhase=0,connected=false;

const ROLE={
  unassigned:{name:"UNASSIGNED",brief:"Await additional personnel. Roles are assigned when the incident locks.",loadout:"No assignment issued."},
  observer:{name:"OBSERVER",brief:"This incident was already active when you arrived. Observe until the next deployment.",loadout:"Spectator access only."},
  researcher:{name:"RESEARCH PERSONNEL",brief:"Recover the Threshold Keycard, initiate extraction, identify the anomalous host, and survive. Trust is a resource.",loadout:"LOADOUT // flashlight · field radio · no firearm"},
  security:{name:"SECURITY OFFICER",brief:"Protect personnel and neutralize confirmed anomalous hosts. Reckless friendly fire helps the anomaly more than you.",loadout:"LOADOUT // 9mm sidearm · 4 magazines · flashlight"},
  quarantine:{name:"QUARANTINE OFFICER",brief:"Your classified priority is absolute: no anomalous host may cross the Threshold. You retain primary sealing authority.",loadout:"LOADOUT // 9mm sidearm · quarantine authorization · flashlight"},
  anomaly:{name:"MIMIC ANOMALY",brief:"Hide in plain sight. Isolate personnel, wound them, then assimilate weakened hosts. You win by consuming the team or escaping containment.",loadout:"ABILITY // Q at close range · appearance remains human until aggression"}
};

function hasGun(){return !!self?.weapon;}
function updateSelf(s){
  if(!s)return;const oldRole=self?.role;self=s;
  hpEl.textContent=Math.round(self.hp??100);ammoCurrent.textContent=self.ammo??0;ammoReserve.textContent=self.reserve??0;
  weapon.visible=hasGun()&&!self.dead&&!self.escaped;
  roleLabel.textContent=(ROLE[self.role]||ROLE.unassigned).name;
  if(Number.isFinite(self.x)&&Number.isFinite(self.z)&&(!oldRole||oldRole==="unassigned")&&self.role!=="unassigned") camera.position.set(self.x,1.66,self.z);
  if(self.role!==oldRole&&self.role!=="unassigned") showBriefing(self.role);
  if(self.dead)showNotice("VITAL SIGNS LOST // OBSERVATION ONLY",5000);
  if(self.escaped)showNotice("THRESHOLD CROSSED // INCIDENT FEED ACTIVE",5000);
  updateObjective();
}
function updateRound(r){round=r;if(!r)return;phaseLabel.textContent=r.phase.toUpperCase();updateObjective();}

net.onSelf=updateSelf;net.onRound=updateRound;
net.onPlayers=(players)=>{
  playerCount.textContent=`${players.size} OPERATIVE${players.size===1?"":"S"}`;
  for(const [id,p] of players){
    if(id===net.id)continue;
    let avatar=remotes.get(id);if(!avatar){avatar=createAvatar(p);remotes.set(id,avatar);}
    avatar.userData.target.set(p.x??0,0,p.z??0);avatar.userData.yaw=p.yaw??0;avatar.userData.dead=!!p.dead;avatar.userData.escaped=!!p.escaped;
    setRevealed(avatar,!!p.revealed);
  }
  for(const [id,a] of [...remotes])if(!players.has(id)){scene.remove(a);disposeObject(a);remotes.delete(id);}
};
net.onEvent=(msg)=>{
  if(msg.type==="playerState"&&msg.player){net.players.set(msg.player.id,{...(net.players.get(msg.player.id)||{}),...msg.player});net.onPlayers(net.players);return;}
  if(msg.type==="event"){
    addFeed(msg.text||msg.kind,msg.kind==="danger"||msg.kind==="alarm");
    if(msg.kind==="alarm"){audio.alert();showNotice(msg.text,3200);}
    if(msg.kind==="start")audio.ui(true);return;
  }
  if(msg.type==="notice"){addFeed(msg.text,true);showNotice(msg.text,1800);audio.ui(false);return;}
  if(msg.type==="shot"){if(msg.id!==net.id){audio.noise(.08,.12,1500);remoteMuzzle(msg);}return;}
  if(msg.type==="hit"){
    if(msg.target===net.id){audio.hit();damageFlash();addFeed(`TRAUMA // -${msg.damage}`,true);}
    if(msg.attacker===net.id)addFeed(`IMPACT CONFIRMED // ${msg.damage}`);
    burstAtPlayer(msg.target,msg.source==="anomaly"?0x50110f:0x711d18);return;
  }
  if(msg.type==="reveal"){const a=remotes.get(msg.id);if(a){setRevealed(a,true);setTimeout(()=>setRevealed(a,false),3000);}audio.anomaly();return;}
  if(msg.type==="converted"){addFeed(`${msg.name} biometrics became non-human.`,true);showNotice("ASSIMILATION EVENT DETECTED",2200);audio.anomaly();return;}
  if(msg.type==="death"){addFeed(`${msg.name} is no longer transmitting.`,true);return;}
  if(msg.type==="roundEnd"){showEnd(msg.winner,msg.reason);return;}
  if(msg.type==="reload"&&msg.id!==net.id)audio.tone(420,.025,.025,"square");
};
net.onClose=()=>{if(connected){connected=false;statusEl.textContent="Connection lost.";addFeed("NETWORK LINK LOST",true);showNotice("CONNECTION LOST",5000);}};

function createAvatar(p){
  const g=new THREE.Group();g.userData.target=new THREE.Vector3(p.x||0,0,p.z||0);g.userData.yaw=p.yaw||0;
  const uniform=new THREE.MeshStandardMaterial({color:0x56655e,roughness:.78}),dark=new THREE.MeshStandardMaterial({color:0x151b18,roughness:.72}),skin=new THREE.MeshStandardMaterial({color:0xb98e70,roughness:.86});
  const anomaly=new THREE.MeshStandardMaterial({color:0x29100f,emissive:0x4b0a08,emissiveIntensity:.75,roughness:.58});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(.54,.72,.28),uniform);torso.position.y=1.18;torso.castShadow=true;g.add(torso);
  const vest=new THREE.Mesh(new THREE.BoxGeometry(.58,.45,.31),dark);vest.position.set(0,1.25,-.015);vest.castShadow=true;g.add(vest);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.22,14,10),skin);head.position.y=1.72;head.castShadow=true;g.add(head);
  const limbGeo=new THREE.CapsuleGeometry(.085,.45,4,8),arms=[],legs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Mesh(limbGeo,uniform);arm.position.set(side*.37,1.15,0);arm.rotation.z=side*.06;arm.castShadow=true;g.add(arm);arms.push(arm);
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.095,.58,4,8),dark);leg.position.set(side*.16,.48,0);leg.castShadow=true;g.add(leg);legs.push(leg);
  }
  const tag=makeTag(p.name||"UNKNOWN");tag.position.y=2.15;g.add(tag);
  g.userData.visual={uniform,dark,skin,anomaly,torso,vest,head,arms,legs,tag};g.position.set(p.x||0,0,p.z||0);scene.add(g);return g;
}
function makeTag(text){const c=document.createElement("canvas");c.width=512;c.height=96;const ctx=c.getContext("2d");ctx.font="700 36px monospace";ctx.textAlign="center";ctx.fillStyle="#dbe5df";ctx.fillText(text.slice(0,18),256,55);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false,opacity:.78}));s.scale.set(2.3,.43,1);return s;}
function setRevealed(a,on){const v=a.userData.visual;if(!v)return;v.torso.material=on?v.anomaly:v.uniform;v.head.material=on?v.anomaly:v.skin;v.arms.forEach(x=>x.material=on?v.anomaly:v.uniform);v.tag.material.opacity=on?.22:.78;a.userData.revealed=on;}
function disposeObject(o){o.traverse(n=>{if(n.geometry)n.geometry.dispose?.();if(n.material){for(const m of Array.isArray(n.material)?n.material:[n.material]){m.map?.dispose?.();m.dispose?.();}}});}

function updateObjective(){
  if(!self){objectiveLabel.textContent="Awaiting identity verification.";return;}
  if(self.dead){objectiveLabel.textContent="You are deceased. Observe remaining incident traffic.";return;}
  if(self.escaped){objectiveLabel.textContent="You crossed the Threshold. Await incident resolution.";return;}
  if(self.role==="unassigned"){objectiveLabel.textContent=round?.phase==="briefing"?"Incident locking. Stand by for classified assignment.":"Waiting for at least two personnel.";return;}
  if(self.role==="observer"){objectiveLabel.textContent="Incident already active. Observation access only.";return;}
  if(self.role==="anomaly"){objectiveLabel.textContent=round?.phase==="extraction"?"Escape through the Threshold or assimilate remaining humans.":"Remain trusted. Q assimilates a nearby weakened human.";return;}
  if(round?.phase==="active") objectiveLabel.textContent=round.keycardTaken?(self.hasKeycard?"Carry the Threshold Keycard to the activation terminal.":"Escort the Keycard holder to the Threshold terminal."):"Search Sector C for the Threshold Keycard.";
  else if(round?.phase==="extraction") objectiveLabel.textContent=self.role==="quarantine"?"Prevent anomalous escape. Cross or SEAL the Threshold using your authority.":"Reach the Threshold before instability. Watch who follows you.";
  else objectiveLabel.textContent="Survive and identify the anomalous host.";
}

function showBriefing(role){const r=ROLE[role]||ROLE.unassigned;briefRole.textContent=r.name;briefText.textContent=r.brief;briefLoadout.textContent=r.loadout;briefing.hidden=false;controls.unlock();audio.ui(role!=="anomaly");}
$("#briefDismiss").addEventListener("click",()=>{briefing.hidden=true;if(connected&&!self?.dead)controls.lock();});
function showEnd(winner,reason){endTitle.textContent=winner==="humans"?"CONTAINMENT RESTORED":"CONTAINMENT FAILURE";endText.textContent=reason;endScreen.hidden=false;controls.unlock();audio.alert();}
$("#endDismiss").addEventListener("click",()=>{endScreen.hidden=true;net.disconnect();connected=false;hud.hidden=true;menu.style.display="grid";});
function addFeed(text,danger=false){if(!text)return;const e=document.createElement("div");e.className=`feedItem${danger?" danger":""}`;e.textContent=text;feed.prepend(e);setTimeout(()=>e.remove(),5200);}
function showNotice(text,ms=1600){centerNotice.textContent=text;centerNotice.hidden=false;clearTimeout(showNotice.t);showNotice.t=setTimeout(()=>centerNotice.hidden=true,ms);}
function damageFlash(){hud.classList.add("damage");setTimeout(()=>hud.classList.remove("damage"),140);}

const particles=[];
function burstAtPlayer(id,color){const a=id===net.id?camera:remotes.get(id);if(!a)return;const pos=new THREE.Vector3();a.getWorldPosition(pos);pos.y=id===net.id?1.5:1.1;for(let i=0;i<7;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.025,5,4),new THREE.MeshBasicMaterial({color}));m.position.copy(pos);m.userData.vel=new THREE.Vector3((Math.random()-.5)*1.7,Math.random()*1.3,(Math.random()-.5)*1.7);m.userData.life=.55+Math.random()*.35;scene.add(m);particles.push(m);}}
function updateParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.userData.life-=dt;p.userData.vel.y-=3.7*dt;p.position.addScaledVector(p.userData.vel,dt);p.scale.multiplyScalar(.985);if(p.userData.life<=0){scene.remove(p);p.geometry.dispose();p.material.dispose();particles.splice(i,1);}}}
function remoteMuzzle(msg){const p=new THREE.Vector3(msg.x||0,1.25,msg.z||0);const l=new THREE.PointLight(0xffc66b,8,4,2);l.position.copy(p);scene.add(l);setTimeout(()=>scene.remove(l),55);createTracer(p,new THREE.Vector3(msg.dx||0,0,msg.dz||-1));}
function createTracer(origin,dir){const pts=[origin.clone(),origin.clone().add(dir.clone().normalize().multiplyScalar(9))];const geo=new THREE.BufferGeometry().setFromPoints(pts);const mat=new THREE.LineBasicMaterial({color:0xe6cf87,transparent:true,opacity:.45});const line=new THREE.Line(geo,mat);scene.add(line);setTimeout(()=>{scene.remove(line);geo.dispose();mat.dispose();},55);}

function localShoot(){
  if(!self||self.dead||self.escaped||!hasGun())return;if((self.ammo??0)<=0){audio.dryfire();return;}
  const dir=new THREE.Vector3();camera.getWorldDirection(dir);net.shoot({x:camera.position.x,y:camera.position.y,z:camera.position.z},{x:dir.x,y:dir.y,z:dir.z});
  audio.gunshot();recoil=Math.min(.16,recoil+.075);muzzleLight.intensity=13;setTimeout(()=>muzzleLight.intensity=0,45);createTracer(camera.position.clone().add(new THREE.Vector3(0,-.08,0)),dir);
}
function reload(){if(!self||!hasGun()||self.dead||self.escaped)return;net.reload();audio.reload();}
function useAbility(){if(self?.role!=="anomaly"||self.dead||self.escaped)return;net.ability();audio.anomaly();}
function toggleFlashlight(){flashlightOn=!flashlightOn;flashlight.visible=flashlightFill.visible=flashlightOn;audio.tone(flashlightOn?820:410,.03,.025,"square");}

window.addEventListener("keydown",e=>{
  if(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","KeyC"].includes(e.code))keys.add(e.code);if(e.repeat)return;
  if(e.code==="KeyR")reload();if(e.code==="KeyL")toggleFlashlight();if(e.code==="KeyQ")useAbility();if(e.code==="KeyE"&&currentInteraction)net.interact(currentInteraction.kind);
});
window.addEventListener("keyup",e=>keys.delete(e.code));
document.addEventListener("mousedown",e=>{if(e.button===0&&controls.isLocked)localShoot();});
controls.addEventListener("lock",()=>{audio.ensure();menu.style.display="none";hud.hidden=false;});
controls.addEventListener("unlock",()=>{menu.style.display=connected?"none":"grid";});
canvas.addEventListener("click",()=>{if(connected&&briefing.hidden&&endScreen.hidden&&!self?.dead)controls.lock();});

function randomRoom(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let out="";for(let i=0;i<5;i++)out+=alphabet[Math.floor(Math.random()*alphabet.length)];return out;}
async function join(room){
  const name=$("#nameInput").value.trim()||"wanderer",base=$("#workerInput").value.trim();if(!base){statusEl.textContent="Enter a Worker URL.";return;}statusEl.textContent="Establishing encrypted incident link…";
  try{await net.connect(base,room,name);connected=true;roomLabel.textContent=room;statusEl.textContent="Incident link established.";controls.lock();}
  catch(err){statusEl.textContent=`Connection failed: ${err?.message||"Worker unavailable"}`;}
}
$("#createBtn").addEventListener("click",()=>{const r=randomRoom();$("#roomInput").value=r;join(r);});
$("#joinBtn").addEventListener("click",()=>{const r=$("#roomInput").value.trim().toUpperCase();if(!r){statusEl.textContent="Enter an incident code.";return;}join(r);});
const queryWorker=new URLSearchParams(location.search).get("worker");if(queryWorker)$("#workerInput").value=queryWorker;

function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener("resize",resize);resize();

function updateMovement(dt){
  if(!controls.isLocked||!self||self.dead||self.escaped)return;
  const f=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0),s=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0),moving=!!(f||s);
  const crouch=keys.has("KeyC"),wantsSprint=(keys.has("ShiftLeft")||keys.has("ShiftRight"))&&f>0&&!crouch&&stamina>1,speed=crouch?1.75:wantsSprint?6.1:3.4;
  if(wantsSprint&&moving)stamina=Math.max(0,stamina-dt*21);else stamina=Math.min(100,stamina+dt*(moving?8:13));staminaEl.textContent=Math.round(stamina);
  const forward=new THREE.Vector3();camera.getWorldDirection(forward);forward.y=0;if(forward.lengthSq()<.001)forward.set(0,0,-1);forward.normalize();const right=forward.clone().cross(new THREE.Vector3(0,1,0)).normalize();
  const move=forward.multiplyScalar(f).add(right.multiplyScalar(s));if(move.lengthSq()>1)move.normalize();
  const old=camera.position.clone(),desired=old.clone().addScaledVector(move,speed*dt),resolved=resolveMovement(old,desired,world.colliders,.31);camera.position.x=resolved.x;camera.position.z=resolved.z;
  if(moving){walkPhase+=dt*(wantsSprint?13:crouch?5:8.5);audio.step(wantsSprint);}
  const baseY=crouch?1.15:1.66,bob=moving?Math.sin(walkPhase)*(.018*(wantsSprint?1.8:1)):0;camera.position.y=THREE.MathUtils.lerp(camera.position.y,baseY+bob,.18);
  weapon.position.y=THREE.MathUtils.lerp(weapon.position.y,moving?Math.sin(walkPhase*2)*.007:0,.13);weapon.position.x=THREE.MathUtils.lerp(weapon.position.x,moving?Math.cos(walkPhase)*.006:0,.13);weapon.rotation.z=THREE.MathUtils.lerp(weapon.rotation.z,-s*.026,.12);
}
function updateWeapon(dt){recoil=THREE.MathUtils.lerp(recoil,0,Math.min(1,dt*13));weapon.rotation.x=-recoil;weapon.position.z=recoil*.28;}
function updateRemoteAnimations(dt,now){for(const a of remotes.values()){const speed=a.position.distanceTo(a.userData.target)/Math.max(dt,.001);a.position.lerp(a.userData.target,Math.min(1,dt*11));let dy=((a.userData.yaw||0)-a.rotation.y+Math.PI)%(Math.PI*2)-Math.PI;a.rotation.y+=dy*Math.min(1,dt*9);const v=a.userData.visual;if(v){const phase=now*.008+(a.position.x+a.position.z),amp=Math.min(.55,speed*.035);v.arms[0].rotation.x=Math.sin(phase)*amp;v.arms[1].rotation.x=-Math.sin(phase)*amp;v.legs[0].rotation.x=-Math.sin(phase)*amp;v.legs[1].rotation.x=Math.sin(phase)*amp;a.position.y=THREE.MathUtils.lerp(a.position.y,a.userData.dead?-.72:0,.09);a.visible=!a.userData.escaped;}}}
function updateTimer(){if(!round){timerEl.textContent="--:--";return;}let ms=0;if(round.phase==="briefing")ms=Math.max(0,round.startsAt-Date.now());else if(round.phase==="extraction")ms=Math.max(0,round.extractionEndsAt-Date.now());else if(round.startedAt)ms=Math.max(0,Date.now()-round.startedAt);const total=Math.floor(ms/1000);timerEl.textContent=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;}

function tick(now){
  requestAnimationFrame(tick);const dt=Math.min(.04,(now-last)/1000||.016);last=now;
  updateMovement(dt);updateWeapon(dt);updateRemoteAnimations(dt,now);updateParticles(dt);world.update(now,round);updateTimer();
  currentInteraction=controls.isLocked?nearestInteraction(camera.position,round,self):null;interactionEl.hidden=!currentInteraction;if(currentInteraction)interactionEl.textContent=`[ E ] ${currentInteraction.label}`;
  if(connected&&controls.isLocked&&self&&!self.dead&&!self.escaped&&now-lastSend>125){const e=new THREE.Euler().setFromQuaternion(camera.quaternion,"YXZ");net.sendState({x:camera.position.x,z:camera.position.z,yaw:e.y,pitch:e.x});lastSend=now;}
  renderer.render(scene,camera);
}
requestAnimationFrame(tick);
