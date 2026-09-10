import * as THREE from "three";

export const SPAWNS={
  blue:[[-25,-22],[-22,-24],[-26,-17],[-20,-19],[-24,-12],[-18,-23],[-28,-7],[-17,-15],[-23,-5]],
  red:[[25,22],[22,24],[26,17],[20,19],[24,12],[18,23],[28,7],[17,15],[23,5]]
};

function canvasTexture(base,noise=24){
  const c=document.createElement("canvas");c.width=c.height=512;const x=c.getContext("2d");x.fillStyle=base;x.fillRect(0,0,512,512);
  for(let i=0;i<9000;i++){const v=(Math.random()-.5)*noise,a=.03+Math.random()*.08;x.fillStyle=`rgba(${v>0?255:0},${v>0?255:0},${v>0?255:0},${a})`;x.fillRect(Math.random()*512,Math.random()*512,1+Math.random()*3,1+Math.random()*3)}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;t.colorSpace=THREE.SRGBColorSpace;return t
}

export function buildArena(scene,physics,RAPIER,{highQuality=true}={}){
  const obstacles=[],dynamicProps=[],shootableMeshes=[];
  scene.background=new THREE.Color(0x77817c);scene.fog=new THREE.Fog(0x78827d,28,92);
  const groundTex=canvasTexture("#525651",34);groundTex.repeat.set(18,18);
  const concreteTex=canvasTexture("#70736d",30);concreteTex.repeat.set(2,2);
  const groundMat=new THREE.MeshStandardMaterial({map:groundTex,color:0x737872,roughness:.96});
  const concrete=new THREE.MeshStandardMaterial({map:concreteTex,color:0x888c84,roughness:.92});
  const darkConcrete=new THREE.MeshStandardMaterial({color:0x3a3e3b,roughness:.95});
  const metal=new THREE.MeshStandardMaterial({color:0x394348,roughness:.68,metalness:.48});
  const blueMetal=new THREE.MeshStandardMaterial({color:0x415862,roughness:.77,metalness:.35});
  const rust=new THREE.MeshStandardMaterial({color:0x5c4338,roughness:.9,metalness:.2});
  const tarp=new THREE.MeshStandardMaterial({color:0x4c5547,roughness:.94});
  const sand=new THREE.MeshStandardMaterial({color:0x7d765c,roughness:1});

  const hemi=new THREE.HemisphereLight(0xd9e1dc,0x242a28,1.45);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xfff5dc,2.6);sun.position.set(-18,34,-12);sun.target.position.set(0,0,0);scene.add(sun,sun.target);
  sun.castShadow=highQuality;if(highQuality){sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-38;sun.shadow.camera.right=38;sun.shadow.camera.top=38;sun.shadow.camera.bottom=-38;sun.shadow.camera.near=1;sun.shadow.camera.far=80;sun.shadow.bias=-.00025}

  function fixedBox(x,y,z,w,h,d,mat=concrete,collide=true){
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.receiveShadow=highQuality;m.castShadow=highQuality&&h>1;scene.add(m);
    if(collide){const rb=physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,y,z));physics.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2).setFriction(.9),rb);obstacles.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,mesh:m})}
    shootableMeshes.push(m);return m
  }
  function dynamicBox(x,y,z,w,h,d,mat=rust){
    const rb=physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,z).setLinearDamping(.3).setAngularDamping(.55));physics.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2).setDensity(.55).setFriction(.8),rb);
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.castShadow=highQuality;m.receiveShadow=highQuality;scene.add(m);dynamicProps.push({body:rb,mesh:m});shootableMeshes.push(m);return{body:rb,mesh:m}
  }

  fixedBox(0,-.15,0,70,.3,70,groundMat,true);
  fixedBox(0,2.0,-35,70,4,.45,darkConcrete);fixedBox(0,2.0,35,70,4,.45,darkConcrete);fixedBox(-35,2.0,0,.45,4,70,darkConcrete);fixedBox(35,2.0,0,.45,4,70,darkConcrete);

  // Two battered structures with door gaps and sightlines through the middle.
  for(const side of [-1,1]){
    const cx=side*13;
    fixedBox(cx,1.6,-12,14,3.2,.4,concrete);fixedBox(cx,1.6,12,14,3.2,.4,concrete);
    fixedBox(cx-side*7,1.6,0,.4,3.2,24,concrete);
    fixedBox(cx+side*7,1.6,-7,.4,3.2,10,concrete);fixedBox(cx+side*7,1.6,7,.4,3.2,10,concrete);
    fixedBox(cx,3.22,0,14,.18,24,darkConcrete,false);
    // internal walls, intentionally offset so AI/player can flow around them.
    fixedBox(cx-side*1.5,1.5,-4.8,7,.25?0.25:0.25,0.3,concrete,false);
    fixedBox(cx-side*2.6,1.45,-4.8,.3,2.9,7.2,concrete);
    fixedBox(cx+side*2.4,1.45,4.6,.3,2.9,8,concrete);
  }

  // Central kill-house / shattered checkpoint.
  fixedBox(0,1.45,-3,9,.34?0.34:0.34,.42,concrete,false);
  fixedBox(-4.5,1.45,-.8,.42,2.9,4.8,concrete);fixedBox(4.5,1.45,-.8,.42,2.9,4.8,concrete);
  fixedBox(-3.2,1.45,4.5,2.6,2.9,.38,concrete);fixedBox(3.2,1.45,4.5,2.6,2.9,.38,concrete);
  fixedBox(0,1.45,4.5,1.3,2.9,.38,darkConcrete);

  // Shipping containers create long, readable lanes.
  const containers=[[-25,0,4,0],[-25,0,11,0],[-16,0,23,Math.PI/2],[25,0,-4,0],[25,0,-11,0],[16,0,-23,Math.PI/2],[-3,0,22,Math.PI/2],[4,0,-22,Math.PI/2]];
  for(let i=0;i<containers.length;i++){const [x,,z,r]=containers[i],horizontal=Math.abs(Math.sin(r))>.5,w=horizontal?6.2:2.55,d=horizontal?2.55:6.2;const m=fixedBox(x,1.3,z,w,2.6,d,i%2?blueMetal:rust);m.rotation.y=r}

  // Jersey barriers / sandbag cover.
  const cover=[[-28,-9,5,1],[-22,-2,4,1],[-19,16,5,1],[28,9,5,1],[22,2,4,1],[19,-16,5,1],[-7,-18,4,1],[8,17,4,1],[-1,-11,5,1],[2,11,5,1]];
  for(const [x,z,w,d] of cover)fixedBox(x,.48,z,w,.96,d,concrete);
  for(const [x,z,r] of [[-11,-18,0],[-7,-18,0],[11,18,0],[7,18,0],[-29,20,.4],[29,-20,.4]]){
    for(let i=0;i<5;i++){const s=fixedBox(x+(i-2)*.72,.24,z,.68,.48,.35,sand);s.rotation.y=r}
  }

  // Destructible-feeling physics clutter.
  for(let i=0;i<14;i++){const a=i/14*Math.PI*2,rad=8+(i%4)*4,x=Math.cos(a)*rad,z=Math.sin(a)*rad;if(Math.abs(x)<5&&Math.abs(z)<6)continue;dynamicBox(x,.45,z,.72,.9,.72,i%3?rust:tarp)}

  // Lamps, smoke plumes and distant industrial silhouettes.
  for(const [x,z] of [[-30,-25],[-17,-6],[-7,14],[8,-14],[17,6],[30,25]]){
    fixedBox(x,2.8,z,.13,5.6,.13,metal,false);const lamp=new THREE.PointLight(0xffe0ae,2.1,13,2);lamp.position.set(x,4.9,z);scene.add(lamp);
  }
  for(let i=0;i<18;i++){const h=6+Math.random()*10,w=3+Math.random()*5,x=-55+Math.random()*110,z=45+Math.random()*22;fixedBox(x,h/2,z,w,h,w,darkConcrete,false)}

  return{obstacles,dynamicProps,shootableMeshes,sun,update(){for(const p of dynamicProps){const t=p.body.translation(),q=p.body.rotation();p.mesh.position.set(t.x,t.y,t.z);p.mesh.quaternion.set(q.x,q.y,q.z,q.w)}}}
}

export function moveCircle(from,to,obstacles,r=.32){
  let x=to.x,z=from.z;
  if(collides(x,z,obstacles,r))x=from.x;
  z=to.z;if(collides(x,z,obstacles,r))z=from.z;
  if(collides(x,z,obstacles,r)){x=from.x;z=from.z}
  return{x,z}
}
function collides(x,z,obs,r){for(const o of obs)if(x+r>o.minX&&x-r<o.maxX&&z+r>o.minZ&&z-r<o.maxZ)return true;return false}

export function lineBlocked(a,b,obstacles){
  const dx=b.x-a.x,dz=b.z-a.z;
  for(const o of obstacles){let t0=0,t1=1;for(const [p,q] of [[-dx,a.x-o.minX],[dx,o.maxX-a.x],[-dz,a.z-o.minZ],[dz,o.maxZ-a.z]]){if(Math.abs(p)<1e-7){if(q<0){t0=2;break}}else{const t=q/p;if(p<0){if(t>t1){t0=2;break}if(t>t0)t0=t}else{if(t<t0){t0=2;break}if(t<t1)t1=t}}}if(t0<=t1&&t0>=0&&t0<=1)return true}return false
}
