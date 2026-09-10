import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { NetClient } from "./network.js";
import { AudioSystem } from "./audio.js";
import { VoiceSystem } from "./voice.js";
import { createWorld, resolveMovement, nearestInteraction } from "./world.js";

const hudStyles=document.createElement("link");hudStyles.rel="stylesheet";hudStyles.href="./hud.css";document.head.appendChild(hudStyles);

const $=q=>document.querySelector(q);
const canvas=$("#game"),menu=$("#menu"),lobby=$("#lobby"),hud=$("#hud"),statusEl=$("#status");
const roomLabel=$("#roomLabel"),playerCount=$("#playerCount"),phaseLabel=$("#phaseLabel"),roleLabel=$("#roleLabel"),objectiveLabel=$("#objectiveLabel"),timerEl=$("#timer");
const hpEl=$("#hp"),staminaEl=$("#stamina"),ammoCurrent=$("#ammoCurrent"),ammoReserve=$("#ammoReserve"),ammoPanel=$("#ammo");
const feed=$("#feed"),interactionEl=$("#interaction"),centerNotice=$("#centerNotice"),crosshair=$("#crosshair");
const briefing=$("#briefing"),briefRole=$("#briefRole"),briefText=$("#briefText"),briefLoadout=$("#briefLoadout");
const pauseMenu=$("#pauseMenu"),settingsPanel=$("#settingsPanel"),endScreen=$("#endScreen"),endTitle=$("#endTitle"),endText=$("#endText");

const SETTINGS_VERSION=2;
const DEFAULT_SETTINGS={_v:SETTINGS_VERSION,sensitivity:.78,fov:78,renderScale:.92,brightness:.9,volume:.52,voiceVolume:.85,fpsCap:120,pushToTalk:false};
let settings={...DEFAULT_SETTINGS};
try{
  const saved=JSON.parse(localStorage.getItem("nullspace.settings")||"{}");settings={...settings,...saved};
  if((saved._v||0)<SETTINGS_VERSION){settings.brightness=.9;settings.volume=Math.max(.45,Number(saved.volume)||0);settings._v=SETTINGS_VERSION}
}catch{}

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=settings.brightness;renderer.shadowMap.enabled=false;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(settings.fov,1,.05,95);camera.position.set(-14,1.66,-14);scene.add(camera);
const controls=new PointerLockControls(camera,document.body),audio=new AudioSystem(),world=createWorld(scene,"SITE-NULL");

window.addEventListener("pointerdown",()=>audio.ensure(),{capture:true});window.addEventListener("keydown",()=>audio.ensure(),{capture:true});

// Flashlight is intentionally soft. The old light was strong enough to turn nearby wallpaper into the sun.
const flashlight=new THREE.SpotLight(0xfff0bd,4.4,18.5,.31,.68,1.7);flashlight.position.set(.08,-.03,.03);flashlight.target.position.set(.02,-.08,-7.5);camera.add(flashlight,flashlight.target);
const flashlightFill=new THREE.PointLight(0xe9dfb5,.17,2.4,2);flashlightFill.position.set(.08,-.08,-.28);camera.add(flashlightFill);

// First-person viewmodel.
const viewmodel=new THREE.Group();camera.add(viewmodel);viewmodel.position.set(.29,-.235,-.56);
const weapon=new THREE.Group();viewmodel.add(weapon);
const gunMetal=new THREE.MeshStandardMaterial({color:0x181b19,roughness:.3,metalness:.72}),gunDark=new THREE.MeshStandardMaterial({color:0x0e100f,roughness:.68,metalness:.25}),sleeveMat=new THREE.MeshStandardMaterial({color:0x303833,roughness:.88}),gloveMat=new THREE.MeshStandardMaterial({color:0x101311,roughness:.96});
function vmBox(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);weapon.add(m);return m}
const slide=vmBox(.155,.115,.49,gunMetal,0,.02,-.08);vmBox(.142,.115,.34,gunDark,0,-.075,.015);const grip=vmBox(.12,.265,.145,gunDark,0,-.235,.095);grip.rotation.x=-.16;
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.22,10),gunMetal);barrel.rotation.x=Math.PI/2;barrel.position.set(0,.005,-.38);weapon.add(barrel);
vmBox(.026,.034,.035,gunMetal,0,.096,-.28);vmBox(.026,.03,.026,gunMetal,0,.09,.135);
const triggerGuard=new THREE.Mesh(new THREE.TorusGeometry(.062,.012,6,12,Math.PI),gunDark);triggerGuard.rotation.set(Math.PI/2,0,Math.PI);triggerGuard.position.set(0,-.15,.005);weapon.add(triggerGuard);
const forearm=new THREE.Mesh(new THREE.CapsuleGeometry(.058,.27,4,8),sleeveMat);forearm.rotation.x=1.23;forearm.rotation.z=.08;forearm.position.set(.075,-.39,.19);weapon.add(forearm);
const hand=new THREE.Mesh(new THREE.CapsuleGeometry(.052,.105,4,8),gloveMat);hand.rotation.x=.42;hand.position.set(.02,-.255,.085);weapon.add(hand);
const muzzleLight=new THREE.PointLight(0xffc169,0,2.8,2);muzzleLight.position.set(0,.01,-.5);weapon.add(muzzleLight);weapon.visible=false;

const net=new NetClient(),remotes=new Map(),keys=new Set();
let self=null,round=null,currentInteraction=null,last=performance.now(),lastSend=0,lastRender=0,connected=false,voiceEnabled=false,openingSettingsFrom="menu";
let stamina=100,flashlightOn=true,recoil=0,walkPhase=0,stepTravel=0,mouseSwayX=0,mouseSwayY=0,lastMoving=false;
const velocity=new THREE.Vector2(),moveForward=new THREE.Vector3(),moveRight=new THREE.Vector3(),moveVector=new THREE.Vector3(),desiredPosition=new THREE.Vector3();

const PLAYER_MODEL_URL="https://cdn.jsdelivr.net/gh/agentkaerf/FreeModels@main/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Swat.gltf";
const playerLoader=new GLTFLoader();let playerAsset=null;
const playerAssetReady=playerLoader.loadAsync(PLAYER_MODEL_URL).then(gltf=>{playerAsset=gltf;return true}).catch(err=>{console.warn("CC0 SWAT model unavailable; fallback avatar enabled.",err);return false});

const voice=new VoiceSystem(net,()=>({x:camera.position.x,z:camera.position.z}),()=>net.players,()=>settings.voiceVolume,()=>settings.pushToTalk);
const ROLE={
  unassigned:{name:"UNASSIGNED",brief:"Awaiting deployment assignment.",loadout:"No assignment issued."},
  observer:{name:"OBSERVER",brief:"This incident was active when you arrived. Observe until the next lobby.",loadout:"Spectator access only."},
  researcher:{name:"RESEARCH PERSONNEL",brief:"Recover the Threshold Keycard, identify the Mimic, and reach extraction alive. A friendly face proves nothing.",loadout:"LOADOUT // flashlight · proximity radio · no firearm"},
  security:{name:"SECURITY OFFICER",brief:"Protect personnel and neutralize confirmed anomalous hosts. Friendly fire is permanent.",loadout:"LOADOUT // 9mm sidearm · 4 magazines · flashlight"},
  quarantine:{name:"QUARANTINE OFFICER",brief:"No anomalous host may cross the Threshold. You retain primary sealing authority.",loadout:"LOADOUT // 9mm sidearm · quarantine authorization · flashlight"},
  anomaly:{name:"MIMIC ANOMALY",brief:"Stay trusted. Isolate personnel, wound them, and assimilate weakened hosts. Escape if the Threshold opens.",loadout:"ABILITY // Q at close range · human appearance until aggression"}
};
const isHost=()=>!!self&&round?.hostId===self.id,hasGun=()=>!!self?.weapon,isGameplay=()=>round?.phase==="active"||round?.phase==="extraction";
const damp=(a,b,lambda,dt)=>THREE.MathUtils.lerp(a,b,1-Math.exp(-lambda*dt));

function applySettings(){
  controls.pointerSpeed=Number(settings.sensitivity);renderer.toneMappingExposure=Number(settings.brightness);audio.setVolume(Number(settings.volume));voice.applyMicState();resize();
  $("#sensitivitySetting").value=settings.sensitivity;$("#sensitivityValue").textContent=Number(settings.sensitivity).toFixed(2);
  $("#fovSetting").value=settings.fov;$("#fovValue").textContent=Math.round(settings.fov);$("#renderSetting").value=settings.renderScale;$("#renderValue").textContent=`${Math.round(settings.renderScale*100)}%`;
  $("#brightnessSetting").value=settings.brightness;$("#brightnessValue").textContent=Number(settings.brightness).toFixed(2);$("#volumeSetting").value=settings.volume;$("#volumeValue").textContent=`${Math.round(settings.volume*100)}%`;
  $("#voiceVolumeSetting").value=settings.voiceVolume;$("#voiceVolumeValue").textContent=`${Math.round(settings.voiceVolume*100)}%`;$("#fpsSetting").value=String(settings.fpsCap);$("#pttSetting").checked=!!settings.pushToTalk
}
function saveSettings(){settings._v=SETTINGS_VERSION;localStorage.setItem("nullspace.settings",JSON.stringify(settings));applySettings()}

function updateSelf(s){
  if(!s)return;const oldRole=self?.role;self=s;hpEl.textContent=Math.round(self.hp??100);ammoCurrent.textContent=self.ammo??0;ammoReserve.textContent=self.reserve??0;
  weapon.visible=hasGun()&&!self.dead&&!self.escaped&&isGameplay();ammoPanel.style.opacity=hasGun()?"1":"0";roleLabel.textContent=(ROLE[self.role]||ROLE.unassigned).name;
  if(Number.isFinite(self.x)&&Number.isFinite(self.z)&&oldRole==="unassigned"&&self.role!=="unassigned"){camera.position.set(self.x,1.66,self.z);velocity.set(0,0)}
  if(self.role!==oldRole&&self.role!=="unassigned"&&round?.phase==="briefing")showBriefing(self.role);renderLobby();updateObjective()
}
function updateRound(r){
  const previous=round?.phase;round=r;if(!r)return;phaseLabel.textContent=r.phase.toUpperCase();
  if(previous==="active"&&r.phase==="extraction")audio.gateOpen();
  if(r.phase==="lobby")showLobby();
  else if(r.phase==="briefing"){lobby.hidden=true;hud.hidden=true;pauseMenu.hidden=true;if(self?.role&&self.role!=="unassigned"&&self.role!=="observer")showBriefing(self.role)}
  else if(r.phase==="active"||r.phase==="extraction"){lobby.hidden=true;hud.hidden=false;if(previous==="briefing"&&briefing.hidden&&pauseMenu.hidden&&!self?.dead)controls.lock()}
  else if(r.phase==="ended")showEnd(r.winner,r.reason);
  renderLobby();updateObjective()
}

net.onSelf=updateSelf;net.onRound=updateRound;
net.onPlayers=players=>{
  playerCount.textContent=`${players.size} OPERATIVE${players.size===1?"":"S"}`;renderLobby();voice.syncPeers();if(round?.phase==="lobby")return;
  for(const [id,p] of players){if(id===net.id)continue;let a=remotes.get(id);if(!a){a=createAvatar(p);remotes.set(id,a)}a.userData.target.set(p.x??0,0,p.z??0);a.userData.yaw=p.yaw??0;a.userData.dead=!!p.dead;a.userData.escaped=!!p.escaped;setRevealed(a,!!p.revealed)}
  for(const [id,a] of [...remotes])if(!players.has(id)){disposeAvatar(a);remotes.delete(id)}
};
net.onEvent=msg=>{
  if(msg.type==="voiceSignal"){voice.handleSignal(msg.from,msg.payload);return}
  if(msg.type==="event"){
    addFeed(msg.text||msg.kind,msg.kind==="danger"||msg.kind==="alarm");if(msg.kind==="alarm"){audio.alert();showNotice(msg.text,3000)}if(msg.kind==="start")audio.ui(true);renderLobby();return
  }
  if(msg.type==="notice"){addFeed(msg.text,true);showNotice(msg.text,1800);audio.ui(false);return}
  if(msg.type==="shot"){if(msg.id!==net.id){audio.gunshot(.5);remoteMuzzle(msg)}return}
  if(msg.type==="hit"){if(msg.target===net.id){audio.hit();damageFlash();addFeed(`TRAUMA // -${msg.damage}`,true)}if(msg.attacker===net.id)addFeed(`IMPACT // ${msg.damage}`);burstAtPlayer(msg.target);return}
  if(msg.type==="reveal"){const a=remotes.get(msg.id);if(a){setRevealed(a,true);setTimeout(()=>setRevealed(a,false),3000)}audio.anomaly();return}
  if(msg.type==="converted"){addFeed(`${msg.name} biometrics became non-human.`,true);showNotice("ASSIMILATION EVENT",2200);audio.anomaly();return}
  if(msg.type==="death"){addFeed(`${msg.name} is no longer transmitting.`,true);return}
};
net.onClose=()=>{if(connected){connected=false;voice.disable();voiceEnabled=false;leaveToMenu("Connection lost.")}};

function makeFallbackAvatar(){
  const root=new THREE.Group(),uniform=new THREE.MeshStandardMaterial({color:0x414a44,roughness:.88}),dark=new THREE.MeshStandardMaterial({color:0x171a18,roughness:.92}),skin=new THREE.MeshStandardMaterial({color:0x9e775f,roughness:.9});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.22,.55,5,8),uniform);torso.position.y=1.16;root.add(torso);const vest=new THREE.Mesh(new THREE.BoxGeometry(.52,.48,.3),dark);vest.position.set(0,1.23,0);root.add(vest);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.2,12,9),skin);head.position.y=1.72;root.add(head);const arms=[],legs=[];
  for(const side of [-1,1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.43,4,7),uniform);arm.position.set(side*.31,1.17,0);root.add(arm);arms.push(arm);const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.53,4,7),dark);leg.position.set(side*.13,.49,0);root.add(leg);legs.push(leg)}
  return{root,uniform,dark,skin,torso,vest,head,arms,legs,meshes:[torso,vest,head,...arms,...legs]}
}
function createAvatar(p){
  const g=new THREE.Group();g.userData.target=new THREE.Vector3(p.x||0,0,p.z||0);g.userData.yaw=p.yaw||0;g.userData.dead=!!p.dead;g.userData.escaped=!!p.escaped;
  const fb=makeFallbackAvatar();g.add(fb.root);const tag=makeTag(p.name||"UNKNOWN");tag.position.y=2.06;g.add(tag);const revealLight=new THREE.PointLight(0xb41c17,0,2.8,2);revealLight.position.y=1.25;g.add(revealLight);
  g.userData.visual={...fb,tag,revealLight,model:null,modelMeshes:[],mixer:null,actions:{},activeAction:null};g.position.set(p.x||0,0,p.z||0);scene.add(g);attachRealPlayerModel(g);return g
}
function findClip(clips,...terms){for(const t of terms){const c=clips.find(x=>x.name.toLowerCase().includes(t));if(c)return c}return null}
async function attachRealPlayerModel(group){
  const ok=await playerAssetReady;if(!ok||!playerAsset||!group.parent)return;
  try{
    const model=skeletonClone(playerAsset.scene);model.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;if(Array.isArray(o.material))o.material=o.material.map(m=>m.clone());else if(o.material)o.material=o.material.clone()}});
    let bounds=new THREE.Box3().setFromObject(model),size=new THREE.Vector3();bounds.getSize(size);const scale=1.77/Math.max(.01,size.y);model.scale.setScalar(scale);bounds=new THREE.Box3().setFromObject(model);model.position.y-=bounds.min.y;model.rotation.y=Math.PI;group.add(model);
    const v=group.userData.visual;v.model=model;model.traverse(o=>{if(o.isMesh)v.modelMeshes.push(o)});v.root.visible=false;
    if(playerAsset.animations?.length){
      v.mixer=new THREE.AnimationMixer(model);const clips=playerAsset.animations;
      const idle=findClip(clips,"idle")||clips[0],walk=findClip(clips,"walk"),run=findClip(clips,"run","sprint"),death=findClip(clips,"death","die"),crouch=findClip(clips,"crouch");
      for(const [name,clip] of Object.entries({idle,walk,run,death,crouch}))if(clip){const action=v.mixer.clipAction(clip);action.enabled=true;action.clampWhenFinished=name==="death";if(name==="death")action.loop=THREE.LoopOnce;v.actions[name]=action}
      setAvatarAction(group,"idle",0)
    }
  }catch(err){console.warn("Failed to attach player model",err)}
}
function setAvatarAction(a,name,fade=.16){
  const v=a.userData.visual,action=v?.actions?.[name]||v?.actions?.idle;if(!action||v.activeAction===action)return;
  const old=v.activeAction;action.reset().fadeIn(fade).play();if(old)old.fadeOut(fade);v.activeAction=action
}
function makeTag(text){
  const c=document.createElement("canvas");c.width=512;c.height=96;const ctx=c.getContext("2d");ctx.font="650 28px ui-monospace, monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="rgba(237,235,216,.86)";ctx.fillText(text.slice(0,18),256,48);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:true,depthWrite:false,opacity:.72}));s.scale.set(1.5,.28,1);return s
}
function setRevealed(a,on){
  const v=a.userData.visual;if(!v)return;v.revealLight.intensity=on?2.5:0;v.tag.material.opacity=on?.2:.7;
  for(const mesh of v.modelMeshes||[]){const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const m of mats){if(!m||!("emissive" in m))continue;if(!m.userData._baseEmissive){m.userData._baseEmissive=m.emissive.clone();m.userData._baseEI=m.emissiveIntensity||0}if(on){m.emissive.setHex(0x48100d);m.emissiveIntensity=.65}else{m.emissive.copy(m.userData._baseEmissive);m.emissiveIntensity=m.userData._baseEI}}}
  if(!v.model){v.torso.material.color.setHex(on?0x62201d:0x414a44);v.head.material.color.setHex(on?0x6e201d:0x9e775f)}
}
function disposeAvatar(a){const v=a.userData.visual;if(v?.mixer)v.mixer.stopAllAction();scene.remove(a)}
function clearRemotes(){for(const a of remotes.values())disposeAvatar(a);remotes.clear()}

function renderLobby(){
  if(!connected||round?.phase!=="lobby")return;$("#lobbyCode").textContent=net.room||"-----";const host=net.players.get(round?.hostId);$("#lobbyHostBadge").textContent=`HOST: ${host?.name||"---"}`;
  const list=$("#lobbyPlayers");list.innerHTML="";const sorted=[...net.players.values()].sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0));
  for(const p of sorted){const row=document.createElement("div");row.className="playerRow";row.innerHTML=`<span class="playerName">${escapeHtml(p.name)}</span><span class="${p.id===round.hostId?"hostTag":""}">${p.id===round.hostId?"HOST":""}</span><span class="${p.ready?"readyTag":"notReadyTag"}">${p.ready?"READY":"NOT READY"}</span>`;list.appendChild(row)}
  const mine=net.players.get(net.id)||self;$("#readyBtn").textContent=mine?.ready?"UNREADY":"READY";$("#readyBtn").classList.toggle("primary",!mine?.ready);$("#startBtn").style.display=isHost()?"block":"none";
  const allReady=sorted.length>=2&&sorted.every(p=>p.ready);$("#startBtn").disabled=!allReady;$("#lobbyStatus").textContent=sorted.length<2?"Need at least 2 operatives.":allReady?(isHost()?"Everyone ready. Start when you are.":"Everyone ready. Waiting for host."):`${sorted.filter(p=>p.ready).length}/${sorted.length} ready.`
}
function escapeHtml(v){const d=document.createElement("div");d.textContent=String(v||"");return d.innerHTML}
function showLobby(){controls.unlock();menu.style.display="none";lobby.hidden=false;briefing.hidden=true;pauseMenu.hidden=true;settingsPanel.hidden=true;endScreen.hidden=true;hud.hidden=true;clearRemotes();renderLobby()}
function showBriefing(role){const r=ROLE[role]||ROLE.unassigned;briefRole.textContent=r.name;briefText.textContent=r.brief;briefLoadout.textContent=r.loadout;briefing.hidden=false;lobby.hidden=true;pauseMenu.hidden=true;hud.hidden=true;controls.unlock();audio.ui(role!=="anomaly")}
function showEnd(winner,reason){controls.unlock();pauseMenu.hidden=true;briefing.hidden=true;hud.hidden=true;lobby.hidden=true;endScreen.hidden=false;endTitle.textContent=winner==="humans"?"CONTAINMENT RESTORED":"CONTAINMENT FAILURE";endText.textContent=reason||"Incident concluded.";$("#endLobbyBtn").style.display=isHost()?"block":"none";$("#endWait").textContent=isHost()?"Return everyone to the lobby when ready.":"Waiting for lobby leader to return the team.";audio.alert()}
function updateObjective(){
  if(!self){objectiveLabel.textContent="Awaiting identity verification.";return}if(self.dead){objectiveLabel.textContent="No pulse. Observe remaining incident traffic.";return}if(self.escaped){objectiveLabel.textContent="Across the Threshold. Await incident resolution.";return}
  if(self.role==="anomaly"){objectiveLabel.textContent=round?.phase==="extraction"?"Escape through the Threshold or assimilate the survivors.":"Blend in. Q attacks or assimilates a nearby weakened human.";return}
  if(round?.phase==="active")objectiveLabel.textContent=round.keycardTaken?(self.hasKeycard?"Bring the keycard to Threshold control.":"Stay with the keycard carrier. Watch everyone."):"Find the Threshold Keycard somewhere in Level 0.";
  else if(round?.phase==="extraction")objectiveLabel.textContent=self.role==="quarantine"?"Stop anomalous escape. Cross or seal the Threshold.":"Reach the Threshold. Do not bring the Mimic with you.";else objectiveLabel.textContent="Stand by."
}
function addFeed(text,danger=false){if(!text)return;const e=document.createElement("div");e.className=`feedItem${danger?" danger":""}`;e.textContent=text;feed.prepend(e);setTimeout(()=>e.remove(),5000)}
function showNotice(text,ms=1600){centerNotice.textContent=text;centerNotice.hidden=false;clearTimeout(showNotice.t);showNotice.t=setTimeout(()=>centerNotice.hidden=true,ms)}
function damageFlash(){hud.classList.add("damage");setTimeout(()=>hud.classList.remove("damage"),140)}

const particles=[];
function burstAtPlayer(id){
  const a=id===net.id?camera:remotes.get(id);if(!a)return;const pos=new THREE.Vector3();a.getWorldPosition(pos);pos.y=id===net.id?1.45:1.05;
  for(let i=0;i<7;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.018+Math.random()*.014,4,3),new THREE.MeshBasicMaterial({color:0x631714}));m.position.copy(pos);m.userData.vel=new THREE.Vector3((Math.random()-.5)*1.8,.2+Math.random()*1.05,(Math.random()-.5)*1.8);m.userData.life=.35+Math.random()*.45;scene.add(m);particles.push(m)}
}
function updateParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.userData.life-=dt;p.userData.vel.y-=4.1*dt;p.position.addScaledVector(p.userData.vel,dt);if(p.userData.life<=0){scene.remove(p);p.geometry.dispose();p.material.dispose();particles.splice(i,1)}}}
function createTracer(origin,dir){const end=origin.clone().add(dir.clone().normalize().multiplyScalar(10)),geo=new THREE.BufferGeometry().setFromPoints([origin,end]),mat=new THREE.LineBasicMaterial({color:0xf0cf77,transparent:true,opacity:.36});const line=new THREE.Line(geo,mat);scene.add(line);setTimeout(()=>{scene.remove(line);geo.dispose();mat.dispose()},42)}
function remoteMuzzle(msg){const p=new THREE.Vector3(msg.x||0,1.35,msg.z||0),l=new THREE.PointLight(0xffb95f,4.2,3,2);l.position.copy(p);scene.add(l);setTimeout(()=>scene.remove(l),38);createTracer(p,new THREE.Vector3(msg.dx||0,0,msg.dz||-1))}
function localShoot(){
  if(!isGameplay()||!self||self.dead||self.escaped||!hasGun())return;if((self.ammo??0)<=0){audio.dryfire();return}
  const dir=new THREE.Vector3();camera.getWorldDirection(dir);net.shoot({x:camera.position.x,y:camera.position.y,z:camera.position.z},{x:dir.x,y:dir.y,z:dir.z});audio.gunshot();recoil=Math.min(.19,recoil+.105);muzzleLight.intensity=8;setTimeout(()=>muzzleLight.intensity=0,36);createTracer(camera.position.clone(),dir);
  crosshair.classList.add("kick");setTimeout(()=>crosshair.classList.remove("kick"),80)
}
function reload(){if(isGameplay()&&self&&hasGun()&&!self.dead&&!self.escaped){net.reload();audio.reload()}}
function useAbility(){if(isGameplay()&&self?.role==="anomaly"&&!self.dead&&!self.escaped){net.ability();audio.anomaly()}}
function toggleFlashlight(){flashlightOn=!flashlightOn;flashlight.visible=flashlightFill.visible=flashlightOn;audio.flashlight(flashlightOn)}

const handledKeys=new Set(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","ControlLeft","ControlRight","KeyF","KeyE","KeyQ","KeyR","KeyV"]);
window.addEventListener("keydown",e=>{
  if(controls.isLocked&&handledKeys.has(e.code))e.preventDefault();if(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","ControlLeft","ControlRight"].includes(e.code))keys.add(e.code);
  if(e.code==="KeyV"&&settings.pushToTalk){voice.setTalking(true);$("#voiceIndicator").hidden=false}if(e.repeat)return;
  if(e.code==="KeyR")reload();if(e.code==="KeyF")toggleFlashlight();if(e.code==="KeyQ")useAbility();if(e.code==="KeyE"&&currentInteraction){audio.interact();net.interact(currentInteraction.kind)}
},{passive:false});
window.addEventListener("keyup",e=>{keys.delete(e.code);if(e.code==="KeyV"&&settings.pushToTalk){voice.setTalking(false);$("#voiceIndicator").hidden=true}});window.addEventListener("blur",()=>keys.clear());
document.addEventListener("pointermove",e=>{if(!controls.isLocked)return;mouseSwayX=THREE.MathUtils.clamp(mouseSwayX+e.movementX*.00042,-.045,.045);mouseSwayY=THREE.MathUtils.clamp(mouseSwayY+e.movementY*.00034,-.035,.035)});
document.addEventListener("mousedown",e=>{if(e.button===0&&controls.isLocked)localShoot()});document.addEventListener("contextmenu",e=>{if(controls.isLocked)e.preventDefault()});
controls.addEventListener("lock",()=>{audio.ensure();pauseMenu.hidden=true;hud.hidden=false});controls.addEventListener("unlock",()=>{keys.clear();velocity.multiplyScalar(.2);if(connected&&isGameplay()&&briefing.hidden&&endScreen.hidden&&settingsPanel.hidden){pauseMenu.hidden=false;hud.hidden=true}});
canvas.addEventListener("click",()=>{if(connected&&isGameplay()&&briefing.hidden&&pauseMenu.hidden&&settingsPanel.hidden&&!self?.dead)controls.lock()});

function randomRoom(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let out="";for(let i=0;i<5;i++)out+=alphabet[Math.floor(Math.random()*alphabet.length)];return out}
async function join(room){
  const name=$("#nameInput").value.trim()||"wanderer",base=$("#workerInput").value.trim()||"https://nullspace.bmgames182.workers.dev";statusEl.textContent="Establishing incident link…";
  try{await net.connect(base,room,name);connected=true;roomLabel.textContent=room;statusEl.textContent="Incident link established.";menu.style.display="none";if(net.round?.phase==="lobby")showLobby()}catch(err){statusEl.textContent=`Connection failed: ${err?.message||"Worker unavailable"}`}
}
function leaveToMenu(message="Terminal ready."){connected=false;net.disconnect();clearRemotes();controls.unlock();lobby.hidden=true;briefing.hidden=true;pauseMenu.hidden=true;settingsPanel.hidden=true;endScreen.hidden=true;hud.hidden=true;menu.style.display="grid";statusEl.textContent=message;self=null;round=null;velocity.set(0,0)}
$("#createBtn").addEventListener("click",()=>{const r=randomRoom();$("#roomInput").value=r;join(r)});$("#joinBtn").addEventListener("click",()=>{const r=$("#roomInput").value.trim().toUpperCase();if(!r){statusEl.textContent="Enter an incident code.";return}join(r)});
$("#readyBtn").addEventListener("click",()=>{const mine=net.players.get(net.id)||self;net.setReady(!mine?.ready)});$("#startBtn").addEventListener("click",()=>net.startRound());$("#leaveLobbyBtn").addEventListener("click",()=>leaveToMenu());
$("#copyCodeBtn").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(net.room||"");$("#lobbyStatus").textContent="Incident code copied."}catch{}});
$("#briefDismiss").addEventListener("click",()=>{briefing.hidden=true;if(round?.phase==="active"&&!self?.dead)controls.lock();else showNotice("Deployment begins when countdown ends.",1800)});$("#resumeBtn").addEventListener("click",()=>controls.lock());$("#leaveMatchBtn").addEventListener("click",()=>leaveToMenu());$("#endLobbyBtn").addEventListener("click",()=>net.returnLobby());
async function toggleVoice(){if(voiceEnabled){voice.disable();voiceEnabled=false;$("#voiceBtn").textContent="ENABLE PROXIMITY VOICE";$("#voiceState").textContent="Voice is off.";return}try{await voice.enable();voiceEnabled=true;$("#voiceBtn").textContent="DISABLE PROXIMITY VOICE";$("#voiceState").textContent=settings.pushToTalk?"Voice enabled. Hold V to talk.":"Voice enabled. Nearby players can hear you.";audio.ui(true)}catch{$("#voiceState").textContent="Microphone permission was denied or unavailable.";audio.ui(false)}}
$("#voiceBtn").addEventListener("click",toggleVoice);
function openSettings(from){openingSettingsFrom=from;settingsPanel.hidden=false;if(from==="pause")pauseMenu.hidden=true}function closeSettings(){settingsPanel.hidden=true;if(openingSettingsFrom==="pause"&&connected&&isGameplay())pauseMenu.hidden=false}
$("#menuSettingsBtn").addEventListener("click",()=>openSettings("menu"));$("#pauseSettingsBtn").addEventListener("click",()=>openSettings("pause"));$("#closeSettingsBtn").addEventListener("click",closeSettings);
for(const [id,key,parse] of [["sensitivitySetting","sensitivity",Number],["fovSetting","fov",Number],["renderSetting","renderScale",Number],["brightnessSetting","brightness",Number],["volumeSetting","volume",Number],["voiceVolumeSetting","voiceVolume",Number],["fpsSetting","fpsCap",Number]])$("#"+id).addEventListener("input",e=>{settings[key]=parse(e.target.value);saveSettings()});
$("#pttSetting").addEventListener("change",e=>{settings.pushToTalk=e.target.checked;voice.setTalking(false);saveSettings();if(voiceEnabled)$("#voiceState").textContent=settings.pushToTalk?"Voice enabled. Hold V to talk.":"Voice enabled. Nearby players can hear you."});
const queryWorker=new URLSearchParams(location.search).get("worker");if(queryWorker)$("#workerInput").value=queryWorker;
function resize(){const w=innerWidth,h=innerHeight;renderer.setPixelRatio(Math.min(devicePixelRatio*Math.max(.55,Number(settings.renderScale)||.92),1.65));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener("resize",resize);

function updateMovement(dt){
  const active=controls.isLocked&&self&&!self.dead&&!self.escaped&&isGameplay();
  if(!active){velocity.x=damp(velocity.x,0,14,dt);velocity.y=damp(velocity.y,0,14,dt);camera.fov=damp(camera.fov,Number(settings.fov),9,dt);camera.updateProjectionMatrix();lastMoving=false;crosshair.classList.remove("moving");return}
  const f=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0),s=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0),moving=!!(f||s),crouch=keys.has("ControlLeft")||keys.has("ControlRight"),sprint=(keys.has("ShiftLeft")||keys.has("ShiftRight"))&&f>0&&!crouch&&stamina>1;
  const speed=crouch?1.95:sprint?6.15:3.75;if(sprint&&moving)stamina=Math.max(0,stamina-dt*17);else stamina=Math.min(100,stamina+dt*(moving?9:14));staminaEl.textContent=Math.round(stamina);
  camera.getWorldDirection(moveForward);moveForward.y=0;if(moveForward.lengthSq()<.001)moveForward.set(0,0,-1);moveForward.normalize();moveRight.set(moveForward.z,0,-moveForward.x);moveVector.copy(moveForward).multiplyScalar(f).addScaledVector(moveRight,s);if(moveVector.lengthSq()>1)moveVector.normalize();
  const targetX=moveVector.x*speed,targetZ=moveVector.z*speed,response=moving?(sprint?9.5:13):18;velocity.x=damp(velocity.x,targetX,response,dt);velocity.y=damp(velocity.y,targetZ,response,dt);
  const oldX=camera.position.x,oldZ=camera.position.z;desiredPosition.copy(camera.position);desiredPosition.x+=velocity.x*dt;desiredPosition.z+=velocity.y*dt;const resolved=resolveMovement(camera.position,desiredPosition,world.colliders,.245);camera.position.x=resolved.x;camera.position.z=resolved.z;
  const mx=camera.position.x-oldX,mz=camera.position.z-oldZ,moved=Math.hypot(mx,mz);if(Math.abs(mx)<Math.abs(velocity.x*dt)*.12)velocity.x*=.3;if(Math.abs(mz)<Math.abs(velocity.y*dt)*.12)velocity.y*=.3;
  if(moved>.0001){walkPhase+=moved*(crouch?2.15:sprint?3.05:2.65);stepTravel+=moved;const stride=crouch?1.05:sprint?.82:.92;if(stepTravel>=stride){stepTravel%=stride;audio.step(sprint,crouch)}}
  const movementFactor=Math.min(1,moved/Math.max(.001,dt)/3.8),baseY=crouch?1.18:1.66,bobY=Math.sin(walkPhase*2)*.022*movementFactor*(sprint?1.35:1),breath=Math.sin(performance.now()*.00155)*.0025;
  camera.position.y=damp(camera.position.y,baseY+bobY+breath,15,dt);camera.fov=damp(camera.fov,Number(settings.fov)+(sprint&&moving?3.5:0),7.5,dt);camera.updateProjectionMatrix();lastMoving=moving;crosshair.classList.toggle("moving",moving)
}
function updateWeapon(dt){
  recoil=damp(recoil,0,15,dt);mouseSwayX=damp(mouseSwayX,0,11,dt);mouseSwayY=damp(mouseSwayY,0,11,dt);
  const movingAmount=lastMoving?1:0,bx=Math.cos(walkPhase)*.013*movingAmount,by=Math.abs(Math.sin(walkPhase))*.011*movingAmount;
  viewmodel.position.x=damp(viewmodel.position.x,.29+bx-mouseSwayX,15,dt);viewmodel.position.y=damp(viewmodel.position.y,-.235-by+mouseSwayY,15,dt);viewmodel.position.z=damp(viewmodel.position.z,-.56+recoil*.22,16,dt);
  viewmodel.rotation.x=damp(viewmodel.rotation.x,-recoil*.85+mouseSwayY*.7,16,dt);viewmodel.rotation.y=damp(viewmodel.rotation.y,-mouseSwayX*.9,13,dt);viewmodel.rotation.z=damp(viewmodel.rotation.z,keys.has("KeyA")?.018:keys.has("KeyD")?-.018:0,10,dt)
}
function updateRemoteAnimations(dt,now){
  for(const a of remotes.values()){
    const d=a.position.distanceTo(a.userData.target),speed=d/Math.max(dt,.001);a.position.lerp(a.userData.target,Math.min(1,dt*12));let dy=((a.userData.yaw||0)-a.rotation.y+Math.PI)%(Math.PI*2)-Math.PI;a.rotation.y+=dy*Math.min(1,dt*11);
    const v=a.userData.visual;if(!v)continue;const distToCamera=a.position.distanceTo(camera.position);v.tag.material.opacity=THREE.MathUtils.clamp(1-distToCamera/22,.15,.68);v.tag.scale.setScalar(THREE.MathUtils.clamp(distToCamera*.02+.72,.72,1.08));v.tag.scale.y=v.tag.scale.x*.19;
    if(v.mixer){
      v.mixer.update(dt);
      if(a.userData.dead){if(v.actions.death)setAvatarAction(a,"death",.08);else if(v.model)v.model.rotation.z=damp(v.model.rotation.z,-1.35,7,dt)}
      else{if(speed>4)setAvatarAction(a,"run");else if(speed>.35)setAvatarAction(a,"walk");else setAvatarAction(a,"idle");if(v.model)v.model.rotation.z=damp(v.model.rotation.z,0,8,dt)}
    }else{const phase=now*.008+a.position.x+a.position.z,amp=Math.min(.55,speed*.04);v.arms[0].rotation.x=Math.sin(phase)*amp;v.arms[1].rotation.x=-Math.sin(phase)*amp;v.legs[0].rotation.x=-Math.sin(phase)*amp;v.legs[1].rotation.x=Math.sin(phase)*amp;v.root.rotation.z=damp(v.root.rotation.z,a.userData.dead?-1.35:0,7,dt)}
    const sink=a.userData.dead&&(!v.mixer||!v.actions.death)?-.6:0;a.position.y=damp(a.position.y,sink,8,dt);a.visible=!a.userData.escaped
  }
}
function updateTimer(){if(!round){timerEl.textContent="--:--";return}let ms=0;if(round.phase==="briefing")ms=Math.max(0,round.startsAt-Date.now());else if(round.phase==="extraction")ms=Math.max(0,round.extractionEndsAt-Date.now());else if(round.startedAt)ms=Math.max(0,Date.now()-round.startedAt);const total=Math.floor(ms/1000);timerEl.textContent=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`}

function tick(now){
  requestAnimationFrame(tick);const cap=Number(settings.fpsCap)||0;if(cap&&now-lastRender<1000/cap)return;lastRender=now;const dt=Math.min(.04,(now-last)/1000||.016);last=now;
  updateMovement(dt);updateWeapon(dt);updateRemoteAnimations(dt,now);updateParticles(dt);world.update(now,round);updateTimer();voice.update(now);audio.update(now);
  currentInteraction=controls.isLocked?nearestInteraction(camera.position,round,self):null;interactionEl.hidden=!currentInteraction;if(currentInteraction)interactionEl.textContent=`[ E ] ${currentInteraction.label}`;
  if(connected&&controls.isLocked&&self&&!self.dead&&!self.escaped&&isGameplay()&&now-lastSend>90){const e=new THREE.Euler().setFromQuaternion(camera.quaternion,"YXZ");net.sendState({x:camera.position.x,z:camera.position.z,yaw:e.y,pitch:e.x});lastSend=now}
  renderer.render(scene,camera)
}
applySettings();requestAnimationFrame(tick);
