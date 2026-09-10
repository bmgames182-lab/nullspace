import * as THREE from "three";

// Distinct visual room archetypes chosen from genuinely open Level 0 cells.
// Cosmetic only: these props never enter the movement collider list.
let sceneRef=null,built=false;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!sceneRef)sceneRef=this;return originalAdd.apply(this,objects)};

function material(color,rough=.9,metal=0){return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal})}
function box(scene,x,y,z,w,h,d,mat,ry=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.rotation.y=ry;m.userData.nullspaceArchetype=true;scene.add(m);return m}
function plane(scene,x,y,z,w,h,mat,rx=0,ry=0,rz=0){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.userData.nullspaceArchetype=true;scene.add(m);return m}
function cyl(scene,x,y,z,r,h,mat,rx=0,ry=0,rz=0){const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,8),mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.userData.nullspaceArchetype=true;scene.add(m);return m}
function textMat(text,accent="#b7a55e"){
  const c=document.createElement("canvas");c.width=640;c.height=144;const x=c.getContext("2d");x.fillStyle="#12130f";x.fillRect(0,0,640,144);x.strokeStyle=accent;x.lineWidth=4;x.strokeRect(4,4,632,136);x.fillStyle="#e1dcc2";x.font="700 28px ui-monospace,monospace";x.textAlign="center";x.textBaseline="middle";x.fillText(text,320,72);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:t,toneMapped:false})
}
function blockers(scene){
  const out=[];scene.traverse(o=>{if(!o.isMesh||o.userData.nullspaceArchetype||o.userData.nullspaceProp||o.userData.nullspaceSetpiece||o.isInstancedMesh)return;const b=new THREE.Box3().setFromObject(o),s=new THREE.Vector3();b.getSize(s);if(s.y<2.2||Math.min(s.x,s.z)>.55||Math.max(s.x,s.z)>5.1)return;out.push({minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z})});return out
}
function circleClear(x,z,r,bs){for(const b of bs){const cx=Math.max(b.minX,Math.min(x,b.maxX)),cz=Math.max(b.minZ,Math.min(z,b.maxZ));if((x-cx)**2+(z-cz)**2<r*r)return false}return true}
function candidates(scene){
  const bs=blockers(scene),protectedPts=[[-16,14],[14,13],[17,-14],[12.5,-14],[-17,-4],[4,-17],[-14,-14],[14,14]],cells=[];
  for(let x=-16;x<=16;x+=4)for(let z=-16;z<=16;z+=4){if(!circleClear(x,z,1.45,bs))continue;if(protectedPts.some(([px,pz])=>Math.hypot(x-px,z-pz)<3.5))continue;cells.push({x,z,score:Math.sin(x*17.17+z*9.31)+Math.cos(x*3.7-z*12.9)})}
  cells.sort((a,b)=>b.score-a.score);const chosen=[];for(const c of cells){if(chosen.every(q=>Math.hypot(c.x-q.x,c.z-q.z)>5.6))chosen.push(c);if(chosen.length===6)break}return chosen
}

function abandonedCamp(scene,c){
  const cloth=material(0x4a4937,1),dark=material(0x1c1e19,.92),paper=material(0xb8ae82,1),amber=new THREE.MeshStandardMaterial({color:0xb98537,emissive:0x6b4310,emissiveIntensity:1.7,roughness:.5});
  box(scene,c.x-.5,.035,c.z,.92,.07,1.75,cloth,.18);box(scene,c.x+.72,.18,c.z+.48,.58,.36,.42,dark,-.35);box(scene,c.x+.33,.11,c.z-.42,.16,.22,.16,amber);
  const light=new THREE.PointLight(0xe0a95a,1.35,3.2,2);light.position.set(c.x+.33,.45,c.z-.42);scene.add(light);
  for(let i=0;i<6;i++)plane(scene,c.x-.8+i*.28,.075,c.z+.68+(i%2)*.13,.2,.28,paper,-Math.PI/2,0,(i*.8)%1.4)
}
function floodedService(scene,c){
  const wet=new THREE.MeshPhysicalMaterial({color:0x4b5344,roughness:.12,metalness:.02,transparent:true,opacity:.36,depthWrite:false}),pipe=material(0x353934,.42,.56),dark=material(0x171916,.9,.12);
  for(const [dx,dz,sx,sz] of [[0,0,2.7,1.9],[.7,-.65,1.45,.8],[-.85,.55,1.05,.7]]){const p=plane(scene,c.x+dx,.016,c.z+dz,sx,sz,wet,-Math.PI/2);p.rotation.z=(dx+dz)*.4}
  cyl(scene,c.x-1.05,2.45,c.z+.55,.045,1.15,pipe,0,0,0);cyl(scene,c.x-.65,2.95,c.z+.55,.045,.8,pipe,0,0,Math.PI/2);box(scene,c.x+1.05,.72,c.z-.82,.42,1.44,.16,dark);
  const l=new THREE.PointLight(0x8ca990,.58,3.4,2);l.position.set(c.x,1.6,c.z);scene.add(l)
}
function maintenanceNest(scene,c){
  const pipe=material(0x3c4039,.4,.58),rust=material(0x674932,.7,.32),cable=material(0x11120f,.95,.05);
  for(let i=-1;i<=1;i++){cyl(scene,c.x+i*.42,2.82,c.z,.038,2.8,i===1?rust:pipe,Math.PI/2,0,0);cyl(scene,c.x,2.68,c.z+i*.48,.026,2.45,cable,0,0,Math.PI/2)}
  const spool=cyl(scene,c.x+.85,.2,c.z-.6,.32,.38,cable,Math.PI/2);spool.rotation.z=.2;box(scene,c.x-.92,.62,c.z+.75,.48,1.24,.18,pipe,.05)
}
function quarantineRoom(scene,c){
  const plastic=new THREE.MeshPhysicalMaterial({color:0xd6d1a7,transparent:true,opacity:.18,roughness:.26,side:THREE.DoubleSide,depthWrite:false}),yellow=material(0xb09235,.72),black=material(0x11120f,.92);
  for(let i=-1;i<=1;i++)plane(scene,c.x+i*.72,1.5,c.z, .64,2.6,plastic,0,0,(i*.03));
  for(let i=-2;i<=2;i++)box(scene,c.x+i*.55,.025,c.z-.9,.28,.025,1.55,i%2?black:yellow,.18);
  plane(scene,c.x,2.55,c.z-.04,2.2,.5,textMat("TEMPORARY HUMAN VERIFICATION"),0,0,0)
}
function deadWorkstation(scene,c){
  const desk=material(0x746f4d,.96),dark=material(0x161713,.9,.1),screen=new THREE.MeshStandardMaterial({color:0x26372f,emissive:0x1d3d31,emissiveIntensity:.65,roughness:.4});
  box(scene,c.x,.38,c.z,2.45,.76,.65,desk,.06);for(const dx of [-.65,.05,.68]){box(scene,c.x+dx,.91,c.z-.23,.56,.46,.08,dark,.06);box(scene,c.x+dx,.91,c.z-.276,.44,.32,.018,screen,.06)}
  box(scene,c.x-.95,.2,c.z+.72,.5,.4,.5,dark,-.4);box(scene,c.x+.9,.18,c.z+.64,.46,.36,.46,dark,.35);plane(scene,c.x,1.62,c.z-.36,2.2,.48,textMat("STATION 0-17 // SIGNAL LOST","#80967b"),0,0,0)
}
function wrongRoom(scene,c){
  const frame=material(0x57523a,.76),voidMat=new THREE.MeshBasicMaterial({color:0x030403,toneMapped:false}),red=new THREE.MeshBasicMaterial({color:0x7b211d,toneMapped:false});
  for(let i=0;i<3;i++){const z=c.z-.9+i*.9;box(scene,c.x-1.0,1.35,z,.12,2.7,.12,frame);box(scene,c.x+1.0,1.35,z,.12,2.7,.12,frame);box(scene,c.x,2.66,z,2.1,.12,.12,frame)}
  plane(scene,c.x,1.35,c.z+.92,1.8,2.45,voidMat,0,Math.PI,0);plane(scene,c.x,2.35,c.z+.9,1.45,.38,textMat("YOU PASSED THIS ROOM ALREADY","#7f2d29"),0,Math.PI,0);box(scene,c.x,.28,c.z+.25,.05,.05,.05,red)
}

export function buildRoomArchetypes(scene){
  if(!scene||built)return;built=true;const cells=candidates(scene);if(cells.length<3)return;
  const builders=[abandonedCamp,floodedService,maintenanceNest,quarantineRoom,deadWorkstation,wrongRoom];builders.slice(0,cells.length).forEach((fn,i)=>fn(scene,cells[i]));window.__NULLSPACE_ARCHETYPES__=cells.length
}
window.addEventListener("load",()=>setTimeout(()=>{if(sceneRef)buildRoomArchetypes(sceneRef)},1850));
