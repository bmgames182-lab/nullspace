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
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t
}

function wallpaperTexture(rand){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#b9ad67";ctx.fillRect(0,0,s,s);
    for(let x=0;x<s;x+=32){ctx.fillStyle="rgba(93,83,38,.09)";ctx.fillRect(x,0,2,s)}
    for(let i=0;i<170;i++){
      const a=.025+rand()*.04;
      ctx.fillStyle=`rgba(50,45,22,${a})`;
      ctx.fillRect(rand()*s,rand()*s,1+rand()*8,1+rand()*3)
    }
  })
}
function carpetTexture(rand){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#8a8150";ctx.fillRect(0,0,s,s);
    for(let i=0;i<2600;i++){
      const v=70+Math.floor(rand()*45);
      ctx.fillStyle=`rgba(${v},${v-8},${Math.max(20,v-40)},.12)`;
      ctx.fillRect(rand()*s,rand()*s,1,1)
    }
    ctx.strokeStyle="rgba(70,62,35,.14)";
    for(let y=0;y<s;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(s,y);ctx.stroke()}
  })
}
function ceilingTexture(){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#c9c6a6";ctx.fillRect(0,0,s,s);
    ctx.strokeStyle="rgba(82,82,66,.32)";ctx.lineWidth=2;
    for(let i=0;i<=s;i+=64){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,s);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(s,i);ctx.stroke()}
  })
}
function signTexture(text,accent="#d4c071"){
  const c=document.createElement("canvas");c.width=768;c.height=128;const ctx=c.getContext("2d");
  ctx.fillStyle="#12130d";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle=accent;ctx.lineWidth=4;ctx.strokeRect(5,5,c.width-10,c.height-10);
  ctx.fillStyle="#f2efcf";ctx.font="700 42px monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,384,64);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex
}

export function createWorld(scene,seed="NULL"){
  const rand=seeded(seed),colliders=[],objects={},flickers=[],geoCache=new Map();
  let lastLightUpdate=0;

  scene.background=new THREE.Color(0x17160d);
  scene.fog=new THREE.FogExp2(0x5a5534,.018);

  const wallTex=wallpaperTexture(rand);wallTex.repeat.set(2.4,1.1);
  const carpetTex=carpetTexture(rand);carpetTex.repeat.set(8,8);
  const ceilingTex=ceilingTexture();ceilingTex.repeat.set(6,6);

  const wallMat=new THREE.MeshLambertMaterial({map:wallTex,color:0xd8cf8d});
  const baseMat=new THREE.MeshLambertMaterial({color:0x5c5b48});
  const floorMat=new THREE.MeshLambertMaterial({map:carpetTex,color:0xb0a66d});
  const ceilingMat=new THREE.MeshLambertMaterial({map:ceilingTex,color:0xd1cfb6});
  const metalMat=new THREE.MeshStandardMaterial({color:0x323a36,roughness:.52,metalness:.48});
  const darkMat=new THREE.MeshLambertMaterial({color:0x171914});
  const glassMat=new THREE.MeshBasicMaterial({color:0x8ca99f,transparent:true,opacity:.13,depthWrite:false});
  const amberMat=new THREE.MeshStandardMaterial({color:0xb99e3f,emissive:0x5d4611,emissiveIntensity:1.25,roughness:.45});
  const greenMat=new THREE.MeshStandardMaterial({color:0x658e77,emissive:0x244c37,emissiveIntensity:1.2});
  const redMat=new THREE.MeshStandardMaterial({color:0x8b3430,emissive:0x4a1110,emissiveIntensity:1.1});

  scene.add(new THREE.HemisphereLight(0xfff7c7,0x4d4930,1.05));
  scene.add(new THREE.AmbientLight(0xb7ad77,.48));

  function geo(w,h,d){
    const key=`${w}|${h}|${d}`;let g=geoCache.get(key);
    if(!g){g=new THREE.BoxGeometry(w,h,d);geoCache.set(key,g)}
    return g
  }
  function box(x,y,z,w,h,d,mat,collide=false){
    const m=new THREE.Mesh(geo(w,h,d),mat);m.position.set(x,y,z);m.receiveShadow=false;m.castShadow=false;scene.add(m);
    if(collide)colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
    return m
  }
  function sign(x,y,z,text,accent="#d4c071",scale=4.4){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:signTexture(text,accent),transparent:true,depthTest:true,depthWrite:false}));
    s.scale.set(scale,scale/6,1);s.position.set(x,y,z);scene.add(s);return s
  }
  function beacon(x,y,z,color,intensity=7,distance=5){
    const l=new THREE.PointLight(color,intensity,distance,2);l.position.set(x,y,z);scene.add(l);return l
  }

  box(0,-.09,0,42,.18,42,floorMat);
  box(0,3.28,0,42,.16,42,ceilingMat);

  const walls=[
    [0,1.55,-20.5,41,3.1,.5],[0,1.55,20.5,41,3.1,.5],[-20.5,1.55,0,.5,3.1,41],[20.5,1.55,0,.5,3.1,41],
    [-10,1.55,-14,.4,3.1,13],[-10,1.55,6,.4,3.1,17],[10,1.55,-6,.4,3.1,28],
    [0,1.55,-8,12,3.1,.4],[-4,1.55,8,12,3.1,.4],[15,1.55,5,10,3.1,.4],
    [-15,1.55,1,10,3.1,.4],[-3,1.55,15,14,3.1,.4],[4,1.55,-15,12,3.1,.4],
    [2,1.55,1,.4,3.1,10],[-4,1.55,-3,.4,3.1,10],[15,1.55,-4,.4,3.1,7],
    [-15,1.55,12,.4,3.1,6],[6,1.55,12,.4,3.1,7],
    [-15,1.55,-11,7,3.1,.4],[-1,1.55,-17,.4,3.1,5],[7,1.55,17,.4,3.1,5]
  ];
  for(const v of walls){
    box(...v,wallMat,true);
    const [x,y,z,w,h,d]=v;
    if(w>d)box(x,.14,z,w,.28,d+.05,baseMat,false);else box(x,.14,z,w+.05,.28,d,baseMat,false)
  }

  for(const [x,z] of [[-18,-18],[-2,-18],[18,-18],[-18,18],[18,18],[0,5],[8,-10],[-12,-5],[5,6],[-6,12]]){
    box(x,1.55,z,.7,3.1,.7,wallMat,true);box(x,.14,z,.78,.28,.78,baseMat)
  }

  const fixtureGeo=new THREE.BoxGeometry(2.6,.045,.18);
  const fixtureMat=new THREE.MeshBasicMaterial({color:0xfffbd3});
  const fixturePositions=[];
  for(let x=-16;x<=16;x+=8)for(let z=-16;z<=16;z+=8)fixturePositions.push([x,z]);
  const fixtures=new THREE.InstancedMesh(fixtureGeo,fixtureMat,fixturePositions.length);
  const dummy=new THREE.Object3D();
  fixturePositions.forEach(([x,z],i)=>{dummy.position.set(x,3.15,z);dummy.updateMatrix();fixtures.setMatrixAt(i,dummy.matrix)});
  scene.add(fixtures);

  const lightPositions=[[-16,-16],[0,-16],[16,-16],[-16,0],[0,0],[16,0],[-16,16],[0,16],[16,16]];
  for(const [x,z] of lightPositions){
    const light=new THREE.PointLight(0xfff0a8,11,11,2);light.position.set(x,2.95,z);scene.add(light);
    flickers.push({light,base:11,phase:rand()*20,broken:rand()<.22})
  }

  const stainMat=new THREE.MeshBasicMaterial({color:0x5f5a36,transparent:true,opacity:.25});
  for(let i=0;i<12;i++)box(-18+rand()*36,3.18,-18+rand()*36,.7+rand()*2,.02,.5+rand()*1.5,stainMat);
  for(const [x,z] of [[-19.9,-8],[-19.9,7],[19.9,11]]){
    box(x,1.2,z,.05,2.35,1.05,darkMat,false);box(x+(x<0?.03:-.03),1.2,z,.06,1.9,.6,metalMat,false)
  }

  objects.armory=box(WORLD.ARMORY.x,.95,WORLD.ARMORY.z,1.05,1.9,.7,metalMat,true);
  box(WORLD.ARMORY.x,1.18,WORLD.ARMORY.z-.37,.55,.18,.03,amberMat);sign(WORLD.ARMORY.x,2.15,WORLD.ARMORY.z-.38,"SECURITY LOCKER","#d4c071",3.6);beacon(WORLD.ARMORY.x,1.5,WORLD.ARMORY.z,0xc4a84b,4,4);

  objects.med=box(WORLD.MED.x,.8,WORLD.MED.z,.95,1.6,.65,metalMat,true);
  box(WORLD.MED.x,1.08,WORLD.MED.z-.34,.48,.27,.03,greenMat);sign(WORLD.MED.x,1.95,WORLD.MED.z-.34,"FIELD MEDICAL","#93c1a5",3.4);beacon(WORLD.MED.x,1.35,WORLD.MED.z,0x7fb497,4,4);

  objects.keycardBase=box(WORLD.KEYCARD.x,.42,WORLD.KEYCARD.z,.85,.84,.85,darkMat,true);
  objects.keycard=new THREE.Mesh(new THREE.BoxGeometry(.5,.045,.31),amberMat);objects.keycard.position.set(WORLD.KEYCARD.x,1.02,WORLD.KEYCARD.z);objects.keycard.rotation.x=.12;scene.add(objects.keycard);beacon(WORLD.KEYCARD.x,1.4,WORLD.KEYCARD.z,0xd3b760,5,4);

  objects.terminal=box(WORLD.TERMINAL.x,1.02,WORLD.TERMINAL.z,.95,2.04,.7,metalMat,true);
  box(WORLD.TERMINAL.x,1.42,WORLD.TERMINAL.z-.37,.58,.42,.03,greenMat);sign(WORLD.TERMINAL.x,2.16,WORLD.TERMINAL.z-.38,"THRESHOLD CONTROL","#93c1a5",3.6);beacon(WORLD.TERMINAL.x,1.5,WORLD.TERMINAL.z,0x72a98a,5,4);

  box(10.15,1.45,15,.06,2.45,6.3,glassMat,true);
  sign(9.85,2.55,12.8,"ANOMALOUS HOLDING","#d86f67",3.6);

  box(WORLD.GATE.x-1.85,1.55,WORLD.GATE.z,.55,3.1,.62,metalMat,true);
  box(WORLD.GATE.x+1.85,1.55,WORLD.GATE.z,.55,3.1,.62,metalMat,true);
  box(WORLD.GATE.x,3.02,WORLD.GATE.z,4.25,.28,.62,metalMat);
  objects.gateDoor=box(WORLD.GATE.x,1.5,WORLD.GATE.z-.02,3.1,2.8,.28,darkMat,false);
  objects.seal=box(WORLD.SEAL.x,.82,WORLD.SEAL.z,.78,1.64,.66,metalMat,true);
  box(WORLD.SEAL.x,1.14,WORLD.SEAL.z-.35,.5,.3,.03,redMat);beacon(WORLD.SEAL.x,1.35,WORLD.SEAL.z,0xa8433d,4,4);
  sign(17.0,2.55,-14.35,"THRESHOLD / EXIT","#d4c071",4.2);

  for(let i=0;i<10;i++){
    const x=-18+rand()*36,z=-18+rand()*36;
    if(colliders.some(c=>x>c.minX-.9&&x<c.maxX+.9&&z>c.minZ-.9&&z<c.maxZ+.9))continue;
    const h=.35+rand()*.55;box(x,h/2,z,.45+rand()*.55,h,.45+rand()*.55,rand()>.4?darkMat:metalMat,true)
  }

  sign(-16,2.45,-20.15,"LEVEL 0 // RESEARCH","#d4c071",4.2);
  sign(-9.7,2.35,-11.5,"DECONTAMINATION","#93c1a5",4);

  function update(time,round){
    if(time-lastLightUpdate>85){
      lastLightUpdate=time;
      for(const f of flickers){
        const dropout=f.broken&&Math.sin(time*.021+f.phase)>.93;
        f.light.intensity=dropout?.8:f.base*(.96+Math.sin(time*.0014+f.phase)*.04)
      }
    }
    if(objects.keycard)objects.keycard.visible=!round?.keycardTaken;
    if(objects.gateDoor){
      const open=round?.phase==="extraction"||round?.phase==="ended";
      objects.gateDoor.position.y=THREE.MathUtils.lerp(objects.gateDoor.position.y,open?3.65:1.5,.08)
    }
  }
  return{colliders,objects,update}
}

export function resolveMovement(from,to,colliders,radius=.34){
  const result=to.clone();
  const tx=new THREE.Vector3(result.x,from.y,from.z);if(collides(tx,colliders,radius))result.x=from.x;
  const tz=new THREE.Vector3(result.x,from.y,result.z);if(collides(tz,colliders,radius))result.z=from.z;
  result.x=THREE.MathUtils.clamp(result.x,-19.7,19.7);result.z=THREE.MathUtils.clamp(result.z,-19.7,19.7);return result
}
function collides(p,colliders,r){return colliders.some(c=>p.x+r>c.minX&&p.x-r<c.maxX&&p.z+r>c.minZ&&p.z-r<c.maxZ)}

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