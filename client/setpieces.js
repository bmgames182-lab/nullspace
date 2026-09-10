import * as THREE from "three";

// Memorable, low-cost Level 0 landmarks. Cosmetic only: no colliders, no gameplay authority.
let sceneRef=null,built=false;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!sceneRef)sceneRef=this;return originalAdd.apply(this,objects)};

function mat(color,rough=.9,metal=0){return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal})}
function emissive(color,intensity=1){return new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity,roughness:.45})}
function box(scene,x,y,z,w,h,d,m,ry=0){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.rotation.y=ry;o.userData.nullspaceSetpiece=true;scene.add(o);return o}
function plane(scene,x,y,z,w,h,m,rx=0,ry=0,rz=0){const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.userData.nullspaceSetpiece=true;scene.add(o);return o}
function textTexture(text,accent="#c9b66a",sub=""){
  const c=document.createElement("canvas");c.width=768;c.height=192;const x=c.getContext("2d");x.fillStyle="#10110d";x.fillRect(0,0,c.width,c.height);x.strokeStyle=accent;x.lineWidth=5;x.strokeRect(5,5,c.width-10,c.height-10);x.fillStyle="#e8e4ce";x.font="700 42px ui-monospace,monospace";x.textAlign="center";x.fillText(text,384,88);if(sub){x.fillStyle="#a8a58f";x.font="500 22px ui-monospace,monospace";x.fillText(sub,384,135)}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t
}
function sign(scene,x,y,z,text,accent,sub="",ry=0){const m=new THREE.MeshBasicMaterial({map:textTexture(text,accent,sub),toneMapped:false});return plane(scene,x,y,z,2.7,.68,m,0,ry,0)}

function buildRedCheckpoint(scene){
  const metal=mat(0x252824,.62,.35),dark=mat(0x111310,.82,.12),red=emissive(0x7c1716,1.7),yellow=mat(0xb39538,.72);
  // Quarantine gantry near extraction: visually anchors the final objective.
  box(scene,15.1,1.48,-11.9,.18,2.96,3.0,metal);box(scene,18.6,1.48,-11.9,.18,2.96,3.0,metal);box(scene,16.85,2.82,-11.9,3.7,.18,3.0,metal);
  for(let i=0;i<6;i++)box(scene,14.9+i*.78,.026,-10.75,.5,.025,1.8,i%2?dark:yellow,-.12);
  sign(scene,16.85,2.48,-10.35,"QUARANTINE LINE","#b63f38","CROSSING REQUIRES HUMAN STATUS",Math.PI);
  for(const x of [15.35,18.35]){const l=box(scene,x,2.58,-10.55,.16,.16,.16,red);l.rotation.z=.2;const p=new THREE.PointLight(0xb72320,1.4,4.2,2);p.position.set(x,2.45,-10.7);scene.add(p)}
}

function buildDeadOffice(scene){
  const beige=mat(0x8f8658,.96),dark=mat(0x171712,.96),paper=mat(0xc9c1a0,1),screen=emissive(0x26352c,.36);
  // An abandoned admin nook with monitors and scattered files.
  box(scene,-9,.36,9,3.4,.72,.72,beige,.05);box(scene,-9,1.0,8.71,1.1,.62,.08,dark,.05);box(scene,-9,1.0,8.66,.88,.43,.025,screen,.05);
  box(scene,-10.25,.19,8.15,.58,.38,.58,dark,-.4);box(scene,-7.9,.17,9.8,.48,.34,.46,dark,.7);
  for(let i=0;i<9;i++){const p=plane(scene,-10.1+(i%3)*.55,.745,8.75+Math.floor(i/3)*.24,.35,.25,paper,-Math.PI/2,0,(i*.73)%1.4);p.position.y=.755+i*.001}
  sign(scene,-9,1.72,8.58,"ARCHIVE 0-C","#b9aa61","DO NOT FILE NAMES OF THE MISSING",0);
  const lamp=new THREE.PointLight(0xb9c6a0,.8,3.6,2);lamp.position.set(-9.1,1.55,9.1);scene.add(lamp)
}

function buildCeilingWound(scene){
  const voidMat=new THREE.MeshBasicMaterial({color:0x010201,side:THREE.DoubleSide,toneMapped:false}),cableMat=mat(0x0c0d0b,.85,.2);
  // A large ceiling void with dangling cables. Nothing collides with the player.
  plane(scene,2.5,3.075,7.5,3.4,2.5,voidMat,Math.PI/2,0,.06);
  const points=[[-1.1,0],[-.55,.55],[.15,.82],[.7,.5],[1.15,0]];
  for(let j=0;j<3;j++){
    const curve=new THREE.CatmullRomCurve3(points.map(([x,z],i)=>new THREE.Vector3(2.5+x,3.02-(i===2?.9+j*.18:0),7.5+z+j*.16)));
    const cable=new THREE.Mesh(new THREE.TubeGeometry(curve,16,.016,5,false),cableMat);cable.userData.nullspaceSetpiece=true;scene.add(cable)
  }
  const glow=new THREE.PointLight(0x89936e,.42,3,2);glow.position.set(2.5,2.55,7.5);scene.add(glow)
}

function buildFalseExit(scene){
  const dark=mat(0x0d0e0b,.92),frame=mat(0x5d5940,.75),red=emissive(0x6b1916,.9);
  box(scene,-15.7,1.42,-1.2,2.2,2.84,.12,dark);box(scene,-16.86,1.46,-1.15,.16,2.95,.2,frame);box(scene,-14.54,1.46,-1.15,.16,2.95,.2,frame);box(scene,-15.7,2.9,-1.15,2.48,.15,.2,frame);
  sign(scene,-15.7,2.42,-1.08,"EXIT","#b33831","THIS IS NOT AN EXIT",0);
  box(scene,-15.7,.78,-1.05,.07,.07,.04,red)
}

function buildObservationMark(scene){
  const glass=new THREE.MeshPhysicalMaterial({color:0x75867a,transparent:true,opacity:.16,roughness:.2,metalness:.05,depthWrite:false}),frame=mat(0x262a25,.5,.45);
  box(scene,7.7,1.55,-6,.1,2.1,4.3,glass);box(scene,7.65,.48,-6,.14,.09,4.5,frame);box(scene,7.65,2.62,-6,.14,.09,4.5,frame);
  for(const z of [-8.1,-6,-3.9])box(scene,7.65,1.55,z,.14,2.15,.09,frame);
  sign(scene,7.56,2.35,-6,"OBSERVATION","#87977e","DO NOT KNOCK",Math.PI/2)
}

export function buildSetpieces(scene){if(!scene||built)return;built=true;buildRedCheckpoint(scene);buildDeadOffice(scene);buildCeilingWound(scene);buildFalseExit(scene);buildObservationMark(scene);window.__NULLSPACE_SETPIECES__=true}
window.addEventListener("load",()=>setTimeout(()=>{if(sceneRef)buildSetpieces(sceneRef)},900));
