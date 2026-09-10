import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { NetClient } from "./network.js";
import { AudioSystem } from "./audio.js";
import { VoiceSystem } from "./voice.js";
import { createWorld, resolveMovement, nearestInteraction } from "./world.js";

const $=(q)=>document.querySelector(q);
const canvas=$("#game"),menu=$("#menu"),lobby=$("#lobby"),hud=$("#hud"),statusEl=$("#status");
const roomLabel=$("#roomLabel"),playerCount=$("#playerCount"),phaseLabel=$("#phaseLabel");
const roleLabel=$("#roleLabel"),objectiveLabel=$("#objectiveLabel"),timerEl=$("#timer");
const hpEl=$("#hp"),staminaEl=$("#stamina"),ammoCurrent=$("#ammoCurrent"),ammoReserve=$("#ammoReserve");
const feed=$("#feed"),interactionEl=$("#interaction"),centerNotice=$("#centerNotice");
const briefing=$("#briefing"),briefRole=$("#briefRole"),briefText=$("#briefText"),briefLoadout=$("#briefLoadout");
const pauseMenu=$("#pauseMenu"),settingsPanel=$("#settingsPanel"),endScreen=$("#endScreen"),endTitle=$("#endTitle"),endText=$("#endText");

const DEFAULT_SETTINGS={sensitivity:.78,fov:78,renderScale:.9,brightness:1.08,volume:.38,voiceVolume:.85,fpsCap:120,pushToTalk:false};
let settings={...DEFAULT_SETTINGS};
try{settings={...settings,...JSON.parse(localStorage.getItem("nullspace.settings")||"{}")} }catch{}

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled=false;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(settings.fov,1,.05,120);camera.position.set(-14,1.66,-14);
const controls=new PointerLockControls(camera,document.body);
const audio=new AudioSystem();
const world=createWorld(scene,"SITE-NULL");
scene.add(camera);

// Unlock WebAudio from any user gesture, even while still in the lobby/menu.
window.addEventListener("pointerdown",()=>audio.ensure(),{capture:true});
window.addEventListener("keydown",()=>audio.ensure(),{capture:true});

const flashlight=new THREE.SpotLight(0xfff3bd,10.5,26,Math.PI/7,.55,1.4);
flashlight.position.set(.11,-.05,.06);flashlight.target.position.set(.05,-.08,-8);
camera.add(flashlight);camera.add(flashlight.target);
const flashlightFill=new THREE.PointLight(0xe7dca7,.9,3.5);flashlightFill.position.set(.1,-.08,-.35);camera.add(flashlightFill);

const weapon=new THREE.Group();camera.add(weapon);
const gunMat=new THREE.MeshStandardMaterial({color:0x1b1c18,roughness:.36,metalness:.68});
const gripMat=new THREE.MeshStandardMaterial({color:0x0c0d0b,roughness:.8});
const slide=new THREE.Mesh(new THREE.BoxGeometry(.16,.16,.59),gunMat);slide.position.set(.31,-.26,-.62);weapon.add(slide);
const grip=new THREE.Mesh(new THREE.BoxGeometry(.13,.32,.18),gripMat);grip.position.set(.31,-.39,-.45);grip.rotation.x=-.18;weapon.add(grip);
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.026,.026,.25,10),gunMat);barrel.rotation.x=Math.PI/2;barrel.position.set(.31,-.24,-.96);weapon.add(barrel);
const muzzleLight=new THREE.PointLight(0xffc774,0,3,2);muzzleLight.position.set(.31,-.24,-1.08);camera.add(muzzleLight);
weapon.visible=false;

const net=new NetClient();
const remotes=new Map();
const keys=new Set();
let self=null,round=null,currentInteraction=null,last=performance.now(),lastSend=0,lastRender=0;
let stamina=100,flashlightOn=true,recoil=0,walkPhase=0,connected=false,voiceEnabled=false;
let openingSettingsFrom="menu";

// Real CC0 character asset by Quaternius, served by jsDelivr from a public mirror.
const PLAYER_MODEL_URL="https://cdn.jsdelivr.net/gh/agentkaerf/FreeModels@main/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Swat.gltf";
let playerTemplate=null;
const playerLoader=new GLTFLoader();
const playerAssetReady=playerLoader.loadAsync(PLAYER_MODEL_URL).then(gltf=>{
  playerTemplate=gltf.scene;
  playerTemplate.traverse(o=>{if(o.isMesh){o.frustumCulled=true;o.castShadow=false;o.receiveShadow=false}});
  return true
}).catch(err=>{console.warn("CC0 player model unavailable; using fallback avatar.",err);return false});

const voice=new VoiceSystem(
  net,
  ()=>({x:camera.position.x,z:camera.position.z}),
  ()=>net.players,
  ()=>settings.voiceVolume,
  ()=>settings.pushToTalk
);

const ROLE={
  unassigned:{name:"UNASSIGNED",brief:"Awaiting deployment assignment.",loadout:"No assignment issued."},
  observer:{name:"OBSERVER",brief:"This incident was active when you arrived. Observe until the next lobby.",loadout:"Spectator access only."},
  researcher:{name:"RESEARCH PERSONNEL",brief:"Recover the Threshold Keycard, identify the Mimic, and reach extraction alive. A friendly face proves nothing.",loadout:"LOADOUT // flashlight · proximity radio · no firearm"},
  security:{name:"SECURITY OFFICER",brief:"Protect personnel and neutralize confirmed anomalous hosts. Friendly fire is permanent.",loadout:"LOADOUT // 9mm sidearm · 4 magazines · flashlight"},
  quarantine:{name:"QUARANTINE OFFICER",brief:"No anomalous host may cross the Threshold. You retain primary sealing authority.",loadout:"LOADOUT // 9mm sidearm · quarantine authorization · flashlight"},
  anomaly:{name:"MIMIC ANOMALY",brief:"Stay trusted. Isolate personnel, wound them, and assimilate weakened hosts. Escape if the Threshold opens.",loadout:"ABILITY // Q at close range · human appearance until aggression"}
};

function isHost(){return !!self&&round?.hostId===self.id}
function hasGun(){return !!self?.weapon}
function isGameplay(){return round?.phase==="active"||round?.phase==="extraction"}

function applySettings(){
  controls.pointerSpeed=Number(settings.sensitivity);
  camera.fov=Number(settings.fov);camera.updateProjectionMatrix();
  renderer.toneMappingExposure=Number(settings.brightness);
  audio.setVolume(Number(settings.volume));
  voice.applyMicState();
  resize();
  $("#sensitivitySetting").value=settings.sensitivity;$("#sensitivityValue").textContent=Number(settings.sensitivity).toFixed(2);
  $("#fovSetting").value=settings.fov;$("#fovValue").textContent=Math.round(settings.fov);
  $("#renderSetting").value=settings.renderScale;$("#renderValue").textContent=`${Math.round(settings.renderScale*100)}%`;
  $("#brightnessSetting").value=settings.brightness;$("#brightnessValue").textContent=Number(settings.brightness).toFixed(2);
  $("#volumeSetting").value=settings.volume;$("#volumeValue").textContent=`${Math.round(settings.volume*100)}%`;
  $("#voiceVolumeSetting").value=settings.voiceVolume;$("#voiceVolumeValue").textContent=`${Math.round(settings.voiceVolume*100)}%`;
  $("#fpsSetting").value=String(settings.fpsCap);$("#pttSetting").checked=!!settings.pushToTalk
}
function saveSettings(){localStorage.setItem("nullspace.settings",JSON.stringify(settings));applySettings()}

function updateSelf(s){
  if(!s)return;
  const oldRole=self?.role;
  self=s;
  hpEl.textContent=Math.round(self.hp??100);ammoCurrent.textContent=self.ammo??0;ammoReserve.textContent=self.reserve??0;
  weapon.visible=hasGun()&&!self.dead&&!self.escaped&&isGameplay();
  roleLabel.textContent=(ROLE[self.role]||ROLE.unassigned).name;
  if(Number.isFinite(self.x)&&Number.isFinite(self.z)&&oldRole==="unassigned"&&self.role!=="unassigned")camera.position.set(self.x,1.66,self.z);
  if(self.role!==oldRole&&self.role!=="unassigned"&&round?.phase==="briefing")showBriefing(self.role);
  renderLobby();updateObjective()
}

function updateRound(r){
  const previous=round?.phase;round=r;if(!r)return;
  phaseLabel.textContent=r.phase.toUpperCase();
  if(r.phase==="lobby")showLobby();
  else if(r.phase==="briefing"){
    lobby.hidden=true;hud.hidden=true;pauseMenu.hidden=true;
    if(self?.role&&self.role!=="unassigned"&&self.role!=="observer")showBriefing(self.role)
  }else if(r.phase==="active"||r.phase==="extraction"){
    lobby.hidden=true;hud.hidden=false;
    if(previous==="briefing"&&briefing.hidden&&pauseMenu.hidden)controls.lock()
  }else if(r.phase==="ended")showEnd(r.winner,r.reason);
  renderLobby();updateObjective()
}

net.onSelf=updateSelf;
net.onRound=updateRound;
net.onPlayers=(players)=>{
  playerCount.textContent=`${players.size} OPERATIVE${players.size===1?"":"S"}`;
  renderLobby();voice.syncPeers();
  if(round?.phase==="lobby")return;
  for(const [id,p] of players){
    if(id===net.id)continue;
    let avatar=remotes.get(id);if(!avatar){avatar=createAvatar(p);remotes.set(id,avatar)}
    avatar.userData.target.set(p.x??0,0,p.z??0);avatar.userData.yaw=p.yaw??0;avatar.userData.dead=!!p.dead;avatar.userData.escaped=!!p.escaped;
    setRevealed(avatar,!!p.revealed)
  }
  for(const [id,a] of [...remotes])if(!players.has(id)){scene.remove(a);remotes.delete(id)}
};

net.onEvent=(msg)=>{
  if(msg.type==="voiceSignal"){voice.handleSignal(msg.from,msg.payload);return}
  if(msg.type==="event"){
    addFeed(msg.text||msg.kind,msg.kind==="danger"||msg.kind==="alarm");
    if(msg.kind==="alarm"){audio.alert();showNotice(msg.text,3000)}
    if(msg.kind==="start")audio.ui(true);renderLobby();return
  }
  if(msg.type==="notice"){addFeed(msg.text,true);showNotice(msg.text,1800);audio.ui(false);return}
  if(msg.type==="shot"){if(msg.id!==net.id){audio.noise(.08,.12,1500);remoteMuzzle(msg)}return}
  if(msg.type==="hit"){
    if(msg.target===net.id){audio.hit();damageFlash();addFeed(`TRAUMA // -${msg.damage}`,true)}
    if(msg.attacker===net.id)addFeed(`IMPACT CONFIRMED // ${msg.damage}`);
    burstAtPlayer(msg.target);return
  }
  if(msg.type==="reveal"){const a=remotes.get(msg.id);if(a){setRevealed(a,true);setTimeout(()=>setRevealed(a,false),3000)}audio.anomaly();return}
  if(msg.type==="converted"){addFeed(`${msg.name} biometrics became non-human.`,true);showNotice("ASSIMILATION EVENT DETECTED",2200);audio.anomaly();return}
  if(msg.type==="death"){addFeed(`${msg.name} is no longer transmitting.`,true);return}
};
net.onClose=()=>{if(connected){connected=false;voice.disable();voiceEnabled=false;leaveToMenu("Connection lost.")}};

function createAvatar(p){
  const g=new THREE.Group();g.userData.target=new THREE.Vector3(p.x||0,0,p.z||0);g.userData.yaw=p.yaw||0;
  const uniform=new THREE.MeshLambertMaterial({color:0x59615a}),dark=new THREE.MeshLambertMaterial({color:0x171914}),skin=new THREE.MeshLambertMaterial({color:0xb98e70});
  const anomaly=new THREE.MeshStandardMaterial({color:0x2a0f0e,emissive:0x4b0908,emissiveIntensity:.8,roughness:.6});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(.54,.72,.28),uniform);torso.position.y=1.18;g.add(torso);
  const vest=new THREE.Mesh(new THREE.BoxGeometry(.58,.45,.31),dark);vest.position.set(0,1.25,-.015);g.add(vest);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.22,12,8),skin);head.position.y=1.72;g.add(head);
  const arms=[],legs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.45,4,6),uniform);arm.position.set(side*.37,1.15,0);g.add(arm);arms.push(arm);
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.095,.58,4,6),dark);leg.position.set(side*.16,.48,0);g.add(leg);legs.push(leg)
  }
  const tag=makeTag(p.name||"UNKNOWN");tag.position.y=2.15;g.add(tag);
  const revealLight=new THREE.PointLight(0xb51f18,0,3.4,2);revealLight.position.y=1.2;g.add(revealLight);
  g.userData.visual={uniform,dark,skin,anomaly,torso,head,arms,legs,tag,revealLight,fallback:[torso,vest,head,...arms,...legs],model:null,modelMeshes:[]};
  g.position.set(p.x||0,0,p.z||0);scene.add(g);
  attachRealPlayerModel(g);
  return g
}

async function attachRealPlayerModel(group){
  const ok=await playerAssetReady;if(!ok||!playerTemplate||!scene.children.includes(group))return;
  try{
    const model=playerTemplate.clone(true);
    const materials=new Map();
    model.traverse(o=>{
      if(!o.isMesh)return;
      if(o.material){
        if(!materials.has(o.material))materials.set(o.material,o.material.clone());
        o.material=materials.get(o.material)
      }
      o.castShadow=false;o.receiveShadow=false
    });
    let bounds=new THREE.Box3().setFromObject(model),size=new THREE.Vector3();bounds.getSize(size);
    const scale=1.76/Math.max(.01,size.y);model.scale.setScalar(scale);
    bounds=new THREE.Box3().setFromObject(model);model.position.y-=bounds.min.y;
    model.rotation.y=Math.PI;
    group.add(model);
    const meshes=[];model.traverse(o=>{if(o.isMesh)meshes.push(o)});
    const v=group.userData.visual;v.model=model;v.modelMeshes=meshes;v.fallback.forEach(o=>o.visible=false)
  }catch(err){console.warn("Failed to attach player asset",err)}
}

function makeTag(text){
  const c=document.createElement("canvas");c.width=512;c.height=96;const ctx=c.getContext("2d");
  ctx.font="700 36px monospace";ctx.textAlign="center";ctx.fillStyle="#f0ecd4";ctx.fillText(text.slice(0,18),256,55);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false,opacity:.72}));s.scale.set(2.3,.43,1);return s
}
function setRevealed(a,on){
  const v=a.userData.visual;if(!v)return;
  v.torso.material=on?v.anomaly:v.uniform;v.head.material=on?v.anomaly:v.skin;v.arms.forEach(x=>x.material=on?v.anomaly:v.uniform);v.tag.material.opacity=on?.2:.72;
  if(v.revealLight)v.revealLight.intensity=on?4.2:0;
  if(v.modelMeshes?.length){
    for(const mesh of v.modelMeshes){
      const m=mesh.material;if(!m)continue;
      if(on&&"emissive" in m){if(!m.userData.oldEmissive)m.userData.oldEmissive=m.emissive.clone();m.emissive.setHex(0x410807);m.emissiveIntensity=.75}
      else if(!on&&m.userData.oldEmissive){m.emissive.copy(m.userData.oldEmissive);m.emissiveIntensity=0}
    }
  }
}

function renderLobby(){
  if(!connected||round?.phase!=="lobby")return;
  $("#lobbyCode").textContent=net.room||"-----";
  const host=net.players.get(round?.hostId);$("#lobbyHostBadge").textContent=`HOST: ${host?.name||"---"}`;
  const list=$("#lobbyPlayers");list.innerHTML="";
  const sorted=[...net.players.values()].sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0));
  for(const p of sorted){
    const row=document.createElement("div");row.className="playerRow";
    row.innerHTML=`<span class="playerName">${escapeHtml(p.name)}</span><span class="${p.id===round.hostId?"hostTag":""}">${p.id===round.hostId?"HOST":""}</span><span class="${p.ready?"readyTag":"notReadyTag"}">${p.ready?"READY":"NOT READY"}</span>`;
    list.appendChild(row)
  }
  const mine=net.players.get(net.id)||self;
  $("#readyBtn").textContent=mine?.ready?"UNREADY":"READY";$("#readyBtn").classList.toggle("primary",!mine?.ready);
  $("#startBtn").style.display=isHost()?"block":"none";
  const humanPlayers=sorted,allReady=humanPlayers.length>=2&&humanPlayers.every(p=>p.ready);$("#startBtn").disabled=!allReady;
  $("#lobbyStatus").textContent=humanPlayers.length<2?"Need at least 2 operatives.":allReady?(isHost()?"Everyone ready. You can start.":"Everyone ready. Waiting for host."):`${humanPlayers.filter(p=>p.ready).length}/${humanPlayers.length} ready.`
}
function escapeHtml(v){const d=document.createElement("div");d.textContent=String(v||"");return d.innerHTML}

function showLobby(){
  controls.unlock();menu.style.display="none";lobby.hidden=false;briefing.hidden=true;pauseMenu.hidden=true;settingsPanel.hidden=true;endScreen.hidden=true;hud.hidden=true;clearRemotes();renderLobby()
}
function clearRemotes(){for(const a of remotes.values())scene.remove(a);remotes.clear()}
function showBriefing(role){
  const r=ROLE[role]||ROLE.unassigned;briefRole.textContent=r.name;briefText.textContent=r.brief;briefLoadout.textContent=r.loadout;
  briefing.hidden=false;lobby.hidden=true;pauseMenu.hidden=true;hud.hidden=true;controls.unlock();audio.ui(role!=="anomaly")
}
function showEnd(winner,reason){
  controls.unlock();pauseMenu.hidden=true;briefing.hidden=true;hud.hidden=true;lobby.hidden=true;endScreen.hidden=false;
  endTitle.textContent=winner==="humans"?"CONTAINMENT RESTORED":"CONTAINMENT FAILURE";endText.textContent=reason||"Incident concluded.";
  $("#endLobbyBtn").style.display=isHost()?"block":"none";$("#endWait").textContent=isHost()?"Return everyone to the lobby when ready.":"Waiting for lobby leader to return the team.";audio.alert()
}
function updateObjective(){
  if(!self){objectiveLabel.textContent="Awaiting identity verification.";return}
  if(self.dead){objectiveLabel.textContent="You are deceased. Observe remaining incident traffic.";return}
  if(self.escaped){objectiveLabel.textContent="You crossed the Threshold. Await incident resolution.";return}
  if(self.role==="anomaly"){objectiveLabel.textContent=round?.phase==="extraction"?"Escape through the Threshold or assimilate remaining humans.":"Remain trusted. Q attacks/assimilates a nearby weakened human.";return}
  if(round?.phase==="active")objectiveLabel.textContent=round.keycardTaken?(self.hasKeycard?"Carry the Threshold Keycard to control.":"Escort the Keycard holder to Threshold control."):"Search Level 0 for the Threshold Keycard.";
  else if(round?.phase==="extraction")objectiveLabel.textContent=self.role==="quarantine"?"Prevent anomalous escape. Cross or seal the Threshold.":"Reach the Threshold. Watch who follows you.";
  else objectiveLabel.textContent="Stand by."
}

function addFeed(text,danger=false){if(!text)return;const e=document.createElement("div");e.className=`feedItem${danger?" danger":""}`;e.textContent=text;feed.prepend(e);setTimeout(()=>e.remove(),5000)}
function showNotice(text,ms=1600){centerNotice.textContent=text;centerNotice.hidden=false;clearTimeout(showNotice.t);showNotice.t=setTimeout(()=>centerNotice.hidden=true,ms)}
function damageFlash(){hud.classList.add("damage");setTimeout(()=>hud.classList.remove("damage"),140)}

const particles=[];
function burstAtPlayer(id){
  const a=id===net.id?camera:remotes.get(id);if(!a)return;const pos=new THREE.Vector3();a.getWorldPosition(pos);pos.y=id===net.id?1.5:1.1;
  for(let i=0;i<5;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.025,4,3),new THREE.MeshBasicMaterial({color:0x721b17}));m.position.copy(pos);m.userData.vel=new THREE.Vector3((Math.random()-.5)*1.5,Math.random()*1.1,(Math.random()-.5)*1.5);m.userData.life=.45+Math.random()*.3;scene.add(m);particles.push(m)}
}
function updateParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.userData.life-=dt;p.userData.vel.y-=3.7*dt;p.position.addScaledVector(p.userData.vel,dt);if(p.userData.life<=0){scene.remove(p);p.geometry.dispose();p.material.dispose();particles.splice(i,1)}}}
function remoteMuzzle(msg){const p=new THREE.Vector3(msg.x||0,1.25,msg.z||0),l=new THREE.PointLight(0xffc66b,7,4,2);l.position.copy(p);scene.add(l);setTimeout(()=>scene.remove(l),45);createTracer(p,new THREE.Vector3(msg.dx||0,0,msg.dz||-1))}
function createTracer(origin,dir){const geo=new THREE.BufferGeometry().setFromPoints([origin.clone(),origin.clone().add(dir.clone().normalize().multiplyScalar(9))]);const mat=new THREE.LineBasicMaterial({color:0xe6cf87,transparent:true,opacity:.45});const line=new THREE.Line(geo,mat);scene.add(line);setTimeout(()=>{scene.remove(line);geo.dispose();mat.dispose()},50)}

function localShoot(){
  if(!isGameplay()||!self||self.dead||self.escaped||!hasGun())return;
  if((self.ammo??0)<=0){audio.dryfire();return}
  const dir=new THREE.Vector3();camera.getWorldDirection(dir);net.shoot({x:camera.position.x,y:camera.position.y,z:camera.position.z},{x:dir.x,y:dir.y,z:dir.z});
  audio.gunshot();recoil=Math.min(.16,recoil+.075);muzzleLight.intensity=12;setTimeout(()=>muzzleLight.intensity=0,42);createTracer(camera.position.clone(),dir)
}
function reload(){if(isGameplay()&&self&&hasGun()&&!self.dead&&!self.escaped){net.reload();audio.reload()}}
function useAbility(){if(isGameplay()&&self?.role==="anomaly"&&!self.dead&&!self.escaped){net.ability();audio.anomaly()}}
function toggleFlashlight(){flashlightOn=!flashlightOn;flashlight.visible=flashlightFill.visible=flashlightOn;audio.tone(flashlightOn?820:410,.03,.035,"square")}

window.addEventListener("keydown",e=>{
  if(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","ControlLeft","ControlRight"].includes(e.code))keys.add(e.code);
  if(e.code==="KeyV"&&settings.pushToTalk){voice.setTalking(true);$("#voiceIndicator").hidden=false}
  if(e.repeat)return;
  if(e.code==="KeyR")reload();if(e.code==="KeyF")toggleFlashlight();if(e.code==="KeyQ")useAbility();if(e.code==="KeyE"&&currentInteraction)net.interact(currentInteraction.kind)
});
window.addEventListener("keyup",e=>{keys.delete(e.code);if(e.code==="KeyV"&&settings.pushToTalk){voice.setTalking(false);$("#voiceIndicator").hidden=true}});
document.addEventListener("mousedown",e=>{if(e.button===0&&controls.isLocked)localShoot()});

controls.addEventListener("lock",()=>{audio.ensure();pauseMenu.hidden=true;hud.hidden=false});
controls.addEventListener("unlock",()=>{if(connected&&isGameplay()&&briefing.hidden&&endScreen.hidden&&settingsPanel.hidden){pauseMenu.hidden=false;hud.hidden=true}});
canvas.addEventListener("click",()=>{if(connected&&isGameplay()&&briefing.hidden&&pauseMenu.hidden&&settingsPanel.hidden&&!self?.dead)controls.lock()});

function randomRoom(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let out="";for(let i=0;i<5;i++)out+=alphabet[Math.floor(Math.random()*alphabet.length)];return out}
async function join(room){
  const name=$("#nameInput").value.trim()||"wanderer",base=$("#workerInput").value.trim()||"https://nullspace.bmgames182.workers.dev";
  statusEl.textContent="Establishing incident link…";
  try{await net.connect(base,room,name);connected=true;roomLabel.textContent=room;statusEl.textContent="Incident link established.";menu.style.display="none";if(net.round?.phase==="lobby")showLobby()}
  catch(err){statusEl.textContent=`Connection failed: ${err?.message||"Worker unavailable"}`}
}
function leaveToMenu(message="Terminal ready."){
  connected=false;net.disconnect();clearRemotes();controls.unlock();lobby.hidden=true;briefing.hidden=true;pauseMenu.hidden=true;settingsPanel.hidden=true;endScreen.hidden=true;hud.hidden=true;menu.style.display="grid";statusEl.textContent=message;self=null;round=null
}

$("#createBtn").addEventListener("click",()=>{const r=randomRoom();$("#roomInput").value=r;join(r)});
$("#joinBtn").addEventListener("click",()=>{const r=$("#roomInput").value.trim().toUpperCase();if(!r){statusEl.textContent="Enter an incident code.";return}join(r)});
$("#readyBtn").addEventListener("click",()=>{const mine=net.players.get(net.id)||self;net.setReady(!mine?.ready)});
$("#startBtn").addEventListener("click",()=>net.startRound());
$("#leaveLobbyBtn").addEventListener("click",()=>leaveToMenu());
$("#copyCodeBtn").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(net.room||"");$("#lobbyStatus").textContent="Incident code copied."}catch{}});
$("#briefDismiss").addEventListener("click",()=>{briefing.hidden=true;if(round?.phase==="active"&&!self?.dead)controls.lock();else showNotice("Deployment begins when countdown ends.",1800)});
$("#resumeBtn").addEventListener("click",()=>controls.lock());
$("#leaveMatchBtn").addEventListener("click",()=>leaveToMenu());
$("#endLobbyBtn").addEventListener("click",()=>net.returnLobby());

async function toggleVoice(){
  if(voiceEnabled){voice.disable();voiceEnabled=false;$("#voiceBtn").textContent="ENABLE PROXIMITY VOICE";$("#voiceState").textContent="Voice is off.";return}
  try{await voice.enable();voiceEnabled=true;$("#voiceBtn").textContent="DISABLE PROXIMITY VOICE";$("#voiceState").textContent=settings.pushToTalk?"Voice enabled. Hold V to talk.":"Voice enabled. Nearby players can hear you.";audio.ui(true)}
  catch{$("#voiceState").textContent="Microphone permission was denied or unavailable.";audio.ui(false)}
}
$("#voiceBtn").addEventListener("click",toggleVoice);

function openSettings(from){openingSettingsFrom=from;settingsPanel.hidden=false;if(from==="pause")pauseMenu.hidden=true}
function closeSettings(){settingsPanel.hidden=true;if(openingSettingsFrom==="pause"&&connected&&isGameplay())pauseMenu.hidden=false}
$("#menuSettingsBtn").addEventListener("click",()=>openSettings("menu"));
$("#pauseSettingsBtn").addEventListener("click",()=>openSettings("pause"));
$("#closeSettingsBtn").addEventListener("click",closeSettings);

for(const [id,key,parse] of [
  ["sensitivitySetting","sensitivity",Number],["fovSetting","fov",Number],["renderSetting","renderScale",Number],
  ["brightnessSetting","brightness",Number],["volumeSetting","volume",Number],["voiceVolumeSetting","voiceVolume",Number],["fpsSetting","fpsCap",Number]
])$("#"+id).addEventListener("input",e=>{settings[key]=parse(e.target.value);saveSettings()});
$("#pttSetting").addEventListener("change",e=>{settings.pushToTalk=e.target.checked;voice.setTalking(false);saveSettings();if(voiceEnabled)$("#voiceState").textContent=settings.pushToTalk?"Voice enabled. Hold V to talk.":"Voice enabled. Nearby players can hear you."});

const queryWorker=new URLSearchParams(location.search).get("worker");if(queryWorker)$("#workerInput").value=queryWorker;

function resize(){
  const w=innerWidth,h=innerHeight;renderer.setPixelRatio(Math.min(devicePixelRatio*Math.max(.5,Number(settings.renderScale)||.9),1.55));
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()
}
addEventListener("resize",resize);

const moveForward=new THREE.Vector3(),moveRight=new THREE.Vector3(),moveVector=new THREE.Vector3(),desiredPosition=new THREE.Vector3();
function updateMovement(dt){
  if(!controls.isLocked||!self||self.dead||self.escaped||!isGameplay())return;
  const f=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0),s=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0),moving=!!(f||s);
  const crouch=keys.has("ControlLeft")||keys.has("ControlRight");
  const sprint=(keys.has("ShiftLeft")||keys.has("ShiftRight"))&&f>0&&!crouch&&stamina>1;
  const speed=crouch?2.2:sprint?6.45:4.15;
  if(sprint&&moving)stamina=Math.max(0,stamina-dt*18);else stamina=Math.min(100,stamina+dt*(moving?9:14));staminaEl.textContent=Math.round(stamina);
  camera.getWorldDirection(moveForward);moveForward.y=0;if(moveForward.lengthSq()<.001)moveForward.set(0,0,-1);moveForward.normalize();
  moveRight.set(moveForward.z,0,-moveForward.x);
  moveVector.copy(moveForward).multiplyScalar(f).addScaledVector(moveRight,s);if(moveVector.lengthSq()>1)moveVector.normalize();
  desiredPosition.copy(camera.position).addScaledVector(moveVector,speed*dt);
  const resolved=resolveMovement(camera.position,desiredPosition,world.colliders,.24);camera.position.x=resolved.x;camera.position.z=resolved.z;
  if(moving){walkPhase+=dt*(sprint?12.5:crouch?5.2:8.4);audio.step(sprint,crouch)}
  const baseY=crouch?1.16:1.66,bob=moving?Math.sin(walkPhase)*(.014*(sprint?1.7:1)):0;camera.position.y=THREE.MathUtils.lerp(camera.position.y,baseY+bob,.24);
  weapon.position.y=THREE.MathUtils.lerp(weapon.position.y,moving?Math.sin(walkPhase*2)*.006:0,.13);weapon.position.x=THREE.MathUtils.lerp(weapon.position.x,moving?Math.cos(walkPhase)*.005:0,.13);weapon.rotation.z=THREE.MathUtils.lerp(weapon.rotation.z,-s*.026,.12)
}
function updateWeapon(dt){recoil=THREE.MathUtils.lerp(recoil,0,Math.min(1,dt*13));weapon.rotation.x=-recoil;weapon.position.z=recoil*.28}
function updateRemoteAnimations(dt,now){
  for(const a of remotes.values()){
    const speed=a.position.distanceTo(a.userData.target)/Math.max(dt,.001);a.position.lerp(a.userData.target,Math.min(1,dt*11));
    let dy=((a.userData.yaw||0)-a.rotation.y+Math.PI)%(Math.PI*2)-Math.PI;a.rotation.y+=dy*Math.min(1,dt*10);
    const v=a.userData.visual;if(v){
      const phase=now*.008+a.position.x+a.position.z,amp=Math.min(.5,speed*.034);
      if(!v.model){v.arms[0].rotation.x=Math.sin(phase)*amp;v.arms[1].rotation.x=-Math.sin(phase)*amp;v.legs[0].rotation.x=-Math.sin(phase)*amp;v.legs[1].rotation.x=Math.sin(phase)*amp}
      if(v.model)v.model.position.y=(a.userData.dead?0:Math.abs(Math.sin(phase))*.012*Math.min(1,speed*.1));
      a.position.y=THREE.MathUtils.lerp(a.position.y,a.userData.dead?-.72:0,.09);a.visible=!a.userData.escaped
    }
  }
}
function updateTimer(){
  if(!round){timerEl.textContent="--:--";return}
  let ms=0;if(round.phase==="briefing")ms=Math.max(0,round.startsAt-Date.now());else if(round.phase==="extraction")ms=Math.max(0,round.extractionEndsAt-Date.now());else if(round.startedAt)ms=Math.max(0,Date.now()-round.startedAt);
  const total=Math.floor(ms/1000);timerEl.textContent=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`
}

function tick(now){
  requestAnimationFrame(tick);
  const cap=Number(settings.fpsCap)||0;if(cap&&now-lastRender<1000/cap)return;lastRender=now;
  const dt=Math.min(.04,(now-last)/1000||.016);last=now;
  updateMovement(dt);updateWeapon(dt);updateRemoteAnimations(dt,now);updateParticles(dt);world.update(now,round);updateTimer();voice.update(now);
  currentInteraction=controls.isLocked?nearestInteraction(camera.position,round,self):null;interactionEl.hidden=!currentInteraction;if(currentInteraction)interactionEl.textContent=`[ E ] ${currentInteraction.label}`;
  if(connected&&controls.isLocked&&self&&!self.dead&&!self.escaped&&isGameplay()&&now-lastSend>100){
    const e=new THREE.Euler().setFromQuaternion(camera.quaternion,"YXZ");net.sendState({x:camera.position.x,z:camera.position.z,yaw:e.y,pitch:e.x});lastSend=now
  }
  renderer.render(scene,camera)
}
applySettings();requestAnimationFrame(tick);
