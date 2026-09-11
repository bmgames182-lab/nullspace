import * as THREE from "three";

// Keep bodycam presentation effects from corrupting the actual FPS look quaternion.
// PointerLockControls owns yaw/pitch. Any camera roll written elsewhere is stripped immediately
// before rendering so repeated horizontal turns can never accumulate into an Euler/quaternion flip.
const proto=THREE.WebGLRenderer.prototype;
if(!proto.__ghostcamStableRender){
  const nativeRender=proto.render,look=new THREE.Euler(0,0,0,"YXZ"),lastGood=new WeakMap();
  const finite=n=>Number.isFinite(n);
  proto.render=function(scene,camera,...rest){
    if(camera?.isPerspectiveCamera){
      const p=camera.position,q=camera.quaternion;
      let state=lastGood.get(camera);
      if(!state){state={position:p.clone(),quaternion:q.clone()};lastGood.set(camera,state)}
      const positionOk=finite(p.x)&&finite(p.y)&&finite(p.z),quatOk=finite(q.x)&&finite(q.y)&&finite(q.z)&&finite(q.w)&&q.lengthSq()>.0001;
      if(!positionOk)p.copy(state.position);
      if(!quatOk)q.copy(state.quaternion);
      q.normalize();look.setFromQuaternion(q,"YXZ");
      if(!finite(look.x)||!finite(look.y)){look.set(0,0,0,"YXZ")}
      // Stay a few degrees clear of the vertical singularity and never store look-roll on the camera.
      look.x=THREE.MathUtils.clamp(look.x,-Math.PI/2+.07,Math.PI/2-.07);look.z=0;
      q.setFromEuler(look).normalize();camera.rotation.order="YXZ";
      state.position.copy(p);state.quaternion.copy(q)
    }
    return nativeRender.call(this,scene,camera,...rest)
  };
  Object.defineProperty(proto,"__ghostcamStableRender",{value:true})
}
