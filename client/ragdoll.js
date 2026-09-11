import * as THREE from "three";

// Physics-first active ragdoll. Recoverable bodies keep weak procedural muscle control: they yield
// to impacts, fight for balance with their feet, brace with their arms, and only hand control back
// to the animated Soldier once they are genuinely upright and settled. Dead bodies stay fully limp.
const GROUP=(0x0002<<16)|0x0001;
const UP=new THREE.Vector3(0,1,0),FORWARD=new THREE.Vector3(0,0,1);
const tmpUp=new THREE.Vector3(),tmpAxis=new THREE.Vector3(),tmpForward=new THREE.Vector3(),tmpSide=new THREE.Vector3(),tmpQ=new THREE.Quaternion();
const clamp=THREE.MathUtils.clamp;

export class CombatRagdoll{
  constructor(scene,physics,RAPIER,{x=0,y=0,z=0,team="red",yaw=0,recoverable=false}={}){
    this.scene=scene;this.physics=physics;this.RAPIER=RAPIER;this.parts=new Map();this.joints=[];
    this.recoverable=recoverable;this.dead=!recoverable;this.age=0;this.settleTime=0;this.recoveryBlend=0;
    this.lastImpactAge=-99;this.impactSeverity=0;this.impactDir={x:0,z:1};this.impactPart="torso";
    this.stepSide=Math.random()<.5?-1:1;this.stepPhase="idle";this.stepStartedAt=0;this.stepEndsAt=0;this.stepCooldownUntil=.10+Math.random()*.12;this.stepTarget={x:0,z:0};
    this.supportQuality=0;this.groundTime=0;

    const cloth=team==="blue"?0x33484e:0x514039,vest=team==="blue"?0x202c2e:0x302724;
    const mats={cloth:new THREE.MeshStandardMaterial({color:cloth,roughness:.92}),vest:new THREE.MeshStandardMaterial({color:vest,roughness:.86}),skin:new THREE.MeshStandardMaterial({color:0x9b725b,roughness:.96}),boots:new THREE.MeshStandardMaterial({color:0x151716,roughness:.94})};
    const add=(name,px,py,pz,shape,size,mat,mass=1)=>{
      const desc=RAPIER.RigidBodyDesc.dynamic().setTranslation(x+px,y+py,z+pz).setLinearDamping(.34).setAngularDamping(.68).setCcdEnabled(name==="head"||name.startsWith("foot"));
      const body=physics.createRigidBody(desc);let col,geo;
      if(shape==="sphere"){col=RAPIER.ColliderDesc.ball(size[0]);geo=new THREE.SphereGeometry(size[0],12,9)}
      else if(shape==="capsule"){col=RAPIER.ColliderDesc.capsule(size[1],size[0]);geo=new THREE.CapsuleGeometry(size[0],size[1]*2,5,8)}
      else{col=RAPIER.ColliderDesc.cuboid(size[0],size[1],size[2]);geo=new THREE.BoxGeometry(size[0]*2,size[1]*2,size[2]*2)}
      col.setDensity(mass).setFriction(name.startsWith("foot")?1.35:.92).setRestitution(.005).setCollisionGroups(GROUP);physics.createCollider(col,body);
      const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.ragdoll=this;mesh.userData.bodyPart=name;scene.add(mesh);this.parts.set(name,{body,mesh});return body
    };

    // More articulated than the old rigid torso block: pelvis -> abdomen -> chest, plus actual feet.
    const pelvis=add("pelvis",0,1.00,0,"box",[.20,.14,.14],mats.vest,3.5);
    const abdomen=add("abdomen",0,1.23,0,"box",[.205,.14,.125],mats.cloth,2.2);
    const torso=add("torso",0,1.50,0,"box",[.24,.22,.145],mats.vest,4.0);
    const head=add("head",0,1.84,-.01,"sphere",[.15],mats.skin,1.35);
    const uaL=add("upperArmL",-.34,1.46,0,"capsule",[.07,.17],mats.cloth,.82),uaR=add("upperArmR",.34,1.46,0,"capsule",[.07,.17],mats.cloth,.82);
    const laL=add("lowerArmL",-.34,1.10,0,"capsule",[.06,.16],mats.cloth,.66),laR=add("lowerArmR",.34,1.10,0,"capsule",[.06,.16],mats.cloth,.66);
    const thL=add("thighL",-.13,.68,0,"capsule",[.085,.20],mats.cloth,1.5),thR=add("thighR",.13,.68,0,"capsule",[.085,.20],mats.cloth,1.5);
    const shL=add("shinL",-.13,.29,0,"capsule",[.072,.18],mats.boots,1.05),shR=add("shinR",.13,.29,0,"capsule",[.072,.18],mats.boots,1.05);
    const ftL=add("footL",-.13,.075,-.08,"box",[.095,.045,.16],mats.boots,.62),ftR=add("footR",.13,.075,-.08,"box",[.095,.045,.16],mats.boots,.62);

    const keep=j=>{try{j?.setContactsEnabled?.(false)}catch{}if(j)this.joints.push(j);return j};
    const spherical=(a,b,aa,bb)=>{try{return keep(physics.createImpulseJoint(RAPIER.JointData.spherical(aa,bb),a,b,true))}catch(err){console.warn("spherical ragdoll joint fallback",err);return null}};
    const hinge=(a,b,aa,bb,min,max)=>{try{const j=keep(physics.createImpulseJoint(RAPIER.JointData.revolute(aa,bb,{x:1,y:0,z:0}),a,b,true));j?.setLimits?.(min,max);return j}catch(err){console.warn("hinge ragdoll joint fallback",err);return spherical(a,b,aa,bb)}};

    // Two spine joints allow bending while the active controller prevents rubber-body collapse.
    spherical(pelvis,abdomen,{x:0,y:.14,z:0},{x:0,y:-.14,z:0});
    spherical(abdomen,torso,{x:0,y:.14,z:0},{x:0,y:-.22,z:0});
    spherical(torso,head,{x:0,y:.22,z:0},{x:0,y:-.15,z:0});
    spherical(torso,uaL,{x:-.25,y:.13,z:0},{x:0,y:.18,z:0});spherical(torso,uaR,{x:.25,y:.13,z:0},{x:0,y:.18,z:0});
    hinge(uaL,laL,{x:0,y:-.18,z:0},{x:0,y:.17,z:0},-2.2,.18);hinge(uaR,laR,{x:0,y:-.18,z:0},{x:0,y:.17,z:0},-2.2,.18);
    spherical(pelvis,thL,{x:-.13,y:-.13,z:0},{x:0,y:.21,z:0});spherical(pelvis,thR,{x:.13,y:-.13,z:0},{x:0,y:.21,z:0});
    hinge(thL,shL,{x:0,y:-.21,z:0},{x:0,y:.19,z:0},-.15,2.08);hinge(thR,shR,{x:0,y:-.21,z:0},{x:0,y:.19,z:0},-.15,2.08);
    hinge(shL,ftL,{x:0,y:-.19,z:0},{x:0,y:.045,z:.06},-.48,.62);hinge(shR,ftR,{x:0,y:-.19,z:0},{x:0,y:.045,z:.06},-.48,.62);

    // Initial orientation follows the soldier so the first physical frame does not snap sideways.
    const yawQ=new THREE.Quaternion().setFromAxisAngle(UP,yaw);for(const {body} of this.parts.values())body.setRotation({x:yawQ.x,y:yawQ.y,z:yawQ.z,w:yawQ.w},true);
    this.sync();
  }

  part(name){return this.parts.get(name)?.body||null}
  getPosition(){const p=this.part("pelvis")?.translation();return p?{x:p.x,y:p.y,z:p.z}:{x:0,y:0,z:0}}
  getUprightness(){const b=this.part("torso");if(!b)return 0;const q=b.rotation();tmpQ.set(q.x,q.y,q.z,q.w);tmpUp.copy(UP).applyQuaternion(tmpQ);return tmpUp.dot(UP)}
  getMotion(){
    const torso=this.part("torso"),pelvis=this.part("pelvis");if(!torso||!pelvis)return 99;
    const a=torso.linvel(),b=pelvis.linvel(),av=torso.angvel();return Math.hypot(a.x,a.y,a.z)*.48+Math.hypot(b.x,b.y,b.z)*.36+Math.hypot(av.x,av.y,av.z)*.18
  }
  footSupport(body){
    if(!body)return 0;const p=body.translation(),v=body.linvel();if(p.y>.205)return 0;
    const q=body.rotation();tmpQ.set(q.x,q.y,q.z,q.w);tmpUp.copy(UP).applyQuaternion(tmpQ);
    const height=clamp((.205-p.y)/.13,0,1),flat=clamp((tmpUp.y-.30)/.70,0,1),vertical=clamp(1-Math.abs(v.y)/1.15,0,1);
    return height*flat*vertical
  }
  getSupportCenter(){
    const l=this.part("footL"),r=this.part("footR"),lp=l?.translation(),rp=r?.translation(),lw=this.footSupport(l),rw=this.footSupport(r),weight=lw+rw;
    if(weight>.001)return{x:(lp.x*lw+rp.x*rw)/weight,z:(lp.z*lw+rp.z*rw)/weight,count:weight,left:lw,right:rw};
    const p=this.part("pelvis")?.translation();return p?{x:p.x,z:p.z,count:0,left:0,right:0}:{x:0,z:0,count:0,left:0,right:0}
  }
  canRecover(){
    if(!this.recoverable||this.dead||this.age<1.45)return false;
    const torso=this.part("torso"),pelvis=this.part("pelvis");if(!torso||!pelvis)return false;
    const tp=torso.translation(),pp=pelvis.translation(),motion=this.getMotion(),upright=this.getUprightness();
    return this.recoveryBlend>.78&&this.supportQuality>.45&&this.settleTime>.18&&motion<1.18&&tp.y>1.24&&pp.y>.82&&upright>.72&&this.stepPhase==="idle"
  }

  impulse(direction,strength=4,part="torso"){
    const target=this.parts.get(part)||this.parts.get("torso");if(!target)return;
    const x=Number(direction?.x)||0,z=Number(direction?.z)||0,len=Math.hypot(x,z)||1;
    this.impactDir={x:x/len,z:z/len};this.impactPart=part;this.lastImpactAge=this.age;this.impactSeverity=clamp(strength/8+(part==="head"?.12:0),0,1);
    this.settleTime=0;this.recoveryBlend=Math.max(0,this.recoveryBlend-.30-.34*this.impactSeverity);
    if(this.stepPhase!=="idle"){this.stepPhase="idle";this.stepCooldownUntil=this.age+.12}
    // Bullets should stagger a person, not launch them vertically. Keep the upward component tiny.
    const y=(Number(direction?.y)||0)*strength+.035*strength;
    target.body.applyImpulse({x:(Number(direction?.x)||0)*strength,y,z:(Number(direction?.z)||0)*strength},true);
    const torque=Math.min(.42,strength*.055);target.body.applyTorqueImpulse({x:(Math.random()-.5)*torque,y:(Math.random()-.5)*torque*.55,z:(Math.random()-.5)*torque},true)
  }

  uprightTorque(body,gain,damping,frame=1){
    if(!body)return;const q=body.rotation();tmpQ.set(q.x,q.y,q.z,q.w);tmpUp.copy(UP).applyQuaternion(tmpQ);tmpAxis.copy(tmpUp).cross(UP);const av=body.angvel();
    const ix=clamp(tmpAxis.x*gain-av.x*damping,-gain,gain)*frame,iy=clamp(-av.y*damping*.42,-gain*.25,gain*.25)*frame,iz=clamp(tmpAxis.z*gain-av.z*damping,-gain,gain)*frame;
    body.applyTorqueImpulse({x:ix,y:iy,z:iz},true)
  }
  stabiliseFoot(body,quality,active,frame){
    if(!body||quality<=.05||active<=.02)return;const q=body.rotation();tmpQ.set(q.x,q.y,q.z,q.w);tmpUp.copy(UP).applyQuaternion(tmpQ);tmpAxis.copy(tmpUp).cross(UP);const av=body.angvel();
    const gain=.0105*quality*active,damping=.0028*quality*active;
    body.applyTorqueImpulse({x:clamp(tmpAxis.x*gain-av.x*damping,-.012,.012)*frame,y:0,z:clamp(tmpAxis.z*gain-av.z*damping,-.012,.012)*frame},true)
  }

  beginCaptureStep(pelvis,ftL,ftR,errX,errZ,pv,tmpSide){
    if(!ftL||!ftR)return;
    const pp=pelvis.translation(),lp=ftL.translation(),rp=ftR.translation();
    const predict=.16+Math.min(.18,Math.hypot(pv.x,pv.z)*.055);
    const baseX=pp.x+pv.x*predict+errX*.78+this.impactDir.x*this.impactSeverity*.08;
    const baseZ=pp.z+pv.z*predict+errZ*.78+this.impactDir.z*this.impactSeverity*.08;
    const dl=Math.hypot(baseX-lp.x,baseZ-lp.z),dr=Math.hypot(baseX-rp.x,baseZ-rp.z);
    this.stepSide=dl>dr?-1:1;
    const lateral=this.stepSide*.16;
    this.stepTarget.x=baseX+tmpSide.x*lateral;this.stepTarget.z=baseZ+tmpSide.z*lateral;
    this.stepStartedAt=this.age;this.stepEndsAt=this.age+clamp(.42-Math.hypot(pv.x,pv.z)*.035,.28,.42);this.stepPhase="swing"
  }

  brace(dt){
    if(!this.recoverable||this.dead)return;
    const torso=this.part("torso"),abdomen=this.part("abdomen"),pelvis=this.part("pelvis"),head=this.part("head");
    const thL=this.part("thighL"),thR=this.part("thighR"),shL=this.part("shinL"),shR=this.part("shinR"),ftL=this.part("footL"),ftR=this.part("footR");
    if(!torso||!pelvis)return;
    const frame=clamp(dt*60,.25,2.0),since=this.age-this.lastImpactAge,motion=this.getMotion(),upright=this.getUprightness();
    const pp=pelvis.translation(),tp=torso.translation(),pv=pelvis.linvel(),tv=torso.linvel();

    // Short neural-yield window after a hard impact, then muscles progressively re-engage.
    const yieldLoss=this.impactSeverity*clamp(1-since/.62,0,1),muscle=clamp(1-yieldLoss*.82,0.16,1);
    const calm=clamp(1-motion/4.8,0,1),ageReady=clamp((this.age-.28)/1.25,0,1);
    const recoveryTarget=ageReady*(.30+.70*calm)*muscle;
    this.recoveryBlend=THREE.MathUtils.lerp(this.recoveryBlend,recoveryTarget,1-Math.exp(-dt*3.1));
    const active=clamp((.22+.78*this.recoveryBlend)*muscle,0,1);

    // Spine/head virtual muscles. These are capped impulses, never teleports or pose snaps.
    this.uprightTorque(pelvis,.030*active,.0048,frame);this.uprightTorque(abdomen,.040*active,.0056,frame);this.uprightTorque(torso,.052*active,.0065,frame);this.uprightTorque(head,.014*active,.0032,frame);

    // Leg extension / anti-collapse. A falling body can still overpower this, but a moderate hit
    // now produces a crouch/stumble rather than immediate total loss of posture.
    if(upright>-.05){
      const lift=clamp((.96-pp.y)*.060-pv.y*.006,-.015,.050)*active*frame;
      if(lift>0)pelvis.applyImpulse({x:0,y:lift,z:0},true);
      const chestLift=clamp((1.43-tp.y)*.035-tv.y*.004,-.010,.030)*active*frame;if(chestLift>0)torso.applyImpulse({x:0,y:chestLift,z:0},true)
    }

    // Centre of mass versus physically credible support. A low but tipped/bouncing foot only counts
    // partially, so the controller cannot mistake the side of a boot for a stable planted stance.
    const support=this.getSupportCenter(),comX=pp.x*.55+tp.x*.45,comZ=pp.z*.55+tp.z*.45,errX=comX-support.x,errZ=comZ-support.z;
    const err=Math.hypot(errX,errZ),speed=Math.hypot(pv.x,pv.z);this.supportQuality=clamp((support.count/2)*1.18-err*1.4-speed*.10,0,1);
    if(support.count>.05&&since>.10){
      const catchGain=clamp(.006+.016*active,0,.022),ix=clamp(-errX*.030-pv.x*catchGain,-.028,.028)*frame,iz=clamp(-errZ*.030-pv.z*catchGain,-.028,.028)*frame;
      pelvis.applyImpulse({x:ix,y:0,z:iz},true)
    }

    // Build body-forward/side directions for capture stepping.
    const pq=pelvis.rotation();tmpQ.set(pq.x,pq.y,pq.z,pq.w);tmpForward.copy(FORWARD).applyQuaternion(tmpQ);tmpForward.y=0;if(tmpForward.lengthSq()<.001)tmpForward.set(this.impactDir.x,0,this.impactDir.z);tmpForward.normalize();tmpSide.set(tmpForward.z,0,-tmpForward.x);
    const needsStep=(err>.11||speed>.48||upright<.80||support.count<.72)&&upright>.12&&pp.y>.38&&this.age>.10;

    // A real catch step is a committed action: choose one swing foot, move it to a predicted capture
    // point, plant it, then reassess. This replaces the old left/right flip every few frames.
    if(this.stepPhase==="idle"&&needsStep&&this.age>=this.stepCooldownUntil)this.beginCaptureStep(pelvis,ftL,ftR,errX,errZ,pv,tmpSide);
    if(this.stepPhase!=="idle"){
      const left=this.stepSide<0,foot=left?ftL:ftR,shin=left?shL:shR,thigh=left?thL:thR;
      const supportFoot=left?ftR:ftL;
      if(foot&&shin&&thigh){
        const fp=foot.translation(),fv=foot.linvel();
        if(this.stepPhase==="swing"){
          const duration=Math.max(.001,this.stepEndsAt-this.stepStartedAt),phase=clamp((this.age-this.stepStartedAt)/duration,0,1),ease=phase*phase*(3-2*phase);
          const dx=this.stepTarget.x-fp.x,dz=this.stepTarget.z-fp.z,dist=Math.hypot(dx,dz);
          const horizontalGain=.018+.014*(1-ease),sx=clamp(dx*horizontalGain-fv.x*.0038,-.026,.026)*active*frame,sz=clamp(dz*horizontalGain-fv.z*.0038,-.026,.026)*active*frame;
          const liftWave=Math.sin(Math.PI*phase),desiredLift=.045+.085*liftWave;
          const sy=clamp((desiredLift-fp.y)*.038-fv.y*.003,-.010,.020)*active*frame;
          foot.applyImpulse({x:sx,y:sy,z:sz},true);shin.applyImpulse({x:sx*.50,y:Math.max(0,sy)*.52,z:sz*.50},true);thigh.applyImpulse({x:sx*.28,y:Math.max(0,sy)*.28,z:sz*.28},true);
          if((phase>.58&&dist<.11&&fp.y<.14)||phase>=1){this.stepPhase="plant";this.stepEndsAt=this.age+.13}
        }else if(this.stepPhase==="plant"){
          const v=foot.linvel(),q=this.footSupport(foot);foot.applyImpulse({x:clamp(-v.x*.010,-.018,.018)*frame,y:fp.y>.11?-.006*frame:-.002*frame,z:clamp(-v.z*.010,-.018,.018)*frame},true);this.stabiliseFoot(foot,q,active,frame);
          if(this.age>=this.stepEndsAt){this.stepPhase="idle";this.stepCooldownUntil=this.age+.18+Math.random()*.10}
        }
      }else{this.stepPhase="idle";this.stepCooldownUntil=this.age+.20}

      // The non-swing foot is the actual support leg during the catch. Keep it planted instead of
      // allowing both feet to skate while the controller tries to move the body.
      if(supportFoot){const q=this.footSupport(supportFoot),sv=supportFoot.linvel();if(q>.05){supportFoot.applyImpulse({x:clamp(-sv.x*.010*q,-.017,.017)*frame,y:-.0025*active*q*frame,z:clamp(-sv.z*.010*q,-.017,.017)*frame},true);this.stabiliseFoot(supportFoot,q,active,frame)}}
    }

    // When no capture step is active, both credible planted feet provide traction and a tiny
    // anti-roll ankle reflex. Tipped or bouncing feet are deliberately not treated as anchors.
    if(this.stepPhase==="idle")for(const [foot,q] of [[ftL,support.left],[ftR,support.right]]){if(!foot||q<=.05)continue;const v=foot.linvel();foot.applyImpulse({x:clamp(-v.x*.006*q,-.012,.012)*frame,y:-.002*active*q*frame,z:clamp(-v.z*.006*q,-.012,.012)*frame},true);this.stabiliseFoot(foot,q,active,frame)}

    // Protective reach: arms go toward the direction of travel before impact, then push back off the
    // floor if the hands get low. This gives catches/braces instead of permanently dead arms.
    const fallSpeed=Math.max(0,-tv.y),falling=fallSpeed>.20||upright<.62;
    if(falling){
      const reachX=Math.abs(pv.x)+Math.abs(pv.z)>.15?pv.x:this.impactDir.x,reachZ=Math.abs(pv.x)+Math.abs(pv.z)>.15?pv.z:this.impactDir.z,rl=Math.hypot(reachX,reachZ)||1;
      for(const [name,side] of [["lowerArmL",-1],["lowerArmR",1]]){const arm=this.part(name);if(!arm)continue;const ap=arm.translation(),av=arm.linvel();if(ap.y>.46){arm.applyImpulse({x:(reachX/rl*.009+tmpSide.x*side*.004)*active*frame,y:-.004*active*frame,z:(reachZ/rl*.009+tmpSide.z*side*.004)*active*frame},true)}else if(av.y<.65){arm.applyImpulse({x:-pv.x*.0025*frame,y:(.010+fallSpeed*.004)*active*frame,z:-pv.z*.0025*frame},true)}}
    }

    // If fully folded on the ground, allow a slow push-to-knees phase rather than endlessly buzzing.
    if(pp.y<.48&&tp.y<.82){this.groundTime+=dt}else this.groundTime=Math.max(0,this.groundTime-dt*2);
    if(this.groundTime>.30&&motion<2.2){const push=clamp((this.groundTime-.30)*.018,0,.028)*active*frame;pelvis.applyImpulse({x:0,y:push,z:0},true);torso.applyImpulse({x:0,y:push*.8,z:0},true)}
  }

  update(dt){
    this.age+=dt;this.brace(dt);const motion=this.getMotion();
    this.settleTime=motion<1.05&&this.supportQuality>.28&&this.stepPhase==="idle"?this.settleTime+dt:Math.max(0,this.settleTime-dt*2.0);
    this.impactSeverity=THREE.MathUtils.lerp(this.impactSeverity,0,1-Math.exp(-dt*.72));this.sync()
  }
  sync(){for(const {body,mesh} of this.parts.values()){const p=body.translation(),q=body.rotation();mesh.position.set(p.x,p.y,p.z);mesh.quaternion.set(q.x,q.y,q.z,q.w)}}
  destroy(){
    for(const {mesh} of this.parts.values()){this.scene.remove(mesh);mesh.geometry.dispose()}
    const disposed=new Set();for(const {mesh} of this.parts.values()){const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const m of mats)if(m&&!disposed.has(m)){m.dispose?.();disposed.add(m)}}
    for(const j of this.joints){try{this.physics.removeImpulseJoint(j,true)}catch{}}for(const {body} of this.parts.values()){try{this.physics.removeRigidBody(body)}catch{}}this.parts.clear();this.joints.length=0
  }
}
