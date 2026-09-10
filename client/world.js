import * as THREE from "three";

export const WORLD = Object.freeze({
  KEYCARD:new THREE.Vector3(-16,0,14),
  TERMINAL:new THREE.Vector3(14,0,13),
  GATE:new THREE.Vector3(17,0,-14),
  SEAL:new THREE.Vector3(12.5,0,-14),
  ARMORY:new THREE.Vector3(-17,0,-4),
  MED:new THREE.Vector3(4,0,-17),
  HUMAN_SPAWN:new THREE.Vector3(-14,0,-14),
  ANOMALY_SPAWN:new THREE.Vector3(14,0,14)
});

function seeded(seedText){
  let s=2166136261>>>0;
  for(let i=0;i<seedText.length;i++){s^=seedText.charCodeAt(i);s=Math.imul(s,16777619)}
  return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}
}

function canvasTexture(draw,size=256){
  const c=document.createElement("canvas");c.width=c.height=size;
  const ctx=c.getContext("2d");draw(ctx,size);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=4;return t
}
function wallpaperTexture(rand){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#b7aa63";ctx.fillRect(0,0,s,s);
    for(let x=0;x<s;x+=30){ctx.fillStyle="rgba(85,74,32,.10)";ctx.fillRect(x,0,2,s)}
    for(let i=0;i<260;i++){
      const a=.025+rand()*.07;ctx.fillStyle=`rgba(55,49,24,${a})`;
      const x=rand()*s,y=rand()*s;ctx.fillRect(x,y,1+rand()*10,1+rand()*4)
    }
    for(let i=0;i<14;i++){
      const x=rand()*s,y=rand()*s,r=5+rand()*24;
      const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,"rgba(64,55,22,.15)");g.addColorStop(1,"rgba(64,55,22,0)");
      ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2)
    }
  })
}
function carpetTexture(rand){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#777044";ctx.fillRect(0,0,s,s);
    for(let i=0;i<3800;i++){
      const v=60+Math.floor(rand()*58);ctx.fillStyle=`rgba(${v},${Math.max(35,v-8)},${Math.max(18,v-42)},.14)`;
      ctx.fillRect(rand()*s,rand()*s,1,1)
    }
    for(let y=0;y<s;y+=24){ctx.strokeStyle="rgba(39,35,20,.10)";ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(s,y);ctx.stroke()}
  })
}
function ceilingTexture(){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#c7c4a9";ctx.fillRect(0,0,s,s);ctx.strokeStyle="rgba(70,70,58,.35)";ctx.lineWidth=2;
    for(let i=0;i<=s;i+=64){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,s);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(s,i);ctx.stroke()}
    for(let i=0;i<70;i++){ctx.fillStyle="rgba(92,84,47,.035)";ctx.fillRect(Math.random()*s,Math.random()*s,2+Math.random()*10,1+Math.random()*5)}
  })
}
function signTexture(text,accent="#d4c071"){
  const c=document.createElement("canvas");c.width=768;c.height=128;const ctx=c.getContext("2d");
  ctx.fillStyle="#10110c";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle=accent;ctx.lineWidth=4;ctx.strokeRect(5,5,c.width-10,c.height-10);
  ctx.fillStyle="#eeeacb";ctx.font="700 40px monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,384,64);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex
}

export function createWorld(scene,seed="NULL"){
  const rand=seeded(seed),colliders=[],objects={},flickers=[],geoCache=new Map();
  let lastLightUpdate=0;
  scene.background=new THREE.Color(0x242314);
  scene.fog=new THREE.FogExp2(0x625c35,.0145);

  const wallTex=wallpaperTexture(rand);wallTex.repeat.set(2.5,1.15);
  const carpetTex=carpetTexture(rand);carpetTex.repeat.set(9,9);
  const ceilingTex=ceilingTexture();ceilingTex.repeat.set(6,6);
  const wallMat=new THREE.MeshLambertMaterial({map:wallTex,color:0xd9cf8b});
  const lowerWallMat=new THREE.MeshLambertMaterial({color:0x55543c});
  const carpetMat=new THREE.MeshLambertMaterial({map:carpetTex,color:0xa79f68});
  const ceilingMat=new THREE.MeshLambertMaterial({map:ceilingTex,color:0xceccb2});
  const metalMat=new THREE.MeshStandardMaterial({color:0x303833,roughness:.57,metalness:.42});
  const darkMat=new THREE.MeshLambertMaterial({color:0x171914});
  const glassMat=new THREE.MeshBasicMaterial({color:0x85a096,transparent:true,opacity:.12,depthWrite:false});
  const amberMat=new THREE.MeshStandardMaterial({color:0xb99e3f,emissive:0x5d4611,emissiveIntensity:1.25,roughness:.45});
  const greenMat=new THREE.MeshStandardMaterial({color:0x658e77,emissive:0x244c37,emissiveIntensity:1.2});
  const redMat=new THREE.MeshStandardMaterial({color:0x8b3430,emissive:0x4a1110,emissiveIntensity:1.1});
  const blackMat=new THREE.MeshBasicMaterial({color:0x080907});

  scene.add(new THREE.HemisphereLight(0xfff5c3,0x49452c,1.12));
  scene.add(new THREE.AmbientLight(0xb8ad74,.56));

  function geo(w,h,d){const key=`${w}|${h}|${d}`;let g=geoCache.get(key);if(!g){g=new THREE.BoxGeometry(w,h,d);geoCache.set(key,g)}return g}
  function box(x,y,z,w,h,d,mat,collide=false){
    const m=new THREE.Mesh(geo(w,h,d),mat);m.position.set(x,y,z);m.castShadow=false;m.receiveShadow=false;scene.add(m);
    if(collide)colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});return m
  }
  function sign(x,y,z,text,accent="#d4c071",scale=3.8){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:signTexture(text,accent),transparent:true,depthTest:true,depthWrite:false}));
    s.scale.set(scale,scale/6,1);s.position.set(x,y,z);scene.add(s);return s
  }
  function beacon(x,y,z,color,intensity=5,distance=4){const l=new THREE.PointLight(color,intensity,distance,2);l.position.set(x,y,z);scene.add(l);return l}

  box(0,-.09,0,42,.18,42,carpetMat);
  box(0,3.28,0,42,.16,42,ceilingMat);

  // Modular Level 0 maze. Wide enough for smooth two-player passing and full of loops instead of dead square rooms.
  const walls=[
    [0,1.55,-20.5,41,3.1,.5],[0,1.55,20.5,41,3.1,.5],[-20.5,1.55,0,.5,3.1,41],[20.5,1.55,0,.5,3.1,41],
    [-10,1.55,-15,.38,3.1,10],[-10,1.55,3,.38,3.1,15],[-10,1.55,16,.38,3.1,7],
    [10,1.55,-13,.38,3.1,15],[10,1.55,4,.38,3.1,11],[10,1.55,16,.38,3.1,7],
    [-15,1.55,-8,10,.38,3.1],[1,1.55,-8,12,.38,3.1],[15,1.55,-8,10,.38,3.1],
    [-16,1.55,8,9,.38,3.1],[-2,1.55,8,10,.38,3.1],[15,1.55,8,10,.38,3.1],
    [-3,1.55,-1,.38,3.1,8],[4,1.55,1,.38,3.1,8],
    [-15,1.55,14,6,.38,3.1],[-3,1.55,14,7,.38,3.1],[4,1.55,-15,8,.38,3.1],
    [15,1.55,-3,.38,3.1,6],[-15,1.55,-2,.38,3.1,6]
  ];
  for(const v of walls){
    box(...v,wallMat,true);const [x,,z,w,,d]=v;
    if(w>d)box(x,.14,z,w,.28,d+.04,lowerWallMat);else box(x,.14,z,w+.04,.28,d,lowerWallMat)
  }

  // Familiar repeating columns make Level 0 harder to orient in without blocking corridors.
  const columns=[[-17,-17],[-5,-17],[16,-17],[-17,-5],[-5,-5],[6,-5],[17,-1],[-17,5],[-5,5],[6,5],[17,15],[-17,17],[-5,17],[6,17]];
  for(const [x,z] of columns){box(x,1.55,z,.66,3.1,.66,wallMat,true);box(x,.14,z,.76,.28,.76,lowerWallMat)}

  // Repeated fluorescent ceiling panels: one instanced draw call, a smaller set of real lights.
  const fixturePositions=[];
  for(let x=-16;x<=16;x+=4)for(let z=-16;z<=16;z+=4)fixturePositions.push([x,z]);
  const fixtures=new THREE.InstancedMesh(new THREE.BoxGeometry(2.35,.045,.16),new THREE.MeshBasicMaterial({color:0xfff8c9}),fixturePositions.length);
  const dummy=new THREE.Object3D();fixturePositions.forEach(([x,z],i)=>{dummy.position.set(x,3.15,z);dummy.updateMatrix();fixtures.setMatrixAt(i,dummy.matrix)});scene.add(fixtures);
  const lightPositions=[[-16,-16],[-4,-16],[8,-16],[16,-8],[-16,-4],[-4,-4],[8,-4],[16,4],[-16,8],[-4,8],[8,8],[16,16],[-12,16],[0,16]];
  for(const [x,z] of lightPositions){const l=new THREE.PointLight(0xffed9d,8.5,9.5,2);l.position.set(x,2.92,z);scene.add(l);flickers.push({light:l,base:8.5,phase:rand()*20,broken:rand()<.18})}

  // Ceiling leaks/stains and fake dark openings add depth without extra collision.
  const stainMat=new THREE.MeshBasicMaterial({color:0x524d29,transparent:true,opacity:.24});
  for(let i=0;i<22;i++)box(-18+rand()*36,3.18,-18+rand()*36,.5+rand()*2.4,.02,.4+rand()*1.7,stainMat);
  for(const [x,z,w] of [[-19.95,-11,1.2],[-19.95,11,1.6],[19.95,2,1.1],[19.95,16,1.5]])box(x,1.3,z,.04,2.45,w,blackMat);

  // A handful of visual-only abandoned props. They no longer snag the player collider.
  for(let i=0;i<7;i++){
    const x=-17+rand()*34,z=-17+rand()*34,h=.3+rand()*.45;
    if(Math.hypot(x+14,z+14)<3||Math.hypot(x-WORLD.KEYCARD.x,z-WORLD.KEYCARD.z)<2.5)continue;
    box(x,h/2,z,.35+rand()*.45,h,.35+rand()*.45,rand()>.5?darkMat:metalMat,false)
  }

  // Site-Null equipment is sparse on purpose: recognizable landmarks inside a mostly-liminal maze.
  objects.armory=box(WORLD.ARMORY.x,.95,WORLD.ARMORY.z,1.05,1.9,.7,metalMat,true);
  box(WORLD.ARMORY.x,1.18,WORLD.ARMORY.z-.37,.55,.18,.03,amberMat);sign(WORLD.ARMORY.x,2.15,WORLD.ARMORY.z-.38,"SECURITY LOCKER","#d4c071",3.3);beacon(WORLD.ARMORY.x,1.5,WORLD.ARMORY.z,0xc4a84b,3.5,3.6);
  objects.med=box(WORLD.MED.x,.8,WORLD.MED.z,.95,1.6,.65,metalMat,true);
  box(WORLD.MED.x,1.08,WORLD.MED.z-.34,.48,.27,.03,greenMat);sign(WORLD.MED.x,1.95,WORLD.MED.z-.34,"FIELD MEDICAL","#93c1a5",3.2);beacon(WORLD.MED.x,1.35,WORLD.MED.z,0x7fb497,3.5,3.6);
  objects.keycardBase=box(WORLD.KEYCARD.x,.42,WORLD.KEYCARD.z,.85,.84,.85,darkMat,true);
  objects.keycard=new THREE.Mesh(new THREE.BoxGeometry(.5,.045,.31),amberMat);objects.keycard.position.set(WORLD.KEYCARD.x,1.02,WORLD.KEYCARD.z);objects.keycard.rotation.x=.12;scene.add(objects.keycard);beacon(WORLD.KEYCARD.x,1.4,WORLD.KEYCARD.z,0xd3b760,4,3.5);
  objects.terminal=box(WORLD.TERMINAL.x,1.02,WORLD.TERMINAL.z,.95,2.04,.7,metalMat,true);
  box(WORLD.TERMINAL.x,1.42,WORLD.TERMINAL.z-.37,.58,.42,.03,greenMat);sign(WORLD.TERMINAL.x,2.16,WORLD.TERMINAL.z-.38,"THRESHOLD CONTROL","#93c1a5",3.4);beacon(WORLD.TERMINAL.x,1.5,WORLD.TERMINAL.z,0x72a98a,4,3.6);
  box(10.15,1.45,15,.06,2.45,6.3,glassMat,true);sign(9.85,2.55,12.8,"ANOMALOUS HOLDING","#d86f67",3.4);
  box(WORLD.GATE.x-1.85,1.55,WORLD.GATE.z,.55,3.1,.62,metalMat,true);box(WORLD.GATE.x+1.85,1.55,WORLD.GATE.z,.55,3.1,.62,metalMat,true);box(WORLD.GATE.x,3.02,WORLD.GATE.z,4.25,.28,.62,metalMat);
  objects.gateDoor=box(WORLD.GATE.x,1.5,WORLD.GATE.z-.02,3.1,2.8,.28,darkMat,false);
  objects.seal=box(WORLD.SEAL.x,.82,WORLD.SEAL.z,.78,1.64,.66,metalMat,true);box(WORLD.SEAL.x,1.14,WORLD.SEAL.z-.35,.5,.3,.03,redMat);beacon(WORLD.SEAL.x,1.35,WORLD.SEAL.z,0xa8433d,3.5,3.5);
  sign(17.0,2.55,-14.35,"THRESHOLD / EXIT","#d4c071",3.8);

  // Less game-y signage near spawn. Tiny repeated sector markers deeper inside the maze.
  sign(-5.0,2.45,-20.16,"LEVEL 0 // B-17","#d4c071",3.4);
  sign(10.15,2.38,6.9,"RESTRICTED","#d86f67",2.7);

  function update(time,round){
    if(time-lastLightUpdate>95){
      lastLightUpdate=time;
      for(const f of flickers){const dropout=f.broken&&Math.sin(time*.018+f.phase)>.95;f.light.intensity=dropout?.45:f.base*(.94+Math.sin(time*.0012+f.phase)*.06)}
    }
    if(objects.keycard)objects.keycard.visible=!round?.keycardTaken;
    if(objects.gateDoor){const open=round?.phase==="extraction"||round?.phase==="ended";objects.gateDoor.position.y=THREE.MathUtils.lerp(objects.gateDoor.position.y,open?3.65:1.5,.08)}
  }
  return{colliders,objects,update}
}

// Circle-vs-AABB movement with substeps. It slides along walls and does not snag on corners.
export function resolveMovement(from,to,colliders,radius=.25){
  const result=from.clone();
  const dx=to.x-from.x,dz=to.z-from.z;
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.09));
  const sx=dx/steps,sz=dz/steps;
  for(let i=0;i<steps;i++){
    const nx=THREE.MathUtils.clamp(result.x+sx,-19.7,19.7);
    if(!collidesCircle(nx,result.z,colliders,radius))result.x=nx;
    const nz=THREE.MathUtils.clamp(result.z+sz,-19.7,19.7);
    if(!collidesCircle(result.x,nz,colliders,radius))result.z=nz
  }
  return result
}
function collidesCircle(x,z,colliders,r){
  for(const c of colliders){
    const qx=Math.max(c.minX,Math.min(x,c.maxX)),qz=Math.max(c.minZ,Math.min(z,c.maxZ));
    const dx=x-qx,dz=z-qz;if(dx*dx+dz*dz<r*r)return true
  }
  return false
}

export function nearestInteraction(position,round,self){
  if(!self||self.dead||self.escaped||!["active","extraction"].includes(round?.phase))return null;
  const checks=[];
  if(round.phase==="active"&&self.role!=="anomaly"&&!self.weapon&&(round.armoryCharges??0)>0)checks.push({kind:"armory",label:"OPEN SECURITY LOCKER",pos:WORLD.ARMORY,range:2});
  if(round.phase==="active"&&self.hp<self.maxHp&&(round.medCharges??0)>0)checks.push({kind:"med",label:"USE FIELD MEDICAL",pos:WORLD.MED,range:2});
  if(round.phase==="active"&&!round.keycardTaken)checks.push({kind:"keycard",label:"RECOVER THRESHOLD KEYCARD",pos:WORLD.KEYCARD,range:1.8});
  if(round.phase==="active"&&round.keycardTaken)checks.push({kind:"terminal",label:"INITIATE THRESHOLD EXTRACTION",pos:WORLD.TERMINAL,range:2});
  if(round.phase==="extraction"){
    checks.push({kind:"extract",label:"CROSS THRESHOLD",pos:WORLD.GATE,range:2.4});
    if(self.role==="quarantine"||self.role==="security")checks.push({kind:"seal",label:"SEAL THRESHOLD",pos:WORLD.SEAL,range:2})
  }
  let best=null,bestD=999;
  for(const c of checks){const d=position.distanceTo(c.pos);if(d<c.range&&d<bestD){best=c;bestD=d}}
  return best
}
