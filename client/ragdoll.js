import * as THREE from "three";

const GROUP=(0x0002<<16)|0x0001;

export class CombatRagdoll{
  constructor(scene,physics,RAPIER,{x=0,y=0,z=0,team="red",yaw=0,recoverable=false}={}){
    this.scene=scene;this.physics=physics;this.RAPIER=RAPIER;this.parts=new Map();this.joints=[];this.recoverable=recoverable;this.dead=!recoverable;this.age=0;
    const cloth=team==="blue"?0x33484e:0x514039,vest=team==="blue"?0x202c2e:0x302724;
    const mats={cloth:new THREE.MeshStandardMaterial({color:cloth,roughness:.92}),vest:new THREE.MeshStandardMaterial({color:vest,roughness:.86}),skin:new THREE.MeshStandardMaterial({color:0x9b725b,roughness:.96}),boots:new THREE.MeshStandardMaterial({color:0x151716,roughness:.94})};
    const add=(name,px,py,pz,shape,size,mat,mass=1)=>{
      const desc=RAPIER.RigidBodyDesc.dynamic().setTranslation(x+px,y+py,z+pz).setLinearDamping(.18).setAngularDamping(.34);const body=physics.createRigidBody(desc);let col,geo;
      if(shape==="sphere"){col=RAPIER.ColliderDesc.ball(size[0]);geo=new THREE.SphereGeometry(size[0],12,9)}
      else if(shape==="capsule"){col=RAPIER.ColliderDesc.capsule(size[1],size[0]);geo=new THREE.CapsuleGeometry(size[0],size[1]*2,5,8)}
      else{col=RAPIER.ColliderDesc.cuboid(size[0],size[1],size[2]);geo=new THREE.BoxGeometry(size[0]*2,size[1]*2,size[2]*2)}
      col.setDensity(mass).setFriction(.72).setRestitution(.03).setCollisionGroups(GROUP);physics.createCollider(col,body);
      const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.ragdoll=this;mesh.userData.bodyPart=name;scene.add(mesh);this.parts.set(name,{body,mesh});return body
    };
    const pelvis=add("pelvis",0,.82,0,"box",[.19,.14,.13],mats.vest,3.2);
    const torso=add("torso",0,1.19,0,"box",[.23,.27,.14],mats.vest,4.1);
    const head=add("head",0,1.67,-.01,"sphere",[.145],mats.skin,1.4);
    const uaL=add("upperArmL",-.34,1.27,0,"capsule",[.07,.17],mats.cloth,.8),uaR=add("upperArmR",.34,1.27,0,"capsule",[.07,.17],mats.cloth,.8);
    const laL=add("lowerArmL",-.34,.91,0,"capsule",[.06,.16],mats.cloth,.65),laR=add("lowerArmR",.34,.91,0,"capsule",[.06,.16],mats.cloth,.65);
    const thL=add("thighL",-.13,.47,0,"capsule",[.085,.2],mats.cloth,1.45),thR=add("thighR",.13,.47,0,"capsule",[.085,.2],mats.cloth,1.45);
    const shL=add("shinL",-.13,.08,0,"capsule",[.072,.18],mats.boots,1.0),shR=add("shinR",.13,.08,0,"capsule",[.072,.18],mats.boots,1.0);
    const joint=(a,b,aa,bb)=>{try{const j=RAPIER.JointData.spherical(aa,bb);this.joints.push(physics.createImpulseJoint(j,a,b,true))}catch(err){console.warn("ragdoll joint fallback",err)}};
    joint(pelvis,torso,{x:0,y:.15,z:0},{x:0,y:-.28,z:0});joint(torso,head,{x:0,y:.29,z:0},{x:0,y:-.15,z:0});
    joint(torso,uaL,{x:-.25,y:.18,z:0},{x:0,y:.18,z:0});joint(torso,uaR,{x:.25,y:.18,z:0},{x:0,y:.18,z:0});joint(uaL,laL,{x:0,y:-.18,z:0},{x:0,y:.17,z:0});joint(uaR,laR,{x:0,y:-.18,z:0},{x:0,y:.17,z:0});
    joint(pelvis,thL,{x:-.13,y:-.13,z:0},{x:0,y:.21,z:0});joint(pelvis,thR,{x:.13,y:-.13,z:0},{x:0,y:.21,z:0});joint(thL,shL,{x:0,y:-.21,z:0},{x:0,y:.19,z:0});joint(thR,shR,{x:0,y:-.21,z:0},{x:0,y:.19,z:0});
    // Start with a little inherited turn so every body does not fall identically.
    const side=Math.sin(yaw),forward=Math.cos(yaw);pelvis.applyImpulse({x:side*.25,y:.03,z:forward*.25},true);torso.applyTorqueImpulse({x:(Math.random()-.5)*.25,y:(Math.random()-.5)*.15,z:(Math.random()-.5)*.3},true);
    this.sync();
  }
  getPosition(){const p=this.parts.get("pelvis")?.body.translation();return p?{x:p.x,y:p.y,z:p.z}:{x:0,y:0,z:0}}
  impulse(direction,strength=4,part="torso"){
    const target=this.parts.get(part)||this.parts.get("torso");if(!target)return;target.body.applyImpulse({x:direction.x*strength,y:(direction.y||0)*strength+.25*strength,z:direction.z*strength},true);target.body.applyTorqueImpulse({x:(Math.random()-.5)*strength*.16,y:(Math.random()-.5)*strength*.12,z:(Math.random()-.5)*strength*.16},true)
  }
  brace(dt){
    if(!this.recoverable||this.dead)return;const torso=this.parts.get("torso")?.body,pelvis=this.parts.get("pelvis")?.body;if(!torso||!pelvis)return;
    const p=torso.translation();if(p.y<1.12)torso.applyImpulse({x:0,y:Math.min(.09,(1.3-p.y)*.11),z:0},true);
    const pp=pelvis.translation();if(pp.y<.72)pelvis.applyImpulse({x:0,y:Math.min(.07,(.86-pp.y)*.1),z:0},true)
  }
  update(dt){this.age+=dt;this.brace(dt);this.sync()}
  sync(){for(const {body,mesh} of this.parts.values()){const p=body.translation(),q=body.rotation();mesh.position.set(p.x,p.y,p.z);mesh.quaternion.set(q.x,q.y,q.z,q.w)}}
  destroy(){for(const {mesh} of this.parts.values()){this.scene.remove(mesh);mesh.geometry.dispose();if(mesh.material?.dispose)mesh.material.dispose()}for(const j of this.joints){try{this.physics.removeImpulseJoint(j,true)}catch{}}for(const {body} of this.parts.values()){try{this.physics.removeRigidBody(body)}catch{}}this.parts.clear();this.joints.length=0}
}
