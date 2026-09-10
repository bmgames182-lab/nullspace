import * as THREE from "three";

// Ragdoll parts collide with the world but not each other. Joints provide the body structure
// while the recoverable state gets a deliberately weak active-ragdoll controller.
const GROUP=(0x0002<<16)|0x0001;
const UP=new THREE.Vector3(0,1,0),tmpUp=new THREE.Vector3(),tmpAxis=new THREE.Vector3(),tmpQ=new THREE.Quaternion();

export class CombatRagdoll{
  constructor(scene,physics,RAPIER,{x=0,y=0,z=0,team="red",yaw=0,recoverable=false}={}){
    this.scene=scene;this.physics=physics;this.RAPIER=RAPIER;this.parts=new Map();this.joints=[];this.recoverable=recoverable;this.dead=!recoverable;this.age=0;this.settleTime=0;this.recoveryBlend=0;
    const cloth=team==="blue"?0x33484e:0x514039,vest=team==="blue"?0x202c2e:0x302724;
    const mats={cloth:new THREE.MeshStandardMaterial({color:cloth,roughness:.92}),vest:new THREE.MeshStandardMaterial({color:vest,roughness:.86}),skin:new THREE.MeshStandardMaterial({color:0x9b725b,roughness:.96}),boots:new THREE.MeshStandardMaterial({color:0x151716,roughness:.94})};
    const lift=.18;
    const add=(name,px,py,pz,shape,size,mat,mass=1)=>{
      const desc=RAPIER.RigidBodyDesc.dynamic().setTranslation(x+px,y+py+lift,z+pz).setLinearDamping(.24).setAngularDamping(.5).setCcdEnabled(name==="head");const body=physics.createRigidBody(desc);let col,geo;
      if(shape==="sphere"){col=RAPIER.ColliderDesc.ball(size[0]);geo=new THREE.SphereGeometry(size[0],12,9)}
      else if(shape==="capsule"){col=RAPIER.ColliderDesc.capsule(size[1],size[0]);geo=new THREE.CapsuleGeometry(size[0],size[1]*2,5,8)}
      else{col=RAPIER.ColliderDesc.cuboid(size[0],size[1],size[2]);geo=new THREE.BoxGeometry(size[0]*2,size[1]*2,size[2]*2)}
      col.setDensity(mass).setFriction(.86).setRestitution(.01).setCollisionGroups(GROUP);physics.createCollider(col,body);
      const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.ragdoll=this;mesh.userData.bodyPart=name;scene.add(mesh);this.parts.set(name,{body,mesh});return body
    };
    const pelvis=add("pelvis",0,.82,0,"box",[.19,.14,.13],mats.vest,3.2);
    const torso=add("torso",0,1.19,0,"box",[.23,.27,.14],mats.vest,4.1);
    const head=add("head",0,1.67,-.01,"sphere",[.145],mats.skin,1.4);
    const uaL=add("upperArmL",-.34,1.27,0,"capsule",[.07,.17],mats.cloth,.8),uaR=add("upperArmR",.34,1.27,0,"capsule",[.07,.17],mats.cloth,.8);
    const laL=add("lowerArmL",-.34,.91,0,"capsule",[.06,.16],mats.cloth,.65),laR=add("lowerArmR",.34,.91,0,"capsule",[.06,.16],mats.cloth,.65);
    const thL=add("thighL",-.13,.47,0,"capsule",[.085,.2],mats.cloth,1.45),thR=add("thighR",.13,.47,0,"capsule",[.085,.2],mats.cloth,1.45);
    const shL=add("shinL",-.13,.08,0,"capsule",[.072,.18],mats.boots,1.0),shR=add("shinR",.13,.08,0,"capsule",[.072,.18],mats.boots,1.0);

    const keep=(j)=>{try{j.setContactsEnabled(false)}catch{}this.joints.push(j);return j};
    const spherical=(a,b,aa,bb)=>{try{return keep(physics.createImpulseJoint(RAPIER.JointData.spherical(aa,bb),a,b,true))}catch(err){console.warn("spherical ragdoll joint fallback",err);return null}};
    const hinge=(a,b,aa,bb,min,max)=>{try{const j=keep(physics.createImpulseJoint(RAPIER.JointData.revolute(aa,bb,{x:1,y:0,z:0}),a,b,true));if(j?.setLimits)j.setLimits(min,max);return j}catch(err){console.warn("hinge ragdoll joint fallback",err);return spherical(a,b,aa,bb)}};
    const fixed=(a,b,aa,bb)=>{try{const q={x:0,y:0,z:0,w:1};return keep(physics.createImpulseJoint(RAPIER.JointData.fixed(aa,q,bb,q),a,b,true))}catch(err){console.warn("fixed ragdoll joint fallback",err);return spherical(a,b,aa,bb)}};

    fixed(pelvis,torso,{x:0,y:.15,z:0},{x:0,y:-.28,z:0});
    spherical(torso,head,{x:0,y:.29,z:0},{x:0,y:-.15,z:0});
    spherical(torso,uaL,{x:-.25,y:.18,z:0},{x:0,y:.18,z:0});spherical(torso,uaR,{x:.25,y:.18,z:0},{x:0,y:.18,z:0});
    hinge(uaL,laL,{x:0,y:-.18,z:0},{x:0,y:.17,z:0},-2.15,.18);hinge(uaR,laR,{x:0,y:-.18,z:0},{x:0,y:.17,z:0},-2.15,.18);
    spherical(pelvis,thL,{x:-.13,y:-.13,z:0},{x:0,y:.21,z:0});spherical(pelvis,thR,{x:.13,y:-.13,z:0},{x:0,y:.21,z:0});
    hinge(thL,shL,{x:0,y:-.21,z:0},{x:0,y:.19,z:0},-.12,2.08);hinge(thR,shR,{x:0,y:-.21,z:0},{x:0,y:.19,z:0},-.12,2.08);

    const side=Math.sin(yaw),forward=Math.cos(yaw);pelvis.applyImpulse({x:side*.18,y:.02,z:forward*.18},true);torso.applyTorqueImpulse({x:(Math.random()-.5)*.2,y:(Math.random()-.5)*.12,z:(Math.random()-.5)*.24},true);this.sync();
  }
  getPosition(){const p=this.parts.get("pelvis")?.body.translation();return p?{x:p.x,y:p.y,z:p.z}:{x:0,y:0,z:0}}
  getUprightness(){const b=this.parts.get("torso")?.body;if(!b)return 0;const q=b.rotation();tmpQ.set(q.x,q.y,q.z,q.w);tmpUp.copy(UP).applyQuaternion(tmpQ);return tmpUp.dot(UP)}
  getMotion(){const torso=this.parts.get("torso")?.body,pelvis=this.parts.get("pelvis")?.body;if(!torso||!pelvis)return 99;const a=torso.linvel(),b=pelvis.linvel(),av=torso.angvel();return Math.hypot(a.x,a.y,a.z)*.55+Math.hypot(b.x,b.y,b.z)*.35+Math.hypot(av.x,av.y,av.z)*.22}
  canRecover(){
    if(!this.recoverable||this.dead||this.age<1.7)return false;
    const torso=this.parts.get("torso")?.body,pelvis=this.parts.get("pelvis")?.body;if(!torso||!pelvis)return false;
    const tp=torso.translation(),pp=pelvis.translation(),motion=this.getMotion();
    return this.recoveryBlend>.82&&this.settleTime>.16&&motion<1.35&&tp.y>.82&&pp.y>.48&&this.getUprightness()>.58
  }
  impulse(direction,strength=4,part="torso"){
    const target=this.parts.get(part)||this.parts.get("torso");if(!target)return;this.settleTime=0;this.recoveryBlend=Math.max(0,this.recoveryBlend-.42);target.body.applyImpulse({x:direction.x*strength,y:(direction.y||0)*strength+.18*strength,z:direction.z*strength},true);target.body.applyTorqueImpulse({x:(Math.random()-.5)*strength*.13,y:(Math.random()-.5)*strength*.09,z:(Math.random()-.5)*strength*.13},true)
  }
  brace(dt){
    if(!this.recoverable||this.dead)return;
    const torso=this.parts.get("torso")?.body,pelvis=this.parts.get("pelvis")?.body;if(!torso||!pelvis)return;
    const motion=this.getMotion(),upright=this.getUprightness();

    // First phase: resist a complete collapse but never overpower a hard hit.
    const q=torso.rotation();tmpQ.set(q.x,q.y,q.z,q.w);tmpUp.copy(UP).applyQuaternion(tmpQ);tmpAxis.copy(tmpUp).cross(UP);const av=torso.angvel();
    const early=THREE.MathUtils.clamp(1-this.age/1.15,0,1);
    torso.applyTorqueImpulse({x:tmpAxis.x*.035*early-av.x*.0018,y:-av.y*.0012,z:tmpAxis.z*.035*early-av.z*.0018},true);

    // Once the body has lost most of the impact energy, gradually transition from a limp fall
    // into an active kneel/stand attempt. The controller remains intentionally weak so walls,
    // bullets and explosions can interrupt it and send the body back down naturally.
    const calm=THREE.MathUtils.clamp(1-motion/2.0,0,1),ready=THREE.MathUtils.clamp((this.age-1.0)/1.5,0,1)*calm;
    this.recoveryBlend=THREE.MathUtils.lerp(this.recoveryBlend,ready,1-Math.exp(-dt*2.6));
    if(this.recoveryBlend>.08){
      const gain=this.recoveryBlend*this.recoveryBlend;
      const tq=torso.rotation();tmpQ.set(tq.x,tq.y,tq.z,tq.w);tmpUp.copy(UP).applyQuaternion(tmpQ);tmpAxis.copy(tmpUp).cross(UP);const tav=torso.angvel();
      torso.applyTorqueImpulse({x:tmpAxis.x*.115*gain-tav.x*.0046,y:-tav.y*.0024,z:tmpAxis.z*.115*gain-tav.z*.0046},true);
      const tp=torso.translation(),pp=pelvis.translation();
      if(pp.y<.78)pelvis.applyImpulse({x:0,y:Math.min(.055,(.82-pp.y)*.075)*gain,z:0},true);
      if(tp.y<1.22)torso.applyImpulse({x:0,y:Math.min(.065,(1.28-tp.y)*.07)*gain,z:0},true);

      // Hands help arrest a face-first fall, giving impacts a brief bracing/stumble look instead
      // of every recoverable hit immediately becoming a flat corpse pose.
      if(upright<.62&&tp.y<1.05){
        for(const name of ["lowerArmL","lowerArmR"]){const arm=this.parts.get(name)?.body;if(!arm)continue;const ap=arm.translation(),lv=arm.linvel();if(ap.y<.58&&lv.y<.5)arm.applyImpulse({x:0,y:.018*gain,z:0},true)}
      }
    }
  }
  update(dt){this.age+=dt;this.brace(dt);const motion=this.getMotion();this.settleTime=motion<1.15?this.settleTime+dt:Math.max(0,this.settleTime-dt*2.2);this.sync()}
  sync(){for(const {body,mesh} of this.parts.values()){const p=body.translation(),q=body.rotation();mesh.position.set(p.x,p.y,p.z);mesh.quaternion.set(q.x,q.y,q.z,q.w)}}
  destroy(){for(const {mesh} of this.parts.values()){this.scene.remove(mesh);mesh.geometry.dispose()}const disposed=new Set();for(const {mesh} of this.parts.values()){const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const m of mats)if(m&&!disposed.has(m)){m.dispose?.();disposed.add(m)}}for(const j of this.joints){try{this.physics.removeImpulseJoint(j,true)}catch{}}for(const {body} of this.parts.values()){try{this.physics.removeRigidBody(body)}catch{}}this.parts.clear();this.joints.length=0}
}
