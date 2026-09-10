import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Kenney Furniture Kit 2.1 — CC0. Runtime mirror is a public GitHub asset archive.
const BASE="https://cdn.jsdelivr.net/gh/eturner58/game-assets@main/kenney/3D%20assets/Furniture%20Kit/Models/GLTF%20format/";
const ASSETS=Object.freeze({
  desk:{file:"desk.glb",height:.78},chair:{file:"chairDesk.glb",height:.92},bookcase:{file:"bookcaseClosed.glb",height:1.82},
  box:{file:"cardboardBoxClosed.glb",height:.48},radio:{file:"radio.glb",height:.25},trash:{file:"trashcan.glb",height:.62},tv:{file:"televisionVintage.glb",height:.62}
});
const loader=new GLTFLoader(),cache=new Map();
let capturedScene=null,decorated=false;

// Loaded before game.js: capture the game's Three.js Scene without coupling gameplay to cosmetic asset loading.
const originalSceneAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!capturedScene)capturedScene=this;return originalSceneAdd.apply(this,objects)};

async function loadAsset(key){
  if(cache.has(key))return cache.get(key);const def=ASSETS[key];if(!def)throw new Error(`Unknown prop ${key}`);
  const promise=loader.loadAsync(BASE+def.file).then(gltf=>{
    const root=gltf.scene;root.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=false;o.frustumCulled=true;if(o.material){o.material=o.material.clone();if("roughness" in o.material)o.material.roughness=Math.max(.62,o.material.roughness??.8)}});return root
  });cache.set(key,promise);return promise
}
function cloneAndNormalize(template,targetHeight){
  const root=template.clone(true),bounds=new THREE.Box3().setFromObject(root),size=new THREE.Vector3();bounds.getSize(size);root.scale.setScalar(targetHeight/Math.max(.001,size.y));root.updateMatrixWorld(true);const after=new THREE.Box3().setFromObject(root);root.position.y-=after.min.y;return root
}
function blockersFromScene(scene){
  const blockers=[];scene.traverse(o=>{if(!o.isMesh||o.userData.nullspaceProp||o.isInstancedMesh)return;const b=new THREE.Box3().setFromObject(o),size=new THREE.Vector3();b.getSize(size);if(size.x>25||size.z>25||b.max.y<.16||b.min.y>2.55||size.y<.35)return;blockers.push({minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z})});return blockers
}
function circleClear(x,z,r,blockers){for(const c of blockers){const cx=Math.max(c.minX,Math.min(x,c.maxX)),cz=Math.max(c.minZ,Math.min(z,c.maxZ)),dx=x-cx,dz=z-cz;if(dx*dx+dz*dz<r*r)return false}return true}
function candidateCells(scene){
  const blockers=blockersFromScene(scene),protectedPoints=[[-16,14],[14,13],[17,-14],[12.5,-14],[-17,-4],[4,-17],[-14,-14],[14,14]],cells=[];
  for(let x=-18;x<=18;x+=4)for(let z=-18;z<=18;z+=4){if(!circleClear(x,z,1.3,blockers))continue;if(protectedPoints.some(([px,pz])=>Math.hypot(x-px,z-pz)<3.2))continue;cells.push({x,z})}
  cells.sort((a,b)=>Math.sin(a.x*12.9898+a.z*78.233)-Math.sin(b.x*12.9898+b.z*78.233));return cells
}
async function place(scene,key,x,z,rotation=0,scale=1){
  try{const template=await loadAsset(key),obj=cloneAndNormalize(template,ASSETS[key].height*scale);obj.position.x+=x;obj.position.z+=z;obj.rotation.y=rotation;obj.userData.nullspaceProp=true;scene.add(obj);return obj}catch(err){console.warn(`NULLSPACE prop failed: ${key}`,err);return null}
}
function addMissingCeilingTiles(scene,cells){
  const mat=new THREE.MeshBasicMaterial({color:0x090a08,side:THREE.DoubleSide,toneMapped:false});
  const geom=new THREE.PlaneGeometry(1.55,1.55);const picks=[cells[1],cells[5],cells[9],cells[13]].filter(Boolean);
  for(const [i,c] of picks.entries()){
    const tile=new THREE.Mesh(geom,mat);tile.rotation.x=Math.PI/2;tile.position.set(c.x+(i%2?.55:-.45),3.065,c.z+(i%2?-.4:.5));tile.userData.nullspaceProp=true;scene.add(tile)
  }
}
function addHangingCable(scene,cells){
  const mat=new THREE.MeshBasicMaterial({color:0x111211});
  for(const c of [cells[4],cells[11]].filter(Boolean)){
    const curve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(c.x-1.35,3.02,c.z-.3),new THREE.Vector3(c.x-.55,2.66,c.z-.08),new THREE.Vector3(c.x+.25,2.79,c.z+.1),new THREE.Vector3(c.x+1.25,3.02,c.z+.3)
    ]);
    const cable=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.014,5,false),mat);cable.userData.nullspaceProp=true;scene.add(cable)
  }
}
function addDust(scene){
  const count=520,pos=new Float32Array(count*3);
  for(let i=0;i<count;i++){pos[i*3]=-19+Math.random()*38;pos[i*3+1]=.16+Math.random()*2.72;pos[i*3+2]=-19+Math.random()*38}
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({color:0xd8cc94,size:.018,transparent:true,opacity:.18,depthWrite:false,sizeAttenuation:true});const dust=new THREE.Points(geo,mat);dust.userData.nullspaceProp=true;scene.add(dust)
}
function addPaperTrail(scene,cells){
  const geom=new THREE.PlaneGeometry(.22,.3),mat=new THREE.MeshStandardMaterial({color:0xb8ad82,roughness:1,side:THREE.DoubleSide});
  for(let i=0;i<12;i++){const c=cells[(i*3+2)%cells.length];if(!c)continue;const p=new THREE.Mesh(geom,mat);p.rotation.x=-Math.PI/2;p.rotation.z=(i*.91)%Math.PI;p.position.set(c.x+(Math.sin(i*2.2)*.75),.018,c.z+(Math.cos(i*1.7)*.7));p.userData.nullspaceProp=true;scene.add(p)}
}
function addAtmosphere(scene,cells){addMissingCeilingTiles(scene,cells);addHangingCable(scene,cells);addDust(scene);addPaperTrail(scene,cells)}

export async function decorateScene(scene){
  if(!scene||decorated)return[];decorated=true;const cells=candidateCells(scene),placed=[];if(cells.length<3)return placed;
  addAtmosphere(scene,cells);
  const office=cells[2%cells.length],storage=cells[Math.floor(cells.length*.56)%cells.length],waiting=cells[Math.floor(cells.length*.82)%cells.length];
  const jobs=[
    place(scene,"desk",office.x,office.z,Math.PI*.5),place(scene,"chair",office.x-.95,office.z+.15,-Math.PI*.5,.95),place(scene,"radio",office.x+.15,office.z-.42,Math.PI*.5,.85),
    place(scene,"bookcase",storage.x,storage.z,0),place(scene,"box",storage.x+.82,storage.z+.48,.18,1.05),place(scene,"box",storage.x+.48,storage.z-.38,-.22,.82),place(scene,"trash",storage.x-.72,storage.z+.34,.1,.9),
    place(scene,"chair",waiting.x-.55,waiting.z,.15,.88),place(scene,"chair",waiting.x+.55,waiting.z,-.2,.88),place(scene,"tv",waiting.x,waiting.z+.72,Math.PI,.84)
  ];
  for(const result of await Promise.allSettled(jobs))if(result.status==="fulfilled"&&result.value)placed.push(result.value);
  window.__NULLSPACE_PROP_STATS__={loaded:placed.length,total:jobs.length,atmosphere:true};return placed
}
window.addEventListener("load",()=>setTimeout(()=>{if(capturedScene)decorateScene(capturedScene)},650));
