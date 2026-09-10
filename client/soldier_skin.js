import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {clone as skeletonClone} from "three/addons/utils/SkeletonUtils.js";

const URL="https://cdn.jsdelivr.net/gh/agentkaerf/FreeModels@main/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/Swat.gltf";
const loader=new GLTFLoader();let asset=null;const pending=[];const animated=[];
const ready=loader.loadAsync(URL).then(g=>{asset=g;for(const group of pending.splice(0))attach(group);return true}).catch(err=>{console.warn("CC0 SWAT model unavailable; procedural soldier fallback remains active.",err);return false});

function clip(clips,...terms){for(const t of terms){const c=clips.find(v=>v.name.toLowerCase().includes(t));if(c)return c}return null}
function setAction(entry,name,fade=.18){const a=entry.actions[name]||entry.actions.idle;if(!a||entry.active===a)return;const old=entry.active;a.reset().fadeIn(fade).play();if(old)old.fadeOut(fade);entry.active=a}
function attach(group){
  if(!asset||group.userData.cc0Skin||!group.userData.soldier)return;group.userData.cc0Skin=true;
  const originals=[];group.traverse(o=>{if(o.isMesh)originals.push(o)});
  const model=skeletonClone(asset.scene);model.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;if(Array.isArray(o.material))o.material=o.material.map(m=>m.clone());else if(o.material)o.material=o.material.clone()});
  let bounds=new THREE.Box3().setFromObject(model),size=new THREE.Vector3();bounds.getSize(size);const scale=1.78/Math.max(.01,size.y);model.scale.setScalar(scale);bounds=new THREE.Box3().setFromObject(model);model.position.y-=bounds.min.y;model.rotation.y=Math.PI;group.add(model);
  // Invisible procedural geometry remains as accurate, cheap ray hitboxes.
  for(const o of originals){if(!o.material)continue;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m.transparent=true;m.opacity=0;m.depthWrite=false;m.colorWrite=false}o.castShadow=false;o.receiveShadow=false}
  const team=group.userData.soldier.team,color=team==="blue"?0x4f9abb:0xb55f4f,bandMat=new THREE.MeshBasicMaterial({color,toneMapped:false});for(const x of [-.31,.31]){const band=new THREE.Mesh(new THREE.BoxGeometry(.08,.07,.16),bandMat);band.position.set(x,1.34,-.02);group.add(band)}
  const entry={group,model,mixer:null,actions:{},active:null,last:group.position.clone(),speed:0};if(asset.animations?.length){entry.mixer=new THREE.AnimationMixer(model);const clips=asset.animations,idle=clip(clips,"idle")||clips[0],walk=clip(clips,"walk"),run=clip(clips,"run","sprint");for(const [name,c] of Object.entries({idle,walk,run}))if(c)entry.actions[name]=entry.mixer.clipAction(c);setAction(entry,"idle",0)}animated.push(entry)
}

const originalAdd=THREE.Scene.prototype.add;
THREE.Scene.prototype.add=function(...objects){const result=originalAdd.apply(this,objects);for(const o of objects){if(o?.userData?.soldier){if(asset)attach(o);else pending.push(o)}}return result};

let last=performance.now();function loop(now){const dt=Math.min(.05,(now-last)/1000||.016);last=now;for(let i=animated.length-1;i>=0;i--){const e=animated[i];if(!e.group.parent){animated.splice(i,1);continue}const d=e.group.position.distanceTo(e.last);e.speed=THREE.MathUtils.lerp(e.speed,d/Math.max(dt,.001),1-Math.exp(-dt*8));e.last.copy(e.group.position);if(e.mixer)e.mixer.update(dt);if(!e.group.visible)continue;if(e.speed>2.4)setAction(e,"run");else if(e.speed>.25)setAction(e,"walk");else setAction(e,"idle")}requestAnimationFrame(loop)}requestAnimationFrame(loop);

export {ready as soldierSkinReady};
