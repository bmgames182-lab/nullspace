import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { NetClient } from "./network.js";

const canvas = document.querySelector("#game");
const menu = document.querySelector("#menu");
const hud = document.querySelector("#hud");
const statusEl = document.querySelector("#status");
const roomLabel = document.querySelector("#roomLabel");
const playerCount = document.querySelector("#playerCount");
const feed = document.querySelector("#feed");
const ammoEl = document.querySelector("#ammo");
const hpEl = document.querySelector("#hp");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111107);
scene.fog = new THREE.FogExp2(0x5d5a32, 0.018);

const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 180);
camera.position.set(0, 1.65, 4);

const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = 0.85;

const hemi = new THREE.HemisphereLight(0xb9ae62, 0x1a170a, 0.7);
scene.add(hemi);

const floorMat = new THREE.MeshStandardMaterial({ color: 0x7b7040, roughness: .93 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0xb9af64, roughness: .9 });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x8b8452, roughness: .95 });

function box(x,y,z,w,h,d,mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(x,y,z); m.receiveShadow = true; m.castShadow = true; scene.add(m); return m;
}

box(0,-.08,0,90,.16,90,floorMat);
box(0,3.22,0,90,.16,90,ceilingMat);

const maze = [
  [-14,1.5,0,.35,3,24],[14,1.5,0,.35,3,24],
  [0,1.5,-12,28,3,.35],[0,1.5,12,28,3,.35],
  [-8,1.5,-7,.35,3,10],[-8,1.5,7,.35,3,10],
  [8,1.5,-7,.35,3,10],[8,1.5,7,.35,3,10],
  [0,1.5,-5,10,3,.35],[0,1.5,5,10,3,.35],
  [-3,1.5,0,.35,3,6],[4,1.5,0,.35,3,6]
];
maze.forEach(v => box(...v, wallMat));

for (const [x,z] of [[-9,-9],[0,-9],[9,-9],[-9,0],[0,0],[9,0],[-9,9],[0,9],[9,9]]) {
  const light = new THREE.PointLight(0xe8df9a, 17, 17, 2);
  light.position.set(x, 2.95, z);
  scene.add(light);
  const fixture = box(x,3.05,z,2.8,.04,.28,new THREE.MeshBasicMaterial({color:0xf4ecb3}));
  fixture.castShadow = false;
}

const weapon = new THREE.Group();
camera.add(weapon); scene.add(camera);
const gunMat = new THREE.MeshStandardMaterial({color:0x171817,roughness:.5,metalness:.35});
const gun = new THREE.Mesh(new THREE.BoxGeometry(.16,.18,.72),gunMat);
gun.position.set(.32,-.29,-.65); gun.rotation.x = -.04; weapon.add(gun);
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.35,10),gunMat);
barrel.rotation.x = Math.PI/2; barrel.position.set(.32,-.25,-1.08); weapon.add(barrel);

const keys = new Set();
let last = performance.now();
let lastSend = 0;
let ammo = 12, reserve = 48, hp = 100, canShoot = true;

window.addEventListener("keydown", e => {
  keys.add(e.code);
  if (e.code === "KeyR") reload();
});
window.addEventListener("keyup", e => keys.delete(e.code));

document.addEventListener("mousedown", e => {
  if (e.button === 0 && controls.isLocked) shoot();
});

controls.addEventListener("lock", () => { menu.style.display = "none"; hud.hidden = false; });
controls.addEventListener("unlock", () => { menu.style.display = "grid"; });

const net = new NetClient();
const remotes = new Map();

function remoteAvatar(p) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32,.82,6,10), new THREE.MeshStandardMaterial({color:0x4c514d,roughness:.8}));
  body.position.y = 1.0; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.24,12,8), new THREE.MeshStandardMaterial({color:0xc6a27b,roughness:.9}));
  head.position.y = 1.72; head.castShadow = true; g.add(head);
  const tag = makeTag(p.name || "unknown"); tag.position.y = 2.15; g.add(tag);
  scene.add(g); return g;
}

function makeTag(text) {
  const c = document.createElement("canvas"); c.width=512;c.height=96;
  const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.font="600 42px sans-serif";ctx.textAlign="center";ctx.fillStyle="white";ctx.fillText(text,256,58);
  const t=new THREE.CanvasTexture(c); const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false})); s.scale.set(2.5,.47,1); return s;
}

net.onPlayers = players => {
  playerCount.textContent = `${players.size} PLAYER${players.size===1?"":"S"}`;
  for (const [id,p] of players) {
    if (id === net.id) continue;
    if (!remotes.has(id)) remotes.set(id, remoteAvatar(p));
    const g = remotes.get(id);
    if (p.x != null) {
      g.userData.target = new THREE.Vector3(p.x,0,p.z);
      g.userData.yaw = p.yaw || 0;
    }
  }
  for (const [id,g] of remotes) {
    if (!players.has(id)) { scene.remove(g); remotes.delete(id); }
  }
};
net.onEvent = msg => {
  if (msg.type === "shot") addFeed(`${msg.name || "someone"} fired`);
  if (msg.type === "hit" && msg.target === net.id) {
    hp = Math.max(0, hp - (msg.damage || 20)); hpEl.textContent = hp;
    addFeed(`You were hit for ${msg.damage || 20}`);
  }
  if (msg.type === "join") addFeed(`${msg.name} entered`);
  if (msg.type === "leave") addFeed(`${msg.name} disappeared`);
};

function addFeed(text) {
  const el=document.createElement("div");el.className="feedItem";el.textContent=text;feed.prepend(el);
  setTimeout(()=>el.remove(),4000);
}

function reload() {
  if (ammo===12 || reserve<=0) return;
  const need=12-ammo, take=Math.min(need,reserve);ammo+=take;reserve-=take; updateAmmo();
}
function updateAmmo(){ ammoEl.textContent=`${ammo} / ${reserve}`; }

function shoot() {
  if (!canShoot || ammo<=0) return;
  canShoot=false; ammo--; updateAmmo();
  gun.position.z += .08; setTimeout(()=>gun.position.z-=.08,55);
  const dir=new THREE.Vector3();camera.getWorldDirection(dir);
  net.shoot({x:camera.position.x,y:camera.position.y,z:camera.position.z,dx:dir.x,dy:dir.y,dz:dir.z});
  const ray=new THREE.Ray(camera.position.clone(),dir);
  let best=null,bestD=999;
  for (const [id,g] of remotes) {
    const sphere=new THREE.Sphere(g.position.clone().add(new THREE.Vector3(0,1,0)),.75);
    const hit=new THREE.Vector3();
    if(ray.intersectSphere(sphere,hit)){
      const d=hit.distanceTo(camera.position);
      if(d<bestD){bestD=d;best=id;}
    }
  }
  if(best) net.send("claimHit",{target:best,damage:25});
  setTimeout(()=>canShoot=true,140);
}

function randomRoom(){ return Math.random().toString(36).slice(2,7).toUpperCase(); }

async function join(room) {
  const name=document.querySelector("#nameInput").value.trim() || "wanderer";
  const base=document.querySelector("#workerInput").value.trim();
  if(!base){statusEl.textContent="Enter Worker URL.";return;}
  statusEl.textContent="Connecting...";
  try{
    await net.connect(base,room,name);
    roomLabel.textContent=`ROOM ${room}`;
    statusEl.textContent="Connected. Click the game to enter.";
    controls.lock();
  }catch(e){statusEl.textContent="Connection failed. Is the Worker running?";}
}
document.querySelector("#createBtn").addEventListener("click",()=>{const r=randomRoom();document.querySelector("#roomInput").value=r;join(r);});
document.querySelector("#joinBtn").addEventListener("click",()=>{const r=document.querySelector("#roomInput").value.trim().toUpperCase();if(r)join(r);else statusEl.textContent="Enter a room code.";});
canvas.addEventListener("click",()=>{if(net.ws?.readyState===1)controls.lock();});

function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener("resize",resize);resize();

function tick(now){
  requestAnimationFrame(tick);
  const dt=Math.min((now-last)/1000,.04);last=now;
  if(controls.isLocked){
    const f=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0);
    const s=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0);
    const speed=keys.has("ShiftLeft")?5.8:3.5;
    const forward=new THREE.Vector3();camera.getWorldDirection(forward);forward.y=0;forward.normalize();
    const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).negate();
    const move=forward.multiplyScalar(f).add(right.multiplyScalar(s));
    if(move.lengthSq()>0)move.normalize().multiplyScalar(speed*dt);
    camera.position.add(move);
    camera.position.x=THREE.MathUtils.clamp(camera.position.x,-13.3,13.3);
    camera.position.z=THREE.MathUtils.clamp(camera.position.z,-11.3,11.3);
    camera.position.y=1.65 + Math.sin(now*.012)*(move.lengthSq()>0?.025:0);
    weapon.rotation.z = THREE.MathUtils.lerp(weapon.rotation.z, -s*.035, .12);
    if(now-lastSend>70){
      const e=new THREE.Euler().setFromQuaternion(camera.quaternion,"YXZ");
      net.sendState({x:camera.position.x,z:camera.position.z,yaw:e.y,pitch:e.x,hp});
      lastSend=now;
    }
  }
  for(const g of remotes.values()){
    if(g.userData.target)g.position.lerp(g.userData.target,Math.min(1,dt*12));
    if(g.userData.yaw!=null)g.rotation.y=THREE.MathUtils.lerp(g.rotation.y,g.userData.yaw,Math.min(1,dt*10));
  }
  renderer.render(scene,camera);
}
requestAnimationFrame(tick);
