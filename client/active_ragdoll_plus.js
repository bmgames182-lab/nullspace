import * as THREE from "three";
import {CombatRagdoll} from "./ragdoll.js";

// Original active-ragdoll extension: small balance, stumble-step and protective-arm impulses layered
// over the base controller. The forces are intentionally weak so impacts and world collisions still
// win; this is not an animation pose snap and it never teleports body parts.
const proto=CombatRagdoll.prototype;
if(!proto.__ghostcamActivePlus){
  const baseImpulse=proto.impulse,baseBrace=proto.brace;
  proto.impulse=function(direction,strength=4,part="torso"){
    const x=Number(direction?.x)||0,z=Number(direction?.z)||0,len=Math.hypot(x,z)||1;
    this.__gcImpactDir={x:x/len,z:z/len};this.__gcImpactAge=this.age;this.__gcStepSeed=Math.random()*10;this.__gcImpactPart=part;
    return baseImpulse.call(this,direction,strength,part)
  };
  proto.brace=function(dt){
    baseBrace.call(this,dt);if(!this.recoverable||this.dead)return;
    const torso=this.parts.get("torso")?.body,pelvis=this.parts.get("pelvis")?.body;
    const thL=this.parts.get("thighL")?.body,thR=this.parts.get("thighR")?.body,shL=this.parts.get("shinL")?.body,shR=this.parts.get("shinR")?.body;
    if(!torso||!pelvis)return;
    const tp=torso.translation(),pp=pelvis.translation(),tv=torso.linvel(),pv=pelvis.linvel(),upright=this.getUprightness();
    const since=Math.max(0,this.age-(this.__gcImpactAge??0)),dir=this.__gcImpactDir||{x:0,z:1};
    const recovery=THREE.MathUtils.clamp(this.recoveryBlend||0,0,1),calm=THREE.MathUtils.clamp(1-this.getMotion()/3.4,0,1);

    // Counter the body's horizontal drift only after the initial hit has had time to read visually.
    if(since>.22&&upright>.12){
      const gain=(.25+.75*recovery)*calm,cap=.011*gain;
      const ix=THREE.MathUtils.clamp(-pv.x*.0028,-cap,cap),iz=THREE.MathUtils.clamp(-pv.z*.0028,-cap,cap);
      pelvis.applyImpulse({x:ix,y:0,z:iz},true)
    }

    // Alternating support-leg pushes create a short physical stumble instead of a binary stand/fall.
    if(since>.18&&since<2.9&&upright>.18&&tp.y>.56&&pp.y>.30){
      const phase=Math.floor((this.age+(this.__gcStepSeed||0))/.28),left=(phase&1)===0;
      const thigh=left?thL:thR,shin=left?shL:shR,side=left?-1:1;
      const speed=Math.hypot(tv.x,tv.z),urgency=THREE.MathUtils.clamp(.35+speed*.22+(1-upright)*.6,0,1);
      const push=.0045*urgency*(1-recovery*.35),lift=.0055*urgency;
      thigh?.applyImpulse({x:-dir.x*push+side*.0025*urgency,y:lift,z:-dir.z*push},true);
      shin?.applyImpulse({x:-dir.x*push*.55+side*.0015*urgency,y:lift*.7,z:-dir.z*push*.55},true)
    }

    // When the torso is dropping toward the floor, forearms reach and absorb some of the fall.
    if(tp.y<1.05&&tv.y<-.22&&upright<.72){
      for(const [name,side] of [["lowerArmL",-1],["lowerArmR",1]]){
        const arm=this.parts.get(name)?.body;if(!arm)continue;
        const av=arm.linvel(),strength=THREE.MathUtils.clamp((-tv.y)*.004,.002,.010);
        arm.applyImpulse({x:-dir.x*strength*.7+side*.0025,y:strength-Math.min(0,av.y)*.0015,z:-dir.z*strength*.7},true)
      }
    }
  };
  Object.defineProperty(proto,"__ghostcamActivePlus",{value:true})
}
