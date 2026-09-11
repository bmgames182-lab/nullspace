// Browser input resilience for the bodycam playground.
// PointerLockControls intentionally stops movement when pointer lock drops; this guard makes
// lock recovery explicit so WASD never appears mysteriously dead after deploy/tab/ESC transitions.
const movementCodes=new Set(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight","ControlLeft","ControlRight"]);
const canvas=document.getElementById("game"),boot=document.getElementById("boot"),pause=document.getElementById("pause"),settings=document.getElementById("settings"),hud=document.getElementById("hud");

let hint=null,hintTimer=0,lastLockAttempt=0;
function gameLive(){return !!canvas&&boot?.hidden&&pause?.hidden&&settings?.hidden&&!hud?.hidden}
function showHint(text,ms=1100){
  if(!hint){hint=document.createElement("div");hint.id="inputGuardHint";hint.style.cssText="position:fixed;left:50%;top:56%;transform:translate(-50%,-50%);z-index:40;padding:8px 12px;background:rgba(5,6,6,.72);border:1px solid rgba(230,235,226,.18);color:#eef1ea;font:800 10px ui-monospace,monospace;letter-spacing:.1em;text-shadow:0 1px 4px #000;pointer-events:none;opacity:0;transition:opacity .12s";document.body.appendChild(hint)}
  hint.textContent=text;hint.style.opacity="1";clearTimeout(hintTimer);hintTimer=setTimeout(()=>hint.style.opacity="0",ms)
}
function requestGameLock(){
  if(!gameLive()||document.pointerLockElement)return;
  const now=performance.now();if(now-lastLockAttempt<180)return;lastLockAttempt=now;
  try{
    const target=document.body;
    const p=target.requestPointerLock?.({unadjustedMovement:true});
    if(p?.catch)p.catch(()=>{try{target.requestPointerLock?.()}catch{showHint("CLICK GAME TO CAPTURE INPUT")}})
  }catch{
    try{document.body.requestPointerLock?.()}catch{showHint("CLICK GAME TO CAPTURE INPUT")}
  }
}

// A movement key is itself a user gesture in modern browsers, so use it to recover lock.
window.addEventListener("keydown",e=>{
  if(!movementCodes.has(e.code)||e.repeat||!gameLive()||document.pointerLockElement)return;
  requestGameLock();showHint("INPUT CAPTURED · WASD MOVE",650)
},{capture:true});

// Clicking anywhere on the actual play surface should always resume mouse + keyboard capture.
canvas?.addEventListener("pointerdown",()=>{if(gameLive()&&!document.pointerLockElement)requestGameLock()},{capture:true});

// If the browser refuses pointer lock, don't fail silently.
document.addEventListener("pointerlockerror",()=>{if(gameLive())showHint("INPUT NOT CAPTURED · CLICK THE GAME",1500)});
document.addEventListener("pointerlockchange",()=>{
  if(document.pointerLockElement){if(hint)hint.style.opacity="0";return}
  // ESC is still a valid pause gesture; only show a hint if the game UI remains live.
  if(gameLive())showHint("CLICK OR PRESS WASD TO RESUME INPUT",1200)
});

window.__GHOSTCAM_INPUT_GUARD__={requestGameLock,gameLive};
