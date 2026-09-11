import * as THREE from "three";
import {CombatRagdoll} from "./ragdoll.js";

// Injury/reflex layer for the physics-first controller in ragdoll.js. This deliberately does NOT
// run a second balance controller. It only adds short, local reactions to the body part that was hit
// so recoverable characters look like they are protecting themselves instead of uniformly flopping.
const proto=CombatRagdoll.prototype;
const clamp=THREE.MathUtils.clamp;
if(!proto.__ghostcamActivePlus){
  const baseImpulse=proto.impulse,baseBrace=proto.brace;

  proto.impulse=function(direction,strength=4,part="torso"){
    const out=baseImpulse.call(this,direction,strength,part);
    const x=Number(direction?.x)||0,z=Number(direction?.z)||0,len=Math.hypot(x,z)||1;
    this.__gcReflex={age:this.age,part,strength:clamp(strength/8,0,1),dir:{x:x/len,z:z/len},seed:Math.random()*Math.PI*2};
    return out
  };

  proto.brace=function(dt){
    baseBrace.call(this,dt);if(!this.recoverable||this.dead)return;
    const r=this.__gcReflex;if(!r)return;const t=this.age-r.age;if(t<0||t>1.25){if(t>1.25)this.__gcReflex=null;return}
    const frame=clamp(dt*60,.25,2),fade=Math.pow(clamp(1-t/1.25,0,1),1.5),gain=fade*(.35+.65*r.strength);
    const pelvis=this.part?.("pelvis"),torso=this.part?.("torso"),head=this.part?.("head"),uaL=this.part?.("upperArmL"),uaR=this.part?.("upperArmR"),laL=this.part?.("lowerArmL"),laR=this.part?.("lowerArmR");
    const thL=this.part?.("thighL"),thR=this.part?.("thighR"),shL=this.part?.("shinL"),shR=this.part?.("shinR"),ftL=this.part?.("footL"),ftR=this.part?.("footR");
    if(!pelvis||!torso)return;

    const part=r.part||"torso",left=part.endsWith("L"),right=part.endsWith("R"),leg=part.startsWith("leg")||part.startsWith("thigh")||part.startsWith("shin")||part.startsWith("foot"),arm=part.startsWith("arm")||part.includes("Arm"),headHit=part==="head";

    // Local recoil: the hit region yields away from the shot for a few frames while the opposite
    // side tries to keep supporting the body. Small enough not to compete with the main controller.
    const recoil=.0065*gain*frame;if(t<.34){
      if(headHit&&head){head.applyImpulse({x:r.dir.x*recoil,y:.0025*gain*frame,z:r.dir.z*recoil},true);for(const a of [laL,laR])a?.applyImpulse({x:-r.dir.x*.003*gain*frame,y:.004*gain*frame,z:-r.dir.z*.003*gain*frame},true)}
      else if(arm){const a=left?laL:right?laR:laR;a?.applyImpulse({x:r.dir.x*recoil,y:.002*gain*frame,z:r.dir.z*recoil},true)}
      else if(leg){const thigh=left?thL:right?thR:thR,shin=left?shL:right?shR:shR;thigh?.applyImpulse({x:r.dir.x*recoil*.65,y:.004*gain*frame,z:r.dir.z*recoil*.65},true);shin?.applyImpulse({x:r.dir.x*recoil,y:.005*gain*frame,z:r.dir.z*recoil},true)}
      else torso.applyImpulse({x:r.dir.x*recoil*.55,y:.0015*gain*frame,z:r.dir.z*recoil*.55},true)
    }

    // Leg hits unload the injured side and make the opposite foot plant harder. This gives the
    // familiar hop/buckle/catch sequence instead of both legs reacting identically.
    if(leg&&t<.72){
      const injuredFoot=left?ftL:right?ftR:ftR,injuredShin=left?shL:right?shR:shR,supportFoot=left?ftR:ftL;
      injuredFoot?.applyImpulse({x:-r.dir.x*.0035*gain*frame,y:.008*gain*frame,z:-r.dir.z*.0035*gain*frame},true);
      injuredShin?.applyImpulse({x:-r.dir.x*.0025*gain*frame,y:.005*gain*frame,z:-r.dir.z*.0025*gain*frame},true);
      if(supportFoot){const v=supportFoot.linvel();supportFoot.applyImpulse({x:clamp(-v.x*.005,-.009,.009)*frame,y:-.003*gain*frame,z:clamp(-v.z*.005,-.009,.009)*frame},true)}
    }

    // Torso/head impacts trigger a brief protective arm movement. It is intentionally asymmetrical
    // so repeated hits do not produce a robotic mirrored pose.
    if((headHit||part==="torso"||part==="abdomen")&&t>.04&&t<.62){
      const primary=Math.sin(r.seed)>0?laL:laR,secondary=primary===laL?laR:laL;
      const tp=torso.translation();for(const [a,k] of [[primary,1],[secondary,.62]])if(a){const p=a.translation(),v=a.linvel(),targetY=headHit?tp.y+.30:tp.y+.02;a.applyImpulse({x:clamp((tp.x-p.x)*.012-v.x*.0018,-.010,.010)*gain*k*frame,y:clamp((targetY-p.y)*.013-v.y*.0012,-.004,.011)*gain*k*frame,z:clamp((tp.z-p.z-.08)*.012-v.z*.0018,-.010,.010)*gain*k*frame},true)}
    }

    // Severe impacts make the arms spread and hunt for balance for a moment, then the effect fades.
    if(r.strength>.58&&t>.18&&t<.9){const phase=Math.sin((t*14)+r.seed),s=.0038*gain*frame;uaL?.applyImpulse({x:-s*(1+.25*phase),y:.002*gain*frame,z:-r.dir.z*s*.35},true);uaR?.applyImpulse({x:s*(1-.25*phase),y:.002*gain*frame,z:-r.dir.z*s*.35},true)}
  };

  Object.defineProperty(proto,"__ghostcamActivePlus",{value:true})
}
