import * as THREE from "three";

let sceneRef=null,built=false;
const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!sceneRef)sceneRef=this;return originalAdd.apply(this,objects)};

const mat=(color,rough=.9,metal=.0)=>new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal});
const yellow=mat(0xb8aa68,.96),paper=mat(0xcbbd78,.99),dark=mat(0x20231f,.88),metal=mat(0x3e443e,.55,.35),wet=new THREE.MeshPhysicalMaterial({color:0x514d35,roughness:.18,metalness:0,transparent:true,opacity:.38,depthWrite:false});

function box(scene,x,y,z,w,h,d,m,ry=0){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.rotation.y=ry;o.userData.nullspaceDetail=true;scene.add(o);return o}
function plane(scene,x,y,z,w,h,m,rx=0,ry=0,rz=0){const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.userData.nullspaceDetail=true;scene.add(o);return o}
function decalMat(color,opacity=.5){return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,toneMapped:false})}

function peeledWallpaper(scene){
  const spots=[[-11,1.7,-5,0],[-3,1.55,11,Math.PI/2],[9,1.8,7,Math.PI],[15,1.45,-2,-Math.PI/2],[-15,1.9,4,0]];
  for(const [x,y,z,r] of spots){
    const group=new THREE.Group();group.position.set(x,y,z);group.rotation.y=r;group.userData.nullspaceDetail=true;
    for(let i=0;i<4;i++){
      const strip=new THREE.Mesh(new THREE.PlaneGeometry(.24+.08*Math.sin(i),.72+i*.11),i%2?paper:yellow);
      strip.position.set((i-1.5)*.2,0,-.012-i*.006);strip.rotation.z=(i-1.5)*.08;strip.rotation.x=.05*i;group.add(strip)
    }
    scene.add(group)
  }
}

function wetCarpet(scene){
  const puddles=[[-7,-10,2.6,1.1],[6,9,2.2,.85],[11,-7,3.0,1.05],[-14,8,1.9,.8],[2,-1,2.4,.9]];
  for(const [x,z,w,h] of puddles){
    const p=plane(scene,x,.014,z,w,h,wet,-Math.PI/2,0,.12);p.material=wet.clone();p.material.opacity=.22+Math.random()*.2;
  }
}

function ceilingDamage(scene){
  const voidMat=decalMat(0x050605,.96),pipeMat=mat(0x30352f,.45,.46);
  const spots=[[-8,-2],[5,5],[12,11],[-13,-12]];
  for(const [x,z] of spots){
    plane(scene,x,3.087,z,2.2,1.6,voidMat,Math.PI/2,0,.1);
    for(let i=0;i<3;i++){
      const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,2.2,7),pipeMat);pipe.position.set(x- .42+i*.42,2.9,z);pipe.rotation.z=Math.PI/2;pipe.rotation.y=(i-1)*.05;pipe.userData.nullspaceDetail=true;scene.add(pipe)
    }
  }
}

function damagedTrim(scene){
  const chunks=[[-9,.09,14,1.7,.12,.08,0],[7,.09,-13,1.2,.12,.08,0],[-18,.09,3,.08,.12,1.55,0],[18,.09,-8,.08,.12,1.4,0]];
  for(const c of chunks)box(scene,...c,dark);
}

function wallScars(scene){
  const scar=decalMat(0x4d4529,.36);
  const coords=[[-12,1.1,-18,0],[4,1.6,18,Math.PI],[18,1.3,4,-Math.PI/2],[-18,1.45,-6,Math.PI/2]];
  for(const [x,y,z,r] of coords){for(let i=0;i<7;i++){const s=plane(scene,x+(r===0||r===Math.PI?(i-3)*.08:0),y+i*.04,z+(Math.abs(r)===Math.PI/2?(i-3)*.08:0),.03,.45,scar,0,r,(i-3)*.12);s.position.x+=.004*Math.sin(i*3);s.position.z+=.004*Math.cos(i*2)}}
}

function tapedZones(scene){
  const tape=decalMat(0xc6a33f,.84);
  const zones=[[12.5,-14],[17,-14],[-17,-4],[4,-17]];
  for(const [x,z] of zones){
    for(let i=-2;i<=2;i++)plane(scene,x+i*.46,.021,z+.85, .32,.055,tape,-Math.PI/2,0,i*.18);
  }
}

function floorArrows(scene){
  const arrowMat=decalMat(0x74682f,.48);
  const canvas=document.createElement("canvas");canvas.width=128;canvas.height=128;const c=canvas.getContext("2d");c.clearRect(0,0,128,128);c.fillStyle="#d2bd57";c.beginPath();c.moveTo(64,4);c.lineTo(118,58);c.lineTo(82,58);c.lineTo(82,124);c.lineTo(46,124);c.lineTo(46,58);c.lineTo(10,58);c.closePath();c.fill();
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;const m=new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:.28,depthWrite:false,toneMapped:false});
  const spots=[[-10,-14,Math.PI/2],[-3,-5,0],[8,2,-Math.PI/2],[13,-10,Math.PI]];
  for(const [x,z,r] of spots)plane(scene,x,.02,z,.75,.75,m.clone(),-Math.PI/2,0,r);
}

function workstation(scene){
  const group=new THREE.Group();group.position.set(-5,0,6);group.userData.nullspaceDetail=true;
  const desk=new THREE.Mesh(new THREE.BoxGeometry(2.1,.08,.75),metal);desk.position.y=.76;group.add(desk);
  for(const sx of [-.9,.9]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.08,.74,.08),dark);leg.position.set(sx,.38,0);group.add(leg)}
  const screenMat=new THREE.MeshStandardMaterial({color:0x273029,emissive:0x224830,emissiveIntensity:.72,roughness:.45});
  const monitor=new THREE.Mesh(new THREE.BoxGeometry(.68,.42,.08),dark);monitor.position.set(.35,1.03,0);group.add(monitor);const scr=new THREE.Mesh(new THREE.PlaneGeometry(.55,.3),screenMat);scr.position.set(.35,1.03,-.041);scr.rotation.y=Math.PI;group.add(scr);
  const papers=new THREE.Mesh(new THREE.BoxGeometry(.42,.018,.3),paper);papers.position.set(-.48,.81,-.08);papers.rotation.y=.26;group.add(papers);
  scene.add(group)
}

function wrongArchitecture(scene){
  const black=mat(0x070807,.98),frame=mat(0x5a5540,.8);
  // A too-short "door" and a wall niche that looks almost useful but isn't.
  box(scene,15,1.0,15,.12,2.0,1.25,black);box(scene,14.91,2.04,15,.18,.08,1.35,frame);
  box(scene,-2,1.35,-16,1.25,2.7,.08,black);box(scene,-2,1.35,-15.94,1.0,2.35,.04,mat(0x28261a,.9));
}

function build(scene){if(!scene||built)return;built=true;peeledWallpaper(scene);wetCarpet(scene);ceilingDamage(scene);damagedTrim(scene);wallScars(scene);tapedZones(scene);floorArrows(scene);workstation(scene);wrongArchitecture(scene);window.__NULLSPACE_LEVEL0_DETAIL__=true}
window.addEventListener("load",()=>setTimeout(()=>{if(sceneRef)build(sceneRef)},900));
