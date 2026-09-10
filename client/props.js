import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Kenney Furniture Kit 2.1 — CC0. Runtime mirror is a public GitHub asset archive.
const BASE = "https://cdn.jsdelivr.net/gh/eturner58/game-assets@main/kenney/3D%20assets/Furniture%20Kit/Models/GLTF%20format/";
const ASSETS = Object.freeze({
  desk:{file:"desk.glb",height:.78}, chair:{file:"chairDesk.glb",height:.92},
  bookcase:{file:"bookcaseClosed.glb",height:1.82}, box:{file:"cardboardBoxClosed.glb",height:.48},
  radio:{file:"radio.glb",height:.25}, trash:{file:"trashcan.glb",height:.62}, tv:{file:"televisionVintage.glb",height:.62}
});
const loader=new GLTFLoader(),cache=new Map();
let capturedScene=null,decorated=false;

// Loaded before game.js: capture the game's Three.js Scene without coupling the gameplay module to prop loading.
const originalSceneAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){if(!capturedScene)capturedScene=this;return originalSceneAdd.apply(this,objects)};

async function loadAsset(key){
  if(cache.has(key))return cache.get(key);
  const def=ASSETS[key];if(!def)throw new Error(`Unknown prop ${key}`);
  const promise=loader.loadAsync(BASE+def.file).then(gltf=>{
    const root=gltf.scene;
    root.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=false;o.frustumCulled=true;if(o.material){o.material=o.material.clone();if("roughness" in o.material)o.material.roughness=Math.max(.62,o.material.roughness??.8)}});
    return root
  });cache.set(key,promise);return promise
}
function cloneAndNormalize(template,targetHeight){
  const root=template.clone(true),bounds=new THREE.Box3().setFromObject(root),size=new THREE.Vector3();bounds.getSize(size);
  root.scale.setScalar(targetHeight/Math.max(.001,size.y));root.updateMatrixWorld(true);const after=new THREE.Box3().setFromObject(root);root.position.y-=after.min.y;return root
}
function blockersFromScene(scene){
  const blockers=[];
  scene.traverse(o=>{
    if(!o.isMesh||o.userData.nullspaceProp||o.isInstancedMesh)return;
    const b=new THREE.Box3().setFromObject(o),size=new THREE.Vector3();b.getSize(size);
    if(size.x>25||size.z>25||b.max.y<.16||b.min.y>2.55)return;
    if(size.y<.35)return;
    blockers.push({minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z})
  });return blockers
}
function circleClear(x,z,r,blockers){
  for(const c of blockers){const cx=Math.max(c.minX,Math.min(x,c.maxX)),cz=Math.max(c.minZ,Math.min(z,c.maxZ)),dx=x-cx,dz=z-cz;if(dx*dx+dz*dz<r*r)return false}return true
}
function candidateCells(scene){
  const blockers=blockersFromScene(scene),protectedPoints=[[-16,14],[14,13],[17,-14],[12.5,-14],[-17,-4],[4,-17],[-14,-14],[14,14]],cells=[];
  for(let x=-18;x<=18;x+=4)for(let z=-18;z<=18;z+=4){
    if(!circleClear(x,z,1.3,blockers))continue;if(protectedPoints.some(([px,pz])=>Math.hypot(x-px,z-pz)<3.2))continue;cells.push({x,z})
  }
  cells.sort((a,b)=>Math.sin(a.x*12.9898+a.z*78.233)-Math.sin(b.x*12.9898+b.z*78.233));return cells
}
async function place(scene,key,x,z,rotation=0,scale=1){
  try{const template=await loadAsset(key),obj=cloneAndNormalize(template,ASSETS[key].height*scale);obj.position.x+=x;obj.position.z+=z;obj.rotation.y=rotation;obj.userData.nullspaceProp=true;scene.add(obj);return obj}catch(err){console.warn(`NULLSPACE prop failed: ${key}`,err);return null}
}
export async function decorateScene(scene){
  if(!scene||decorated)return[];decorated=true;const cells=candidateCells(scene),placed=[];if(cells.length<3)return placed;
  const office=cells[2%cells.length],storage=cells[Math.floor(cells.length*.56)%cells.length],waiting=cells[Math.floor(cells.length*.82)%cells.length];
  const jobs=[
    place(scene,"desk",office.x,office.z,Math.PI*.5),place(scene,"chair",office.x-.95,office.z+.15,-Math.PI*.5,.95),place(scene,"radio",office.x+.15,office.z-.42,Math.PI*.5,.85),
    place(scene,"bookcase",storage.x,storage.z,0),place(scene,"box",storage.x+.82,storage.z+.48,.18,1.05),place(scene,"box",storage.x+.48,storage.z-.38,-.22,.82),place(scene,"trash",storage.x-.72,storage.z+.34,.1,.9),
    place(scene,"chair",waiting.x-.55,waiting.z,.15,.88),place(scene,"chair",waiting.x+.55,waiting.z,-.2,.88),place(scene,"tv",waiting.x,waiting.z+.72,Math.PI,.84)
  ];
  for(const result of await Promise.allSettled(jobs))if(result.status==="fulfilled"&&result.value)placed.push(result.value);
  window.__NULLSPACE_PROP_STATS__={loaded:placed.length,total:jobs.length};return placed
}
window.addEventListener("load",()=>setTimeout(()=>{if(capturedScene)decorateScene(capturedScene)},650));
