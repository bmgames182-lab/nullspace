import * as THREE from "three";
import {PointerLockControls} from "three/addons/controls/PointerLockControls.js";
import RAPIER from "@dimforge/rapier3d-compat";

await RAPIER.init();

const canvas=document.getElementById("game");
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight,false);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x111315);
scene.fog=new THREE.FogExp2(0x111315,.025);
const camera=new THREE.PerspectiveCamera(82,innerWidth/innerHeight,.03,120);
camera.position.set(0,1.68,6.2);
camera.lookAt(0,1.25,0);
scene.add(camera);

const hemi=new THREE.HemisphereLight(0xc8d5dc,0x26221e,1.7);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,3.2);sun.position.set(-4,8,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-12;sun.shadow.camera.right=12;sun.shadow.camera.top=12;sun.shadow.camera.bottom=-12;scene.add(sun);

const world=new RAPIER.World({x:0,y:-9.81,z:0});
const groundBody=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.12,0));
world.createCollider(RAPIER.ColliderDesc.cuboid(20,.12,20).setFriction(1.0),groundBody);
const ground=new THREE.Mesh(new THREE.BoxGeometry(40,.24,40),new THREE.MeshStandardMaterial({color:0x24282a,roughness:.96}));ground.position.y=-.12;ground.receiveShadow=true;scene.add(ground);
const grid=new THREE.GridHelper(40,40,0x3b4144,0x292e30);grid.position.y=.005;scene.add(grid);

function addCover(x,y,z,sx,sy,sz,color=0x34393b){
  const rb=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,y,z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(sx/2,sy/2,sz/2).setFriction(.9),rb);
  const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),new THREE.MeshStandardMaterial({color,roughness:.9}));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m)
}
addCover(-3,.75,-2,2.4,1.5,.55);addCover(3,.55,-3,1.6,1.1,1.2);

const GROUP=(0x0002<<16)|0x0001;
const UP=new THREE.Vector3(0,1,0),FWD=new THREE.Vector3(0,0,-1);
const qA=new THREE.Quaternion(),qB=new THREE.Quaternion(),qErr=new THREE.Quaternion(),v0=new THREE.Vector3(),v1=new THREE.Vector3(),v2=new THREE.Vector3();
const clamp=THREE.MathUtils.clamp;

class ActiveHuman{
  constructor(x=0,z=0){
    this.parts=new Map();this.joints=[];this.hitMeshes=[];this.age=0;this.shock=0;this.lastHit={part:"torso",dir:new THREE.Vector3(0,0,-1)};
    this.step={phase:"idle",side:1,start:0,end:0,cooldown:.15,target:new THREE.Vector3()};this.groundTime=0;
    const skin=new THREE.MeshStandardMaterial({color:0x9b7159,roughness:.9});
    const cloth=new THREE.MeshStandardMaterial({color:0x32383c,roughness:.92});
    const vest=new THREE.MeshStandardMaterial({color:0x171b1d,roughness:.82});
    const boot=new THREE.MeshStandardMaterial({color:0x0d0f10,roughness:.9});
    const add=(name,px,py,pz,shape,size,mat,density=1)=>{
      const rb=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x+px,py,z+pz).setLinearDamping(.32).setAngularDamping(.62).setCcdEnabled(name==="head"||name.startsWith("foot")));
      let cd,geo;if(shape==="sphere"){cd=RAPIER.ColliderDesc.ball(size[0]);geo=new THREE.SphereGeometry(size[0],18,12)}else if(shape==="capsule"){cd=RAPIER.ColliderDesc.capsule(size[1],size[0]);geo=new THREE.CapsuleGeometry(size[0],size[1]*2,6,10)}else{cd=RAPIER.ColliderDesc.cuboid(size[0],size[1],size[2]);geo=new THREE.BoxGeometry(size[0]*2,size[1]*2,size[2]*2)}
      cd.setDensity(density).setFriction(name.startsWith("foot")?1.45:.92).setRestitution(.002).setCollisionGroups(GROUP);world.createCollider(cd,rb);
      const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.part=name;scene.add(mesh);this.parts.set(name,{rb,mesh});this.hitMeshes.push(mesh);return rb
    };
    const pelvis=add("pelvis",0,1.02,0,"box",[.19,.14,.135],vest,3.6);
    const abdomen=add("abdomen",0,1.26,0,"box",[.20,.14,.125],cloth,2.3);
    const chest=add("chest",0,1.51,0,"box",[.235,.21,.14],vest,4.1);
    const head=add("head",0,1.84,-.015,"sphere",[.15],skin,1.35);
    const uaL=add("upperArmL",-.34,1.48,0,"capsule",[.068,.17],cloth,.85),uaR=add("upperArmR",.34,1.48,0,"capsule",[.068,.17],cloth,.85);
    const laL=add("lowerArmL",-.34,1.12,0,"capsule",[.058,.16],skin,.68),laR=add("lowerArmR",.34,1.12,0,"capsule",[.058,.16],skin,.68);
    const thL=add("thighL",-.13,.70,0,"capsule",[.082,.20],cloth,1.55),thR=add("thighR",.13,.70,0,"capsule",[.082,.20],cloth,1.55);
    const shL=add("shinL",-.13,.31,0,"capsule",[.070,.18],cloth,1.05),shR=add("shinR",.13,.31,0,"capsule",[.070,.18],cloth,1.05);
    const ftL=add("footL",-.13,.075,-.075,"box",[.095,.045,.17],boot,.62),ftR=add("footR",.13,.075,-.075,"box",[.095,.045,.17],boot,.62);
    const keep=j=>{try{j?.setContactsEnabled?.(false)}catch{}if(j)this.joints.push(j);return j};
    const ball=(a,b,aa,bb)=>keep(world.createImpulseJoint(RAPIER.JointData.spherical(aa,bb),a,b,true));
    const hinge=(a,b,aa,bb,min,max)=>{const j=keep(world.createImpulseJoint(RAPIER.JointData.revolute(aa,bb,{x:1,y:0,z:0}),a,b,true));j?.setLimits?.(min,max);return j};
    ball(pelvis,abdomen,{x:0,y:.14,z:0},{x:0,y:-.14,z:0});
    ball(abdomen,chest,{x:0,y:.14,z:0},{x:0,y:-.21,z:0});
    ball(chest,head,{x:0,y:.22,z:0},{x:0,y:-.15,z:0});
    ball(chest,uaL,{x:-.245,y:.12,z:0},{x:0,y:.18,z:0});ball(chest,uaR,{x:.245,y:.12,z:0},{x:0,y:.18,z:0});
    hinge(uaL,laL,{x:0,y:-.18,z:0},{x:0,y:.17,z:0},-2.2,.10);hinge(uaR,laR,{x:0,y:-.18,z:0},{x:0,y:.17,z:0},-2.2,.10);
    ball(pelvis,thL,{x:-.13,y:-.13,z:0},{x:0,y:.21,z:0});ball(pelvis,thR,{x:.13,y:-.13,z:0},{x:0,y:.21,z:0});
    hinge(thL,shL,{x:0,y:-.21,z:0},{x:0,y:.19,z:0},-.10,2.05);hinge(thR,shR,{x:0,y:-.21,z:0},{x:0,y:.19,z:0},-.10,2.05);
    hinge(shL,ftL,{x:0,y:-.19,z:0},{x:0,y:.045,z:.06},-.42,.50);hinge(shR,ftR,{x:0,y:-.19,z:0},{x:0,y:.045,z:.06},-.42,.50);
    this.sync()
  }
  body(name){return this.parts.get(name)?.rb}
  footQuality(body){if(!body)return 0;const p=body.translation(),vel=body.linvel();if(p.y>.20)return 0;const r=body.rotation();qA.set(r.x,r.y,r.z,r.w);v0.copy(UP).applyQuaternion(qA);return clamp((.20-p.y)/.13,0,1)*clamp((v0.y-.35)/.65,0,1)*clamp(1-Math.abs(vel.y)/1.1,0,1)}
  upright(body,gain,damping,active,frame){if(!body)return;const r=body.rotation(),av=body.angvel();qA.set(r.x,r.y,r.z,r.w);v0.copy(UP).applyQuaternion(qA);v1.copy(v0).cross(UP);const g=gain*active;body.applyTorqueImpulse({x:clamp(v1.x*g-av.x*damping*active,-g,g)*frame,y:clamp(-av.y*damping*.35,-g*.2,g*.2)*frame,z:clamp(v1.z*g-av.z*damping*active,-g,g)*frame},true)}
  cohere(parent,child,gain,damping,active,frame,max=.055){if(!parent||!child)return;const pa=parent.rotation(),cb=child.rotation();qA.set(pa.x,pa.y,pa.z,pa.w);qB.set(cb.x,cb.y,cb.z,cb.w);qErr.copy(qA).invert().multiply(qB).normalize();if(qErr.w<0)qErr.set(-qErr.x,-qErr.y,-qErr.z,-qErr.w);const angle=2*Math.acos(clamp(qErr.w,-1,1));const s=Math.sqrt(Math.max(1e-8,1-qErr.w*qErr.w));v0.set(qErr.x/s,qErr.y/s,qErr.z/s).applyQuaternion(qA);const ap=parent.angvel(),ac=child.angvel();v1.set(ac.x-ap.x,ac.y-ap.y,ac.z-ap.z);const scale=angle>Math.PI?angle-Math.PI*2:angle;v2.copy(v0).multiplyScalar(-scale*gain*active).addScaledVector(v1,-damping*active);const len=v2.length();if(len>max)v2.multiplyScalar(max/len);v2.multiplyScalar(frame);child.applyTorqueImpulse({x:v2.x,y:v2.y,z:v2.z},true);parent.applyTorqueImpulse({x:-v2.x*.65,y:-v2.y*.65,z:-v2.z*.65},true)}
  hit(part,dir,strength=4.2){const rb=this.body(part)||this.body("chest");if(!rb)return;this.shock=Math.max(this.shock,clamp(strength/8,0,1));this.lastHit={part,dir:dir.clone()};this.step.phase="idle";this.step.cooldown=this.age+.10;const local=part.includes("Arm")||part.includes("leg")||part.includes("shin")||part.includes("thigh")?.82:1;rb.applyImpulse({x:dir.x*strength*local,y:dir.y*strength*.35+.08,z:dir.z*strength*local},true);const spin=Math.min(.28,strength*.045);rb.applyTorqueImpulse({x:(Math.random()-.5)*spin,y:(Math.random()-.5)*spin*.55,z:(Math.random()-.5)*spin},true)}
  beginStep(pp,pv,errX,errZ,side){const l=this.body("footL"),r=this.body("footR");if(!l||!r)return;const lp=l.translation(),rp=r.translation(),tx=pp.x+pv.x*.20+errX*.78,tz=pp.z+pv.z*.20+errZ*.78;const dl=Math.hypot(tx-lp.x,tz-lp.z),dr=Math.hypot(tx-rp.x,tz-rp.z);this.step.side=dl>dr?-1:1;this.step.target.set(tx+side.x*this.step.side*.17,.07,tz+side.z*this.step.side*.17);this.step.start=this.age;this.step.end=this.age+.34;this.step.phase="swing"}
  update(dt){this.age+=dt;const frame=clamp(dt*60,.25,1.8),pelvis=this.body("pelvis"),abdomen=this.body("abdomen"),chest=this.body("chest"),head=this.body("head"),ftL=this.body("footL"),ftR=this.body("footR");if(!pelvis||!chest)return;const pp=pelvis.translation(),cp=chest.translation(),pv=pelvis.linvel(),cv=chest.linvel();const cr=chest.rotation();qA.set(cr.x,cr.y,cr.z,cr.w);v0.copy(UP).applyQuaternion(qA);const upright=v0.y;this.shock=THREE.MathUtils.lerp(this.shock,0,1-Math.exp(-dt*1.25));const active=clamp(1-this.shock*.72,.22,1);
    this.upright(pelvis,.036,.0058,active,frame);this.upright(abdomen,.046,.0065,active,frame);this.upright(chest,.060,.0075,active,frame);this.upright(head,.018,.0034,active,frame);
    this.cohere(pelvis,abdomen,.050,.006,active,frame,.045);this.cohere(abdomen,chest,.060,.007,active,frame,.052);this.cohere(chest,head,.034,.005,active,frame,.032);
    if(upright>-.10){const lift=clamp((1.0-pp.y)*.075-pv.y*.008,0,.055)*active*frame;pelvis.applyImpulse({x:0,y:lift,z:0},true);const chestLift=clamp((1.50-cp.y)*.038-cv.y*.004,0,.030)*active*frame;chest.applyImpulse({x:0,y:chestLift,z:0},true)}
    const lq=this.footQuality(ftL),rq=this.footQuality(ftR),sum=lq+rq;let sx=pp.x,sz=pp.z;if(sum>.001){const lp=ftL.translation(),rp=ftR.translation();sx=(lp.x*lq+rp.x*rq)/sum;sz=(lp.z*lq+rp.z*rq)/sum}const comX=pp.x*.58+cp.x*.42,comZ=pp.z*.58+cp.z*.42,errX=comX-sx,errZ=comZ-sz,err=Math.hypot(errX,errZ),speed=Math.hypot(pv.x,pv.z);
    if(sum>.08){pelvis.applyImpulse({x:clamp(-errX*.034-pv.x*.010,-.030,.030)*active*frame,y:0,z:clamp(-errZ*.034-pv.z*.010,-.030,.030)*active*frame},true)}
    const pr=pelvis.rotation();qA.set(pr.x,pr.y,pr.z,pr.w);const forward=v0.copy(FWD).applyQuaternion(qA);forward.y=0;if(forward.lengthSq()<1e-5)forward.set(0,0,-1);forward.normalize();const side=v1.set(forward.z,0,-forward.x);
    const unstable=(err>.105||speed>.50||upright<.82||sum<.66)&&upright>.16&&pp.y>.40;if(this.step.phase==="idle"&&unstable&&this.age>=this.step.cooldown)this.beginStep(pp,pv,errX,errZ,side);
    if(this.step.phase!=="idle"){const left=this.step.side<0,foot=left?ftL:ftR,shin=this.body(left?"shinL":"shinR"),thigh=this.body(left?"thighL":"thighR"),support=left?ftR:ftL;if(foot&&shin&&thigh){const fp=foot.translation(),fv=foot.linvel();if(this.step.phase==="swing"){const phase=clamp((this.age-this.step.start)/(this.step.end-this.step.start),0,1),dx=this.step.target.x-fp.x,dz=this.step.target.z-fp.z,dist=Math.hypot(dx,dz),lift=.055+.105*Math.sin(Math.PI*phase),ix=clamp(dx*.030-fv.x*.004,-.027,.027)*active*frame,iz=clamp(dz*.030-fv.z*.004,-.027,.027)*active*frame,iy=clamp((lift-fp.y)*.042-fv.y*.0035,-.010,.022)*active*frame;foot.applyImpulse({x:ix,y:iy,z:iz},true);shin.applyImpulse({x:ix*.50,y:Math.max(0,iy)*.5,z:iz*.50},true);thigh.applyImpulse({x:ix*.28,y:Math.max(0,iy)*.28,z:iz*.28},true);if((phase>.62&&dist<.10&&fp.y<.145)||phase>=1){this.step.phase="plant";this.step.end=this.age+.13}}else{const fv2=foot.linvel();foot.applyImpulse({x:clamp(-fv2.x*.011,-.019,.019)*frame,y:-.003*frame,z:clamp(-fv2.z*.011,-.019,.019)*frame},true);if(this.age>=this.step.end){this.step.phase="idle";this.step.cooldown=this.age+.18}}}if(support){const q=this.footQuality(support),sv=support.linvel();if(q>.05)support.applyImpulse({x:clamp(-sv.x*.010*q,-.017,.017)*frame,y:-.002*q*active*frame,z:clamp(-sv.z*.010*q,-.017,.017)*frame},true)}}else for(const [foot,q] of [[ftL,lq],[ftR,rq]])if(foot&&q>.05){const v=foot.linvel();foot.applyImpulse({x:clamp(-v.x*.007*q,-.012,.012)*frame,y:-.0015*q*active*frame,z:clamp(-v.z*.007*q,-.012,.012)*frame},true);this.upright(foot,.012*q,.003,q*active,frame)}
    const falling=Math.max(0,-cv.y)>.22||upright<.62;if(falling){const dir=v0.set(Math.abs(pv.x)+Math.abs(pv.z)>.15?pv.x:this.lastHit.dir.x,0,Math.abs(pv.x)+Math.abs(pv.z)>.15?pv.z:this.lastHit.dir.z);if(dir.lengthSq()<.001)dir.set(0,0,-1);dir.normalize();for(const [name,s] of [["lowerArmL",-1],["lowerArmR",1]]){const arm=this.body(name);if(!arm)continue;const ap=arm.translation(),av=arm.linvel();if(ap.y>.45)arm.applyImpulse({x:(dir.x*.009+side.x*s*.004)*active*frame,y:-.004*active*frame,z:(dir.z*.009+side.z*s*.004)*active*frame},true);else if(av.y<.6)arm.applyImpulse({x:-pv.x*.0025*frame,y:.012*active*frame,z:-pv.z*.0025*frame},true)}}
    if(pp.y<.50&&cp.y<.85)this.groundTime+=dt;else this.groundTime=Math.max(0,this.groundTime-dt*2);if(this.groundTime>.35&&Math.hypot(pv.x,pv.y,pv.z)<1.8){const push=clamp((this.groundTime-.35)*.020,0,.028)*active*frame;pelvis.applyImpulse({x:0,y:push,z:0},true);chest.applyImpulse({x:0,y:push*.8,z:0},true)}
    this.sync()
  }
  sync(){for(const {rb,mesh} of this.parts.values()){const p=rb.translation(),r=rb.rotation();mesh.position.set(p.x,p.y,p.z);mesh.quaternion.set(r.x,r.y,r.z,r.w)}}
  destroy(){for(const j of this.joints)try{world.removeImpulseJoint(j,true)}catch{}for(const {rb,mesh} of this.parts.values()){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose?.();try{world.removeRigidBody(rb)}catch{}}this.parts.clear();this.hitMeshes.length=0}
}

let human=new ActiveHuman(0,0);
const controls=new PointerLockControls(camera,document.body);
const keys=new Set();let aiming=false,lastShot=0,recoil=0;

const gun=new THREE.Group();camera.add(gun);gun.position.set(.25,-.22,-.48);
const gunMat=new THREE.MeshStandardMaterial({color:0x151819,roughness:.35,metalness:.72});
const receiver=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.48),gunMat);receiver.position.z=-.18;gun.add(receiver);
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.52,12),gunMat);barrel.rotation.x=Math.PI/2;barrel.position.set(0,.015,-.63);gun.add(barrel);
const stock=new THREE.Mesh(new THREE.BoxGeometry(.11,.15,.28),gunMat);stock.position.set(0,-.03,.16);stock.rotation.x=-.10;gun.add(stock);
const grip=new THREE.Mesh(new THREE.BoxGeometry(.075,.20,.09),gunMat);grip.position.set(.01,-.14,-.05);grip.rotation.x=-.30;gun.add(grip);
const muzzle=new THREE.PointLight(0xffb873,0,2);muzzle.position.set(0,0,-.92);gun.add(muzzle);

const raycaster=new THREE.Raycaster(),rayDir=new THREE.Vector3(),rayOrigin=new THREE.Vector3();
const tracerMat=new THREE.LineBasicMaterial({color:0xffd7a0,transparent:true,opacity:.85});
function fire(){const now=performance.now();if(!controls.isLocked||now-lastShot<105)return;lastShot=now;camera.getWorldPosition(rayOrigin);camera.getWorldDirection(rayDir);rayDir.x+=(Math.random()-.5)*(aiming?.0015:.005);rayDir.y+=(Math.random()-.5)*(aiming?.0015:.005);rayDir.z+=(Math.random()-.5)*(aiming?.0015:.005);rayDir.normalize();raycaster.set(rayOrigin,rayDir);raycaster.far=60;const hits=raycaster.intersectObjects(human.hitMeshes,false);let end=rayOrigin.clone().addScaledVector(rayDir,60);if(hits.length){const hit=hits[0];end=hit.point.clone();human.hit(hit.object.userData.part,rayDir,4.1)}const geo=new THREE.BufferGeometry().setFromPoints([rayOrigin.clone(),end]);const line=new THREE.Line(geo,tracerMat.clone());scene.add(line);setTimeout(()=>{scene.remove(line);geo.dispose();line.material.dispose()},45);recoil=Math.min(.16,recoil+(aiming?.035:.07));muzzle.intensity=8;setTimeout(()=>muzzle.intensity=0,28)}

function reset(){human.destroy();human=new ActiveHuman(0,0)}

document.addEventListener("pointerdown",e=>{if(!controls.isLocked){controls.lock();return}if(e.button===0)fire();if(e.button===2)aiming=true});
document.addEventListener("pointerup",e=>{if(e.button===2)aiming=false});
document.addEventListener("contextmenu",e=>e.preventDefault());
document.addEventListener("keydown",e=>{keys.add(e.code);if(e.code==="KeyR")reset()});
document.addEventListener("keyup",e=>keys.delete(e.code));

const status=document.getElementById("status");controls.addEventListener("lock",()=>status.textContent="LMB SHOOT · RMB AIM · WASD MOVE · R RESET");controls.addEventListener("unlock",()=>status.textContent="CLICK TO ENTER");

let last=performance.now();
function loop(now){const dt=Math.min(.033,(now-last)/1000||.016);last=now;const step=dt*3.2;if(controls.isLocked){camera.getWorldDirection(v0);v0.y=0;v0.normalize();v1.set(v0.z,0,-v0.x);let mx=0,mz=0;if(keys.has("KeyW")){mx+=v0.x;mz+=v0.z}if(keys.has("KeyS")){mx-=v0.x;mz-=v0.z}if(keys.has("KeyA")){mx-=v1.x;mz-=v1.z}if(keys.has("KeyD")){mx+=v1.x;mz+=v1.z}const len=Math.hypot(mx,mz);if(len){camera.position.x+=mx/len*step;camera.position.z+=mz/len*step}camera.position.y=1.68}
  world.timestep=dt;world.step();human.update(dt);recoil=THREE.MathUtils.lerp(recoil,0,1-Math.exp(-dt*16));const ads=aiming?1:0;camera.fov=THREE.MathUtils.lerp(camera.fov,aiming?68:82,1-Math.exp(-dt*12));camera.updateProjectionMatrix();gun.position.x=THREE.MathUtils.lerp(gun.position.x,aiming?.02:.25,1-Math.exp(-dt*14));gun.position.y=THREE.MathUtils.lerp(gun.position.y,aiming?-.19:-.22,1-Math.exp(-dt*14));gun.position.z=THREE.MathUtils.lerp(gun.position.z,-.48+recoil*.16,1-Math.exp(-dt*18));gun.rotation.x=-recoil*.65;
  renderer.render(scene,camera);requestAnimationFrame(loop)}requestAnimationFrame(loop);

addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false)});
