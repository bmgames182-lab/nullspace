// The core rifle fires on mousedown. Extend that input into a held-trigger cadence without touching
// hit detection or ammo logic: every repeated shot still goes through game.js's own fire-rate guard.
let held=false,timer=0;
function stop(){held=false;clearTimeout(timer);timer=0}
function repeat(){
  if(!held||!document.pointerLockElement){stop();return}
  document.dispatchEvent(new MouseEvent("mousedown",{button:0,bubbles:true,cancelable:true}));
  timer=setTimeout(repeat,104)
}
window.addEventListener("pointerdown",e=>{
  if(e.button!==0||!e.isTrusted||!document.pointerLockElement)return;held=true;clearTimeout(timer);timer=setTimeout(repeat,104)
},{capture:true});
window.addEventListener("pointerup",e=>{if(e.button===0)stop()},{capture:true});
window.addEventListener("mouseup",e=>{if(e.button===0&&!e.isTrusted)return;if(e.button===0)stop()},{capture:true});
window.addEventListener("blur",stop);document.addEventListener("pointerlockchange",()=>{if(!document.pointerLockElement)stop()});
