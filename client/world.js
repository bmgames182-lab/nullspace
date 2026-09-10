import * as THREE from "three";

export const SPAWNS={
  blue:[[-28,-26],[-25,-24],[-28,-19],[-22,-26],[-29,-12],[-20,-22],[-27,-6],[-18,-18],[-23,-3]],
  red:[[28,26],[25,24],[28,19],[22,26],[29,12],[20,22],[27,6],[18,18],[23,3]]
};

function canvasTexture(base,noise=24){
  const c=document.createElement("canvas");c.width=c.height=512;const x=c.getContext("2d");x.fillStyle=base;x.fillRect(0,0,512,512);
  for(let i=0;i<7600;i++){const light=Math.random()>.5,a=.025+Math.random()*.06;x.fillStyle=light?`rgba(255,255,255,${a})`:`rgba(0,0,0,${a})`;x.fillRect(Math.random()*512,Math.random()*512,1+Math.random()*3,1+Math.random()*3)}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;t.colorSpace=THREE.SRGBColorSpace;return t
}

export function buildArena(scene,physics,RAPIER,{highQuality=true}={}){
  const obstacles=[],dynamicProps=[],shootableMeshes=[];
  scene.background=new THREE.Color(0x727b77);scene.fog=new THREE.Fog(0x727b77,30,100);
  const groundTex=canvasTexture("#535852",34);groundTex.repeat.set(18,18);const concreteTex=canvasTexture("#73766f",28);concreteTex.repeat.set(2,2);
  const groundMat=new THREE.MeshStandardMaterial({map:groundTex,color:0x747a73,roughness:.98}),concrete=new THREE.MeshStandardMaterial({map:concreteTex,color:0x898d85,roughness:.94}),darkConcrete=new THREE.MeshStandardMaterial({color:0x353a37,roughness:.96}),metal=new THREE.MeshStandardMaterial({color:0x394347,roughness:.66,metalness:.5}),blueMetal=new THREE.MeshStandardMaterial({color:0x3b5058,roughness:.78,metalness:.35}),rust=new THREE.MeshStandardMaterial({color:0x5b4035,roughness:.91,metalness:.2}),tarp=new THREE.MeshStandardMaterial({color:0x475047,roughness:.96}),sand=new THREE.MeshStandardMaterial({color:0x81785b,roughness:1});
  scene.add(new THREE.HemisphereLight(0xd9e1dc,0x222826,1.5));const sun=new THREE.DirectionalLight(0xfff3dc,2.55);sun.position.set(-19,35,-14);sun.target.position.set(0,0,0);scene.add(sun,sun.target);sun.castShadow=highQuality;if(highQuality){sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-39;sun.shadow.camera.right=39;sun.shadow.camera.top=39;sun.shadow.camera.bottom=-39;sun.shadow.camera.near=1;sun.shadow.camera.far=82;sun.shadow.bias=-.00025}

  function fixedBox(x,y,z,w,h,d,mat=concrete,collide=true){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.receiveShadow=highQuality;mesh.castShadow=highQuality&&h>.7;scene.add(mesh);if(collide){const rb=physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,y,z));physics.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2).setFriction(.9),rb);obstacles.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,mesh})}shootableMeshes.push(mesh);return mesh}
  function dynamicBox(x,y,z,w,h,d,mat=rust){const rb=physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,z).setLinearDamping(.35).setAngularDamping(.58));physics.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2).setDensity(.55).setFriction(.82),rb);const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.castShadow=highQuality;mesh.receiveShadow=highQuality;mesh.userData.physicsBody=rb;scene.add(mesh);dynamicProps.push({body:rb,mesh});shootableMeshes.push(mesh);return{body:rb,mesh}}
  function lamp(x,z,color=0xffdfaa,intensity=2.1){fixedBox(x,2.75,z,.12,5.5,.12,metal,false);const l=new THREE.PointLight(color,intensity,13,2);l.position.set(x,4.8,z);scene.add(l)}

  fixedBox(0,-.15,0,70,.3,70,groundMat,true);fixedBox(0,2,-35,70,4,.45,darkConcrete);fixedBox(0,2,35,70,4,.45,darkConcrete);fixedBox(-35,2,0,.45,4,70,darkConcrete);fixedBox(35,2,0,.45,4,70,darkConcrete);

  // West and east warehouse shells. Door openings remain physically open.
  for(const side of [-1,1]){const cx=side*13;fixedBox(cx,1.6,-12,14,3.2,.4,concrete);fixedBox(cx,1.6,12,14,3.2,.4,concrete);fixedBox(cx-side*7,1.6,0,.4,3.2,24,concrete);fixedBox(cx+side*7,1.6,-7,.4,3.2,10,concrete);fixedBox(cx+side*7,1.6,7,.4,3.2,10,concrete);fixedBox(cx,3.22,0,14,.18,24,darkConcrete,false);fixedBox(cx-side*2.6,1.45,-4.8,.3,2.9,7.2,concrete);fixedBox(cx+side*2.4,1.45,4.6,.3,2.9,8,concrete);fixedBox(cx-side*.8,.55,0,4.6,1.1,.55,concrete);lamp(cx-side*3,-8,0xffcfa0,1.35);lamp(cx+side*3,8,0xffcfa0,1.35)}

  // Central checkpoint with two door-sized gaps.
  fixedBox(-4.5,1.45,-.8,.42,2.9,4.8,concrete);fixedBox(4.5,1.45,-.8,.42,2.9,4.8,concrete);fixedBox(-3.2,1.45,4.5,2.6,2.9,.38,concrete);fixedBox(3.2,1.45,4.5,2.6,2.9,.38,concrete);fixedBox(0,1.45,4.5,1.3,2.9,.38,darkConcrete);fixedBox(0,.46,-4.1,7.2,.92,.6,concrete);lamp(0,1.4,0xffc48f,1.7);

  // Axis-aligned containers: visual and physics extents are intentionally identical.
  const containers=[[-25,4,2.55,6.2],[-25,11,2.55,6.2],[-16,23,6.2,2.55],[25,-4,2.55,6.2],[25,-11,2.55,6.2],[16,-23,6.2,2.55],[-3,22,6.2,2.55],[4,-22,6.2,2.55]];
  containers.forEach(([x,z,w,d],i)=>fixedBox(x,1.3,z,w,2.6,d,i%2?blueMetal:rust));

  // Cover lanes.
  for(const [x,z,w,d] of [[-29,-9,5,1],[-22,-2,4,1],[-19,16,5,1],[29,9,5,1],[22,2,4,1],[19,-16,5,1],[-7,-18,4,1],[8,17,4,1],[-1,-11,5,1],[2,11,5,1]])fixedBox(x,.48,z,w,.96,d,concrete);
  for(const [x,z] of [[-11,-18],[-7,-18],[11,18],[7,18],[-29,20],[29,-20]])for(let i=0;i<5;i++)fixedBox(x+(i-2)*.72,.24,z,.68,.48,.35,sand);

  // Small barricade clusters and physics crates.
  for(const [x,z] of [[-14,-3],[-9,16],[14,3],[9,-16],[-4,10],[5,-9]]){fixedBox(x,.65,z,2.3,1.3,.4,tarp);fixedBox(x+.85,1.1,z+.15,.5,2.2,.5,metal,false)}
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2,rad=8+(i%4)*4,x=Math.cos(a)*rad,z=Math.sin(a)*rad;if(Math.abs(x)<5&&Math.abs(z)<6)continue;dynamicBox(x,.48,z,.72,.9,.72,i%3?rust:tarp)}

  // Light posts and distant silhouettes.
  for(const [x,z] of [[-30,-25],[-17,-6],[-7,14],[8,-14],[17,6],[30,25]])lamp(x,z);
  for(let i=0;i<16;i++){const h=6+Math.random()*11,w=3+Math.random()*5,x=-55+Math.random()*110,z=47+Math.random()*24;fixedBox(x,h/2,z,w,h,w,darkConcrete,false)}

  return{obstacles,dynamicProps,shootableMeshes,sun,update(){for(const p of dynamicProps){const t=p.body.translation(),q=p.body.rotation();p.mesh.position.set(t.x,t.y,t.z);p.mesh.quaternion.set(q.x,q.y,q.z,q.w)}}}
}

export function moveCircle(from,to,obstacles,r=.32){let x=to.x,z=from.z;if(collides(x,z,obstacles,r))x=from.x;z=to.z;if(collides(x,z,obstacles,r))z=from.z;if(collides(x,z,obstacles,r)){x=from.x;z=from.z}return{x,z}}
function collides(x,z,obs,r){for(const o of obs)if(x+r>o.minX&&x-r<o.maxX&&z+r>o.minZ&&z-r<o.maxZ)return true;return false}
export function lineBlocked(a,b,obstacles){const dx=b.x-a.x,dz=b.z-a.z;for(const o of obstacles){let t0=0,t1=1;for(const [p,q] of [[-dx,a.x-o.minX],[dx,o.maxX-a.x],[-dz,a.z-o.minZ],[dz,o.maxZ-a.z]]){if(Math.abs(p)<1e-7){if(q<0){t0=2;break}}else{const t=q/p;if(p<0){if(t>t1){t0=2;break}if(t>t0)t0=t}else{if(t<t0){t0=2;break}if(t<t1)t1=t}}}if(t0<=t1&&t0>=0&&t0<=1)return true}return false}
