import * as THREE from "three";

export const WORLD = Object.freeze({
  KEYCARD: new THREE.Vector3(-16, 0, 14),
  TERMINAL: new THREE.Vector3(14, 0, 13),
  GATE: new THREE.Vector3(17, 0, -14),
  SEAL: new THREE.Vector3(12.5, 0, -14),
  ARMORY: new THREE.Vector3(-17, 0, -4),
  MED: new THREE.Vector3(4, 0, -17),
  HUMAN_SPAWN: new THREE.Vector3(-14, 0, -14),
  ANOMALY_SPAWN: new THREE.Vector3(14, 0, 14)
});

function seeded(seedText) {
  let s = 2166136261 >>> 0;
  for (let i=0;i<seedText.length;i++) { s ^= seedText.charCodeAt(i); s = Math.imul(s,16777619); }
  return () => {
    s += 0x6D2B79F5;
    let t=s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

function canvasTexture(draw, size=256) {
  const c=document.createElement("canvas"); c.width=c.height=size;
  const ctx=c.getContext("2d"); draw(ctx,size);
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; return t;
}

function grungeTexture(base="#48514b", line="#2c332f") {
  return canvasTexture((ctx,s)=>{
    ctx.fillStyle=base;ctx.fillRect(0,0,s,s);
    for(let i=0;i<850;i++){
      const v=Math.floor(20+Math.random()*35);ctx.fillStyle=`rgba(${v},${v},${v},${Math.random()*.07})`;
      ctx.fillRect(Math.random()*s,Math.random()*s,Math.random()*5+1,Math.random()*2+1);
    }
    ctx.strokeStyle=line;ctx.globalAlpha=.35;ctx.lineWidth=2;
    for(let y=0;y<s;y+=64){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(s,y);ctx.stroke();}
  });
}

export function createWorld(scene, seed="NULL") {
  const rand=seeded(seed);
  const colliders=[];
  const flickers=[];
  const objects={};

  scene.background=new THREE.Color(0x050807);
  scene.fog=new THREE.FogExp2(0x0a100d,.022);

  const wallTex=grungeTexture("#3e4943","#1c2621"); wallTex.repeat.set(2,1);
  const floorTex=grungeTexture("#272d2a","#141917"); floorTex.repeat.set(8,8);
  const wallMat=new THREE.MeshStandardMaterial({map:wallTex,color:0xa1aea7,roughness:.84,metalness:.04});
  const floorMat=new THREE.MeshStandardMaterial({map:floorTex,color:0x727a76,roughness:.92,metalness:.02});
  const ceilingMat=new THREE.MeshStandardMaterial({color:0x1a211e,roughness:.9,metalness:.08});
  const metalMat=new THREE.MeshStandardMaterial({color:0x252e2a,roughness:.55,metalness:.6});
  const darkMat=new THREE.MeshStandardMaterial({color:0x0c1110,roughness:.64,metalness:.4});

  const hemi=new THREE.HemisphereLight(0x60766a,0x080b09,.46); scene.add(hemi);
  const ambient=new THREE.AmbientLight(0x52635a,.22); scene.add(ambient);

  function meshBox(x,y,z,w,h,d,mat,collide=false) {
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);
    if(collide) colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
    return m;
  }

  meshBox(0,-.09,0,42,.18,42,floorMat,false);
  meshBox(0,3.3,0,42,.2,42,ceilingMat,false);

  const walls=[
    [0,1.55,-20.5,41,3.1,.5],[0,1.55,20.5,41,3.1,.5],[-20.5,1.55,0,.5,3.1,41],[20.5,1.55,0,.5,3.1,41],
    [-10,1.55,-14,.4,3.1,13],[-10,1.55,6,.4,3.1,17],[10,1.55,-6,.4,3.1,28],
    [0,1.55,-8,12,3.1,.4],[-4,1.55,8,12,3.1,.4],[15,1.55,5,10,3.1,.4],
    [-15,1.55,1,10,3.1,.4],[-3,1.55,15,14,3.1,.4],[4,1.55,-15,12,3.1,.4],
    [2,1.55,1,.4,3.1,10],[-4,1.55,-3,.4,3.1,10],[15,1.55,-4,.4,3.1,7],
    [-15,1.55,12,.4,3.1,6],[6,1.55,12,.4,3.1,7]
  ];
  walls.forEach(v=>meshBox(...v,wallMat,true));

  for(const [x,z] of [[-18,-18],[-2,-18],[18,-18],[-18,18],[18,18],[0,5],[8,-10],[-12,-5]]){
    meshBox(x,1.55,z,.65,3.1,.65,metalMat,true);
    meshBox(x,2.95,z,1.05,.12,1.05,darkMat,false);
  }

  const stripeMat=new THREE.MeshBasicMaterial({color:0xb0923c});
  for(let x=-18;x<=18;x+=4) meshBox(x,.015,-17.7,2.2,.02,.07,stripeMat,false);
  const redStripe=new THREE.MeshBasicMaterial({color:0x6f2926});
  for(let z=-18;z<=18;z+=3) meshBox(18.1,.018,z,.08,.02,1.5,redStripe,false);

  const fixtureMat=new THREE.MeshStandardMaterial({color:0xc9d1cc,emissive:0x617064,emissiveIntensity:.35,roughness:.35});
  for(let x=-16;x<=16;x+=8){for(let z=-16;z<=16;z+=8){
    const fixture=meshBox(x,3.14,z,2.7,.05,.22,fixtureMat,false);fixture.castShadow=false;
    const light=new THREE.PointLight(0xb7c8bc,rand()>.2?8:5,12,2);light.position.set(x,2.95,z);scene.add(light);
    flickers.push({light,base:light.intensity,phase:rand()*20,rate:.5+rand()*2.4,broken:rand()<.16});
  }}

  objects.armory=meshBox(WORLD.ARMORY.x,1.0,WORLD.ARMORY.z,.95,2.0,.65,metalMat,true);
  meshBox(WORLD.ARMORY.x,1.2,WORLD.ARMORY.z-.34,.52,.16,.03,new THREE.MeshStandardMaterial({color:0x100f06,emissive:0xb08f32,emissiveIntensity:1.3}),false);
  addSign(WORLD.ARMORY.x,2.28,WORLD.ARMORY.z,"SECURITY LOCKER",0xd7bc72);
  objects.med=meshBox(WORLD.MED.x,.85,WORLD.MED.z,.85,1.7,.55,new THREE.MeshStandardMaterial({color:0x293a33,roughness:.5,metalness:.35}),true);
  meshBox(WORLD.MED.x,1.12,WORLD.MED.z-.29,.45,.28,.03,new THREE.MeshStandardMaterial({color:0x07100b,emissive:0x4b9b72,emissiveIntensity:1.4}),false);
  addSign(WORLD.MED.x,2.05,WORLD.MED.z,"FIELD MEDICAL",0x9ac7ad);

  objects.keycardBase=meshBox(WORLD.KEYCARD.x,.45,WORLD.KEYCARD.z,.8,.9,.8,darkMat,true);
  objects.keycard=new THREE.Mesh(new THREE.BoxGeometry(.5,.045,.31),new THREE.MeshStandardMaterial({color:0xd3b760,emissive:0x6a4f12,emissiveIntensity:.8,metalness:.12,roughness:.4}));
  objects.keycard.position.set(WORLD.KEYCARD.x,1.02,WORLD.KEYCARD.z);objects.keycard.rotation.x=.15;scene.add(objects.keycard);
  addBeacon(WORLD.KEYCARD.x,1.35,WORLD.KEYCARD.z,0xd3b760,.8);

  objects.terminal=meshBox(WORLD.TERMINAL.x,1.05,WORLD.TERMINAL.z,.9,2.1,.55,metalMat,true);
  const screen=meshBox(WORLD.TERMINAL.x,1.45,WORLD.TERMINAL.z-.29,.57,.42,.03,new THREE.MeshStandardMaterial({color:0x08100c,emissive:0x3f8a63,emissiveIntensity:1.5}),false);
  screen.rotation.x=-.08;
  addBeacon(WORLD.TERMINAL.x,2.25,WORLD.TERMINAL.z,0x77c59b,.55);

  objects.gateFrame=new THREE.Group(); scene.add(objects.gateFrame);
  const leftPost=meshBox(WORLD.GATE.x-1.85,1.55,WORLD.GATE.z,.55,3.1,.62,metalMat,true);
  const rightPost=meshBox(WORLD.GATE.x+1.85,1.55,WORLD.GATE.z,.55,3.1,.62,metalMat,true);
  const lintel=meshBox(WORLD.GATE.x,3.02,WORLD.GATE.z,4.25,.28,.62,metalMat,false);
  objects.gateFrame.add(leftPost,rightPost,lintel);
  objects.gateDoor=meshBox(WORLD.GATE.x,1.5,WORLD.GATE.z-.02,3.1,2.8,.28,darkMat,false);
  objects.seal=meshBox(WORLD.SEAL.x,.85,WORLD.SEAL.z,.75,1.7,.62,metalMat,true);
  meshBox(WORLD.SEAL.x,1.2,WORLD.SEAL.z-.33,.48,.28,.03,new THREE.MeshStandardMaterial({color:0x160807,emissive:0x8b2c25,emissiveIntensity:1.2}),false);

  const glass=new THREE.MeshPhysicalMaterial({color:0x7eaaa0,transparent:true,opacity:.17,roughness:.14,metalness:.05,transmission:.25});
  meshBox(10.15,1.45,15,.06,2.5,6.3,glass,true);

  addSign(-16,2.25,-20.16,"SECTOR C // RESEARCH",0xb7c8bc);
  addSign(10.2,2.2,11.6,"ANOMALOUS HOLDING",0xd45e56);
  addSign(17.8,2.25,-20.15,"THRESHOLD / EXIT",0xd7bc72);
  addSign(-10.25,2.2,-12,"DECONTAMINATION",0x9ac7ad,true);

  for(let i=0;i<22;i++){
    const x=-18+rand()*36,z=-18+rand()*36;
    if(colliders.some(c=>x>c.minX-.8&&x<c.maxX+.8&&z>c.minZ-.8&&z<c.maxZ+.8)) continue;
    const h=.45+rand()*.55;
    const crate=meshBox(x,h/2,z,.55+rand()*.65,h,.55+rand()*.65,rand()>.35?darkMat:metalMat,true);
    crate.rotation.y=(rand()-.5)*.25;
  }

  function addBeacon(x,y,z,color,intensity){const l=new THREE.PointLight(color,intensity*7,5,2);l.position.set(x,y,z);scene.add(l);return l;}
  function addSign(x,y,z,text,color,rotate=false){
    const c=document.createElement("canvas");c.width=768;c.height=128;const ctx=c.getContext("2d");
    ctx.fillStyle="#09100d";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle=`#${color.toString(16).padStart(6,"0")}`;ctx.lineWidth=4;ctx.strokeRect(4,4,c.width-8,c.height-8);
    ctx.fillStyle="#d9e2dd";ctx.font="700 42px monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,384,64);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:true}));spr.scale.set(4.8,.8,1);spr.position.set(x,y,z);if(rotate)spr.material.rotation=Math.PI/2;scene.add(spr);return spr;
  }

  function update(time,round){
    for(const f of flickers){
      const wave=Math.sin(time*.001*f.rate+f.phase);
      const dropout=f.broken&&Math.sin(time*.013+f.phase)>.88;
      f.light.intensity=dropout?.25:f.base*(.94+wave*.045);
    }
    if(objects.keycard) objects.keycard.visible=!round?.keycardTaken;
    if(objects.gateDoor){
      const open=round?.phase==="extraction"||round?.phase==="sealed"||round?.phase==="ended";
      const targetY=open?3.65:1.5;objects.gateDoor.position.y=THREE.MathUtils.lerp(objects.gateDoor.position.y,targetY,.08);
    }
  }

  return {colliders,objects,update};
}

export function resolveMovement(from,to,colliders,radius=.34){
  const result=to.clone();
  const testX=new THREE.Vector3(result.x,from.y,from.z);
  if(collides(testX,colliders,radius)) result.x=from.x;
  const testZ=new THREE.Vector3(result.x,from.y,result.z);
  if(collides(testZ,colliders,radius)) result.z=from.z;
  result.x=THREE.MathUtils.clamp(result.x,-19.7,19.7);result.z=THREE.MathUtils.clamp(result.z,-19.7,19.7);
  return result;
}
function collides(p,colliders,r){return colliders.some(c=>p.x+r>c.minX&&p.x-r<c.maxX&&p.z+r>c.minZ&&p.z-r<c.maxZ);}

export function nearestInteraction(position,round,self){
  if(!self||self.dead||self.escaped) return null;
  const checks=[];
  if(round?.phase==="active" && self.role!=="anomaly" && !self.weapon && (round.armoryCharges??0)>0) checks.push({kind:"armory",label:"OPEN SECURITY LOCKER",pos:WORLD.ARMORY,range:2});
  if(round?.phase==="active" && self.hp<self.maxHp && (round.medCharges??0)>0) checks.push({kind:"med",label:"USE FIELD MEDICAL",pos:WORLD.MED,range:2});
  if(!round?.keycardTaken) checks.push({kind:"keycard",label:"RECOVER THRESHOLD KEYCARD",pos:WORLD.KEYCARD,range:1.8});
  if(round?.keycardTaken && round?.phase==="active") checks.push({kind:"terminal",label:"INITIATE THRESHOLD EXTRACTION",pos:WORLD.TERMINAL,range:2});
  if(round?.phase==="extraction") {
    checks.push({kind:"extract",label:"CROSS THRESHOLD",pos:WORLD.GATE,range:2.4});
    if(self.role==="quarantine"||self.role==="security") checks.push({kind:"seal",label:"SEAL THRESHOLD",pos:WORLD.SEAL,range:2});
  }
  let best=null,bestD=999;
  for(const c of checks){const d=position.distanceTo(c.pos);if(d<c.range&&d<bestD){best=c;bestD=d;}}
  return best;
}
