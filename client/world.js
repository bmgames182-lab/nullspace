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

const HALF=20.45;
const WALL_H=3.04;
const CELL=4;
const GRID=10;

function seeded(seedText){
  let s=2166136261>>>0;
  for(let i=0;i<seedText.length;i++){s^=seedText.charCodeAt(i);s=Math.imul(s,16777619)}
  return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}
}
function canvasTexture(draw,size=512){
  const c=document.createElement("canvas");c.width=c.height=size;
  const ctx=c.getContext("2d",{alpha:false});draw(ctx,size);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t
}
function wallpaperTexture(rand){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#b8ab66";ctx.fillRect(0,0,s,s);
    const g=ctx.createLinearGradient(0,0,s,0);g.addColorStop(0,"rgba(70,59,25,.08)");g.addColorStop(.5,"rgba(255,244,173,.05)");g.addColorStop(1,"rgba(63,53,23,.08)");ctx.fillStyle=g;ctx.fillRect(0,0,s,s);
    ctx.lineWidth=1;
    for(let x=0;x<s;x+=64){ctx.strokeStyle="rgba(66,58,27,.16)";ctx.beginPath();ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,s);ctx.stroke()}
    for(let y=8;y<s;y+=72){
      for(let x=12;x<s;x+=48){
        ctx.strokeStyle="rgba(85,72,31,.16)";ctx.beginPath();ctx.moveTo(x,y+20);ctx.quadraticCurveTo(x+12,y+4,x+24,y+20);ctx.quadraticCurveTo(x+12,y+35,x,y+20);ctx.stroke();
        ctx.strokeStyle="rgba(246,229,154,.08)";ctx.beginPath();ctx.moveTo(x+2,y+22);ctx.quadraticCurveTo(x+12,y+9,x+22,y+22);ctx.stroke();
      }
    }
    for(let i=0;i<900;i++){const a=.015+rand()*.045;ctx.fillStyle=`rgba(54,48,25,${a})`;ctx.fillRect(rand()*s,rand()*s,.5+rand()*2.2,.5+rand()*5)}
  })
}
function carpetTexture(rand){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#706844";ctx.fillRect(0,0,s,s);
    for(let y=0;y<s;y+=3){ctx.fillStyle=y%6?"rgba(41,38,25,.08)":"rgba(188,171,105,.035)";ctx.fillRect(0,y,s,1)}
    for(let i=0;i<6500;i++){
      const base=55+Math.floor(rand()*65);ctx.fillStyle=`rgba(${base},${Math.max(35,base-5)},${Math.max(20,base-34)},${.08+rand()*.12})`;ctx.fillRect(rand()*s,rand()*s,1+rand(),1+rand())
    }
    for(let i=0;i<14;i++){
      const x=rand()*s,y=rand()*s,r=18+rand()*55;const stain=ctx.createRadialGradient(x,y,0,x,y,r);stain.addColorStop(0,"rgba(35,34,23,.12)");stain.addColorStop(1,"rgba(35,34,23,0)");ctx.fillStyle=stain;ctx.fillRect(x-r,y-r,r*2,r*2)
    }
  })
}
function ceilingTexture(rand){
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle="#c9c6aa";ctx.fillRect(0,0,s,s);
    for(let i=0;i<1400;i++){const v=135+Math.floor(rand()*55);ctx.fillStyle=`rgba(${v},${v},${Math.max(110,v-16)},.12)`;ctx.fillRect(rand()*s,rand()*s,1,1)}
    ctx.strokeStyle="rgba(66,65,52,.35)";ctx.lineWidth=3;
    for(let i=0;i<=s;i+=128){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,s);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(s,i);ctx.stroke()}
  })
}
function labelTexture(text,accent="#c9b66a"){
  const c=document.createElement("canvas");c.width=640;c.height=128;const ctx=c.getContext("2d");
  ctx.fillStyle="#10120e";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.strokeRect(4,4,c.width-8,c.height-8);
  ctx.fillStyle="#e8e5d3";ctx.font="700 34px ui-monospace, monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,320,64);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t
}
function stainTexture(rand){
  const c=document.createElement("canvas");c.width=c.height=128;const ctx=c.getContext("2d");ctx.clearRect(0,0,128,128);
  const x=64+(rand()-.5)*18,y=64+(rand()-.5)*18,r=30+rand()*24;const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,"rgba(34,31,18,.34)");g.addColorStop(.45,"rgba(43,39,22,.18)");g.addColorStop(1,"rgba(43,39,22,0)");ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t
}

export function createWorld(scene,seed="NULL"){
  const rand=seeded(seed),colliders=[],objects={},flickers=[],geoCache=new Map();
  let lastLightUpdate=0;
  scene.background=new THREE.Color(0x4d4930);
  scene.fog=new THREE.FogExp2(0x625c3d,.0128);

  const wallTex=wallpaperTexture(rand);wallTex.repeat.set(1.25,.78);
  const carpetTex=carpetTexture(rand);carpetTex.repeat.set(14,14);
  const ceilTex=ceilingTexture(rand);ceilTex.repeat.set(5,5);

  const wallMat=new THREE.MeshStandardMaterial({map:wallTex,color:0xd2c47b,roughness:.92,metalness:0});
  const carpetMat=new THREE.MeshStandardMaterial({map:carpetTex,color:0x91875a,roughness:.99,metalness:0});
  const ceilingMat=new THREE.MeshStandardMaterial({map:ceilTex,color:0xd0cdb4,roughness:.96,metalness:0});
  const trimMat=new THREE.MeshStandardMaterial({color:0x4d4c3d,roughness:.82});
  const metalMat=new THREE.MeshStandardMaterial({color:0x303530,roughness:.52,metalness:.46});
  const darkMetalMat=new THREE.MeshStandardMaterial({color:0x171a17,roughness:.68,metalness:.35});
  const amberMat=new THREE.MeshStandardMaterial({color:0x9c8238,emissive:0x55400d,emissiveIntensity:.75,roughness:.52});
  const greenMat=new THREE.MeshStandardMaterial({color:0x587966,emissive:0x173b29,emissiveIntensity:.7,roughness:.48});
  const redMat=new THREE.MeshStandardMaterial({color:0x7f3431,emissive:0x3a0e0d,emissiveIntensity:.8,roughness:.48});
  const glassMat=new THREE.MeshPhysicalMaterial({color:0x829b8f,roughness:.22,transmission:.18,transparent:true,opacity:.18,depthWrite:false});

  scene.add(new THREE.HemisphereLight(0xfff1b8,0x393522,.72));
  scene.add(new THREE.AmbientLight(0x8f8967,.34));

  function geo(w,h,d){const k=`${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;let g=geoCache.get(k);if(!g){g=new THREE.BoxGeometry(w,h,d);geoCache.set(k,g)}return g}
  function box(x,y,z,w,h,d,mat,collide=false){
    const m=new THREE.Mesh(geo(w,h,d),mat);m.position.set(x,y,z);m.castShadow=false;m.receiveShadow=false;scene.add(m);
    if(collide)colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});return m
  }
  function plaque(x,y,z,text,accent="#c9b66a",rotationY=Math.PI,scale=1){
    const mat=new THREE.MeshBasicMaterial({map:labelTexture(text,accent),transparent:false,toneMapped:false});
    const p=new THREE.Mesh(new THREE.PlaneGeometry(2.25*scale,.45*scale),mat);p.position.set(x,y,z);p.rotation.y=rotationY;scene.add(p);return p
  }
  function beacon(x,y,z,color,intensity=2.4,distance=4.8){const l=new THREE.PointLight(color,intensity,distance,2);l.position.set(x,y,z);scene.add(l);return l}

  box(0,-.08,0,41.3,.16,41.3,carpetMat,false);
  box(0,3.15,0,41.3,.12,41.3,ceilingMat,false);

  const vWalls=Array.from({length:GRID+1},()=>Array(GRID).fill(true));
  const hWalls=Array.from({length:GRID},()=>Array(GRID+1).fill(true));
  const visited=Array.from({length:GRID},()=>Array(GRID).fill(false));
  const stack=[[0,0]];visited[0][0]=true;
  while(stack.length){
    const [cx,cz]=stack[stack.length-1],ns=[];
    if(cx>0&&!visited[cx-1][cz])ns.push([cx-1,cz,"L"]);
    if(cx<GRID-1&&!visited[cx+1][cz])ns.push([cx+1,cz,"R"]);
    if(cz>0&&!visited[cx][cz-1])ns.push([cx,cz-1,"D"]);
    if(cz<GRID-1&&!visited[cx][cz+1])ns.push([cx,cz+1,"U"]);
    if(!ns.length){stack.pop();continue}
    const [nx,nz,dir]=ns[Math.floor(rand()*ns.length)];
    if(dir==="L")vWalls[cx][cz]=false;else if(dir==="R")vWalls[cx+1][cz]=false;else if(dir==="D")hWalls[cx][cz]=false;else hWalls[cx][cz+1]=false;
    visited[nx][nz]=true;stack.push([nx,nz])
  }
  for(let x=1;x<GRID;x++)for(let z=0;z<GRID;z++)if(vWalls[x][z]&&rand()<.48)vWalls[x][z]=false;
  for(let x=0;x<GRID;x++)for(let z=1;z<GRID;z++)if(hWalls[x][z]&&rand()<.48)hWalls[x][z]=false;

  const clearZones=[WORLD.HUMAN_SPAWN,WORLD.ANOMALY_SPAWN,WORLD.KEYCARD,WORLD.TERMINAL,WORLD.ARMORY,WORLD.MED,WORLD.GATE,WORLD.SEAL];
  const nearClear=(x,z)=>clearZones.some(p=>Math.hypot(x-p.x,z-p.z)<1.8);
  function wallSegment(x,z,horizontal,boundary=false){
    if(!boundary&&nearClear(x,z))return;
    const len=CELL+.12,thick=.18;
    const door=!boundary&&rand()<.13;
    const make=(px,pz,l)=>{
      if(horizontal){box(px,WALL_H/2,pz,l,WALL_H,thick,wallMat,true);box(px,.105,pz,l+.03,.21,thick+.035,trimMat,false)}
      else{box(px,WALL_H/2,pz,thick,WALL_H,l,wallMat,true);box(px,.105,pz,thick+.035,.21,l+.03,trimMat,false)}
    };
    if(!door){make(x,z,len);return}
    const gap=1.35,piece=(len-gap)/2,off=(gap+piece)/2;
    if(horizontal){make(x-off,z,piece);make(x+off,z,piece)}else{make(x,z-off,piece);make(x,z+off,piece)}
  }
  for(let x=0;x<=GRID;x++)for(let z=0;z<GRID;z++)if(vWalls[x][z]){
    const px=-20+x*CELL,pz=-18+z*CELL;wallSegment(px,pz,false,x===0||x===GRID)
  }
  for(let x=0;x<GRID;x++)for(let z=0;z<=GRID;z++)if(hWalls[x][z]){
    const px=-18+x*CELL,pz=-20+z*CELL;wallSegment(px,pz,true,z===0||z===GRID)
  }

  for(let x=-16;x<=16;x+=8)for(let z=-16;z<=16;z+=8){
    if(nearClear(x,z)||rand()<.28)continue;
    box(x,WALL_H/2,z,.48,WALL_H,.48,wallMat,true);box(x,.11,z,.57,.22,.57,trimMat,false)
  }

  const fixtureGeo=new THREE.BoxGeometry(2.15,.035,.78),fixtureMat=new THREE.MeshStandardMaterial({color:0xf6efc9,emissive:0xffec9f,emissiveIntensity:1.7,roughness:.35});
  const darkFixtureMat=new THREE.MeshStandardMaterial({color:0x8d896f,emissive:0x241f11,emissiveIntensity:.08,roughness:.62});
  const lit=[],dead=[];
  for(let x=-18;x<=18;x+=4)for(let z=-18;z<=18;z+=4){(rand()<.13?dead:lit).push([x,z,rand()>.5?0:Math.PI/2])}
  function instancedFixtures(data,mat){
    const im=new THREE.InstancedMesh(fixtureGeo,mat,data.length),o=new THREE.Object3D();
    data.forEach(([x,z,r],i)=>{o.position.set(x,3.075,z);o.rotation.set(0,r,0);o.updateMatrix();im.setMatrixAt(i,o.matrix)});scene.add(im);return im
  }
  instancedFixtures(lit,fixtureMat);instancedFixtures(dead,darkFixtureMat);
  for(let x=-16;x<=16;x+=8)for(let z=-16;z<=16;z+=8){
    if(rand()<.16)continue;
    const l=new THREE.PointLight(0xffe7a2,3.15,9.2,2);l.position.set(x,2.82,z);scene.add(l);flickers.push({light:l,base:3.15,phase:rand()*18,broken:rand()<.2})
  }

  for(let i=0;i<18;i++){
    const tex=stainTexture(rand),mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,toneMapped:false,opacity:.55});
    const size=1.4+rand()*3.6,m=new THREE.Mesh(new THREE.PlaneGeometry(size,size*(.55+rand()*.4)),mat);m.position.set(-18+rand()*36,.011,-18+rand()*36);m.rotation.x=-Math.PI/2;m.rotation.z=rand()*Math.PI;scene.add(m)
  }
  for(let i=0;i<12;i++){
    const tex=stainTexture(rand),mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,toneMapped:false,opacity:.42});
    const size=.9+rand()*2.2,m=new THREE.Mesh(new THREE.PlaneGeometry(size,size),mat);m.position.set(-18+rand()*36,3.084,-18+rand()*36);m.rotation.x=Math.PI/2;m.rotation.z=rand()*Math.PI;scene.add(m)
  }

  for(let i=0;i<11;i++){
    const x=-17+rand()*34,z=-17+rand()*34;if(nearClear(x,z))continue;
    if(rand()<.55){
      const h=.12+rand()*.16;const m=box(x,h/2,z,.55+rand()*.8,h,.35+rand()*.55,darkMetalMat,false);m.rotation.y=rand()*Math.PI
    }else{
      const m=box(x,.015,z,.7+rand()*.9,.03,.08+rand()*.08,new THREE.MeshStandardMaterial({color:0x9a8f56,roughness:.95}),false);m.rotation.y=rand()*Math.PI
    }
  }

  objects.armory=box(WORLD.ARMORY.x,.94,WORLD.ARMORY.z,.92,1.88,.58,metalMat,true);
  box(WORLD.ARMORY.x-.22,1.08,WORLD.ARMORY.z-.303,.025,.5,.025,darkMetalMat);box(WORLD.ARMORY.x+.22,1.08,WORLD.ARMORY.z-.303,.025,.5,.025,darkMetalMat);
  plaque(WORLD.ARMORY.x,2.05,WORLD.ARMORY.z-.305,"SECURITY", "#c9b66a",Math.PI,.72);beacon(WORLD.ARMORY.x,1.42,WORLD.ARMORY.z-.5,0xc7aa52,1.4,3.4);

  objects.med=box(WORLD.MED.x,.72,WORLD.MED.z,.82,1.44,.52,metalMat,true);
  box(WORLD.MED.x,1.05,WORLD.MED.z-.275,.32,.08,.025,greenMat);box(WORLD.MED.x,1.05,WORLD.MED.z-.276,.08,.32,.025,greenMat);
  plaque(WORLD.MED.x,1.75,WORLD.MED.z-.28,"MEDICAL", "#7fa990",Math.PI,.62);beacon(WORLD.MED.x,1.2,WORLD.MED.z-.45,0x6f9c82,1.35,3.2);

  objects.keycardBase=box(WORLD.KEYCARD.x,.36,WORLD.KEYCARD.z,.62,.72,.62,darkMetalMat,true);
  objects.keycard=new THREE.Mesh(new THREE.BoxGeometry(.42,.035,.26),amberMat);objects.keycard.position.set(WORLD.KEYCARD.x,.81,WORLD.KEYCARD.z);objects.keycard.rotation.set(.08,.35,.02);scene.add(objects.keycard);beacon(WORLD.KEYCARD.x,.98,WORLD.KEYCARD.z,0xd0b45a,1.7,3.1);

  objects.terminal=box(WORLD.TERMINAL.x,.92,WORLD.TERMINAL.z,.9,1.84,.62,metalMat,true);
  const screen=box(WORLD.TERMINAL.x,1.23,WORLD.TERMINAL.z-.321,.55,.37,.025,greenMat);objects.terminalScreen=screen;
  plaque(WORLD.TERMINAL.x,2.02,WORLD.TERMINAL.z-.325,"THRESHOLD", "#7fa990",Math.PI,.7);beacon(WORLD.TERMINAL.x,1.32,WORLD.TERMINAL.z-.5,0x72a98a,1.55,3.6);

  box(10.1,1.48,15,.045,2.45,5.5,glassMat,true);

  box(WORLD.GATE.x-1.72,1.52,WORLD.GATE.z,.42,3.04,.58,metalMat,true);box(WORLD.GATE.x+1.72,1.52,WORLD.GATE.z,.42,3.04,.58,metalMat,true);box(WORLD.GATE.x,2.93,WORLD.GATE.z,3.85,.27,.58,metalMat,false);
  objects.gateDoor=box(WORLD.GATE.x,1.48,WORLD.GATE.z-.015,2.95,2.72,.22,darkMetalMat,false);
  const stripes=new THREE.MeshStandardMaterial({color:0xb59a45,roughness:.7});for(const sx of [-.95,-.45,.05,.55,1.05]){const bar=box(WORLD.GATE.x+sx,1.5,WORLD.GATE.z-.13,.14,2.55,.025,stripes,false);bar.rotation.z=.3}
  plaque(WORLD.GATE.x,2.62,WORLD.GATE.z-.31,"EXIT / THRESHOLD", "#c9b66a",Math.PI,.76);

  objects.seal=box(WORLD.SEAL.x,.75,WORLD.SEAL.z,.68,1.5,.56,metalMat,true);box(WORLD.SEAL.x,1.02,WORLD.SEAL.z-.295,.38,.24,.025,redMat);beacon(WORLD.SEAL.x,1.08,WORLD.SEAL.z-.45,0xa8433d,1.45,3.1);

  function update(time,round){
    if(time-lastLightUpdate>70){
      lastLightUpdate=time;
      for(const f of flickers){
        let intensity=f.base*(.97+Math.sin(time*.0011+f.phase)*.03);
        if(f.broken){const wave=Math.sin(time*.026+f.phase)+Math.sin(time*.071+f.phase*.7);if(wave>1.42)intensity*=.08;else if(wave>1.15)intensity*=.46}
        f.light.intensity=intensity
      }
      if(objects.terminalScreen)objects.terminalScreen.material.emissiveIntensity=.62+Math.sin(time*.002)*.12
    }
    if(objects.keycard)objects.keycard.visible=!round?.keycardTaken;
    if(objects.gateDoor){
      const open=round?.phase==="extraction"||round?.phase==="ended";
      objects.gateDoor.position.y=THREE.MathUtils.lerp(objects.gateDoor.position.y,open?3.42:1.48,.075)
    }
  }
  return{colliders,objects,update}
}

function circleHitsAABB(x,z,r,c){
  const nx=Math.max(c.minX,Math.min(x,c.maxX)),nz=Math.max(c.minZ,Math.min(z,c.maxZ));
  const dx=x-nx,dz=z-nz;return dx*dx+dz*dz<r*r
}
function blocked(x,z,colliders,r){for(const c of colliders)if(circleHitsAABB(x,z,r,c))return true;return false}
export function resolveMovement(from,to,colliders,radius=.25){
  const result=from.clone(),dx=to.x-from.x,dz=to.z-from.z;
  const distance=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(distance/.055)),sx=dx/steps,sz=dz/steps;
  for(let i=0;i<steps;i++){
    const fullX=result.x+sx,fullZ=result.z+sz;
    if(!blocked(fullX,fullZ,colliders,radius)){result.x=fullX;result.z=fullZ;continue}
    if(!blocked(fullX,result.z,colliders,radius))result.x=fullX;
    if(!blocked(result.x,fullZ,colliders,radius))result.z=fullZ
  }
  result.x=THREE.MathUtils.clamp(result.x,-19.62,19.62);result.z=THREE.MathUtils.clamp(result.z,-19.62,19.62);return result
}

export function nearestInteraction(position,round,self){
  if(!self||self.dead||self.escaped||!["active","extraction"].includes(round?.phase))return null;
  const checks=[];
  if(round.phase==="active"&&self.role!=="anomaly"&&!self.weapon&&(round.armoryCharges??0)>0)checks.push({kind:"armory",label:"OPEN SECURITY LOCKER",pos:WORLD.ARMORY,range:2});
  if(round.phase==="active"&&self.hp<self.maxHp&&(round.medCharges??0)>0)checks.push({kind:"med",label:"USE FIELD MEDICAL",pos:WORLD.MED,range:2});
  if(round.phase==="active"&&!round.keycardTaken)checks.push({kind:"keycard",label:"TAKE THRESHOLD KEYCARD",pos:WORLD.KEYCARD,range:1.8});
  if(round.phase==="active"&&round.keycardTaken)checks.push({kind:"terminal",label:"OPEN THRESHOLD",pos:WORLD.TERMINAL,range:2});
  if(round.phase==="extraction"){
    checks.push({kind:"extract",label:"CROSS THRESHOLD",pos:WORLD.GATE,range:2.4});
    if(self.role==="quarantine"||self.role==="security")checks.push({kind:"seal",label:"SEAL THRESHOLD",pos:WORLD.SEAL,range:2})
  }
  let best=null,bestD=Infinity;
  for(const c of checks){const d=Math.hypot(position.x-c.pos.x,position.z-c.pos.z);if(d<c.range&&d<bestD){best=c;bestD=d}}
  return best
}
