import * as THREE from "three";

// Cheap cosmetic pass for Level 0: distinct lighting pockets, directional grime and
// architectural weirdness. No collision is added here, so gameplay paths stay unchanged.
let capturedScene=null,started=false;
const previousAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!capturedScene)capturedScene=this;return previousAdd.apply(this,objects)};

function mat(color,opts={}){return new THREE.MeshStandardMaterial({color,roughness:.9,metalness:0,...opts})}
function basic(color,opacity=1){return new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity>=1,toneMapped:false,side:THREE.DoubleSide})}
function addBox(scene,x,y,z,w,h,d,material,ry=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.rotation.y=ry;m.userData.nullspaceFx=true;scene.add(m);return m}
function addPlane(scene,x,y,z,w,h,material,rx=0,ry=0,rz=0){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.userData.nullspaceFx=true;scene.add(m);return m}
function labelTexture(text,fg="#d9cf9a",bg="rgba(22,24,18,.92)"){
  const c=document.createElement("canvas");c.width=768;c.height=192;const ctx=c.getContext("2d");
  ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle=fg;ctx.lineWidth=8;ctx.strokeRect(8,8,c.width-16,c.height-16);
  ctx.fillStyle=fg;ctx.font="700 56px ui-monospace,monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,c.width/2,c.height/2);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t
}
function sign(scene,text,x,y,z,ry=0,scale=1){const m=new THREE.MeshBasicMaterial({map:labelTexture(text),toneMapped:false});return addPlane(scene,x,y,z,2.7*scale,.68*scale,m,0,ry,0)}

function addCeilingVoids(scene){
  const voidMat=basic(0x030403);const rim=mat(0x666453,{roughness:.96});
  for(const [x,z,r] of [[-10,6,.1],[6,10,-.12],[10,-2,.06],[-2,-10,-.08]]){
    addPlane(scene,x,3.072,z,2.9,1.55,voidMat,Math.PI/2,0,r);
    addBox(scene,x-1.47,3.055,z,.06,.08,1.65,rim,r);addBox(scene,x+1.47,3.055,z,.06,.08,1.65,rim,r)
  }
}
function addConduit(scene){
  const pipe=mat(0x282c28,{roughness:.6,metalness:.55});
  for(const [x,z,len,ry] of [[-6,-13,5.5,0],[11,5,4.2,Math.PI/2],[-13,9,3.8,Math.PI/2]]){
    const g=new THREE.CylinderGeometry(.035,.035,len,8);const m=new THREE.Mesh(g,pipe);m.rotation.z=Math.PI/2;m.rotation.y=ry;m.position.set(x,2.78,z);m.userData.nullspaceFx=true;scene.add(m)
  }
}
function addFloorWarnings(scene){
  const yellow=basic(0xc8aa43,.72),dark=basic(0x171813,.78);
  for(const [x,z,rz] of [[13,-14,0],[-16,-4,Math.PI/2],[4,-16.6,0]]){
    for(let i=-2;i<=2;i++){
      const p=addPlane(scene,x+i*.34,.015,z,.17,1.65,i%2?dark:yellow,-Math.PI/2,0,rz+.55);p.renderOrder=2
    }
  }
}
function addSigns(scene){
  sign(scene,"NO RETURN",-8,1.72,19.87,0,.72);
  sign(scene,"SECTOR 03",19.87,1.75,4,-Math.PI/2,.66);
  sign(scene,"AUTHORIZED PERSONNEL",-19.87,1.72,-9,Math.PI/2,.58);
  sign(scene,"THRESHOLD →",8,1.72,-19.87,Math.PI,.7)
}
function addLightPocket(scene,x,z,color,intensity,distance){const l=new THREE.PointLight(color,intensity,distance,2);l.position.set(x,2.55,z);l.userData.nullspaceFx=true;scene.add(l);return l}
function addLightZones(scene){
  const animated=[];
  animated.push({l:addLightPocket(scene,-12,9,0xb4d5c4,1.05,7.5),base:1.05,mode:"breathe",phase:.4});
  animated.push({l:addLightPocket(scene,9,8,0xa9c8bb,.85,6.6),base:.85,mode:"breathe",phase:2.1});
  animated.push({l:addLightPocket(scene,14,-13,0xc64c3f,1.8,6),base:1.8,mode:"alarm",phase:.2});
  animated.push({l:addLightPocket(scene,-15,-5,0xd0a84b,1.4,5.5),base:1.4,mode:"fault",phase:1.1});
  return animated
}
function addLightHaze(scene){
  const geo=new THREE.ConeGeometry(1.5,5.2,18,1,true);const haze=basic(0xe7ddb0,.028);haze.depthWrite=false;
  for(const [x,z] of [[-12,9],[9,8],[14,-13]]){const m=new THREE.Mesh(geo,haze.clone());m.position.set(x,1.4,z);m.rotation.x=Math.PI;m.userData.nullspaceFx=true;scene.add(m)}
}
function addWallScuffs(scene){
  const smear=basic(0x26251b,.17);smear.depthWrite=false;
  for(const [x,y,z,w,h,ry,rz] of [[-19.88,1.1,2,.55,1.8,Math.PI/2,.16],[19.88,.9,-7,.4,1.3,-Math.PI/2,-.2],[-5,1.02,19.88,.42,1.6,Math.PI,.08]]){
    const p=addPlane(scene,x,y,z,w,h,smear.clone(),0,ry,rz);p.renderOrder=1
  }
}
function boot(scene){
  if(started||!scene)return;started=true;
  addCeilingVoids(scene);addConduit(scene);addFloorWarnings(scene);addSigns(scene);addWallScuffs(scene);addLightHaze(scene);
  const lights=addLightZones(scene);let last=0;
  function tick(t){
    if(t-last>45){last=t;for(const a of lights){
      if(a.mode==="breathe")a.l.intensity=a.base*(.92+Math.sin(t*.0008+a.phase)*.08);
      else if(a.mode==="alarm")a.l.intensity=a.base*(.3+.7*Math.max(0,Math.sin(t*.006+a.phase)));
      else{const s=Math.sin(t*.033+a.phase)+Math.sin(t*.081+a.phase*2);a.l.intensity=a.base*(s>1.25?.12:s>.8?.48:1)}
    }}
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick);window.__NULLSPACE_LIMINAL_FX__=true
}
window.addEventListener("load",()=>setTimeout(()=>boot(capturedScene),900));
