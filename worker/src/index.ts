import { DurableObject } from "cloudflare:workers";

type Env = { GAME_ROOM: DurableObjectNamespace<GameRoom> };
type Role = "unassigned" | "researcher" | "security" | "quarantine" | "anomaly" | "observer";
type Phase = "waiting" | "briefing" | "active" | "extraction" | "sealed" | "ended";

type Player = {
  id:string; name:string; x:number; z:number; yaw:number; pitch:number;
  hp:number; maxHp:number; role:Role; dead:boolean; escaped:boolean;
  ammo:number; reserve:number; weapon:boolean; hasKeycard:boolean;
  lastSeen:number; lastShot:number; lastAbility:number; revealedUntil:number;
};

type RoundState = {
  phase:Phase; seed:string; createdAt:number; startsAt:number; startedAt:number;
  extractionStartedAt:number; extractionEndsAt:number; endedAt:number;
  keycardTaken:boolean; keycardHolder:string | null; anomalyEscaped:boolean;
  winner:"humans"|"anomaly"|null; reason:string; roundNumber:number; armoryCharges:number; medCharges:number;
};

type Vec2 = { x:number; z:number };
const POS = {
  keycard:{x:-16,z:14}, terminal:{x:14,z:13}, gate:{x:17,z:-14}, seal:{x:12.5,z:-14}, armory:{x:-17,z:-4}, med:{x:4,z:-17}
} satisfies Record<string,Vec2>;
const MAX_PLAYERS = 12;

export default {
  async fetch(request:Request, env:Env):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==="/health") return json({ok:true,service:"nullspace-multiplayer",version:2});
    const match=url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,16})$/);
    if(!match) return json({service:"NULLSPACE // Site-Null",status:"online",hint:"Connect with WebSocket /room/{code}"});
    if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket") return new Response("Expected WebSocket",{status:426});
    const code=match[1].toUpperCase();
    const id=env.GAME_ROOM.idFromName(code);
    return env.GAME_ROOM.get(id).fetch(request);
  }
};

export class GameRoom extends DurableObject<Env> {
  private players=new Map<string,Player>();
  private round:RoundState=blankRound("");

  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      const saved=await ctx.storage.get<RoundState>("round");
      if(saved) this.round=saved;
      for(const ws of ctx.getWebSockets()){
        const p=ws.deserializeAttachment() as Player|null;
        if(p?.id) this.players.set(p.id,p);
      }
    });
  }

  async fetch(request:Request):Promise<Response>{
    await this.checkTransitions();
    const url=new URL(request.url);
    const code=(url.pathname.split("/").pop()||"NULL").toUpperCase();
    if(!this.round.seed){this.round=blankRound(code);await this.persistRound();}
    const name=cleanName(url.searchParams.get("name")||"wanderer");
    if(this.ctx.getWebSockets().length>=MAX_PLAYERS) return new Response("Incident is full",{status:409});

    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    const id=crypto.randomUUID().slice(0,8);
    const midRound=this.round.phase==="active"||this.round.phase==="extraction"||this.round.phase==="sealed";
    const p:Player={id,name,x:-14,z:-14,yaw:0,pitch:0,hp:100,maxHp:100,role:midRound?"observer":"unassigned",dead:midRound,escaped:false,ammo:0,reserve:0,weapon:false,hasKeycard:false,lastSeen:Date.now(),lastShot:0,lastAbility:0,revealedUntil:0};
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(p);this.players.set(id,p);

    if(!midRound && this.round.phase==="waiting" && this.activeLobbyCount()>=2){
      this.round.phase="briefing";this.round.startsAt=Date.now()+8000;await this.persistRound();
      this.broadcast({type:"event",kind:"countdown",text:"Incident locks in 8 seconds."});
    }

    server.send(JSON.stringify({type:"welcome",id,room:code,players:this.publicPlayers(),self:this.selfView(p),round:this.publicRound()}));
    this.broadcast({type:"event",kind:"join",name,text:`${name} entered the incident.`},server);
    this.broadcastRound();
    return new Response(null,{status:101,webSocket:client});
  }

  async webSocketMessage(ws:WebSocket,data:string|ArrayBuffer){
    if(typeof data!=="string"||data.length>4096) return;
    let msg:any;try{msg=JSON.parse(data);}catch{return;}
    let p=ws.deserializeAttachment() as Player|null;if(!p) return;
    await this.checkTransitions();

    if(msg.type==="state"){
      if(p.dead||p.escaped) return;
      const now=Date.now();
      const dt=Math.max(.05,Math.min(1.5,(now-p.lastSeen)/1000));
      const nx=finite(msg.x,p.x,-19.7,19.7),nz=finite(msg.z,p.z,-19.7,19.7);
      const dist=Math.hypot(nx-p.x,nz-p.z);const maxDist=8.2*dt+.28;
      if(dist<=maxDist){p.x=nx;p.z=nz;}
      p.yaw=finite(msg.yaw,p.yaw,-20,20);p.pitch=finite(msg.pitch,p.pitch,-1.55,1.55);p.lastSeen=now;
      this.savePlayer(ws,p);
      this.broadcast({type:"playerState",player:this.publicPlayer(p)},ws);
      return;
    }

    if(msg.type==="shoot"){
      if(p.dead||p.escaped||p.ammo<=0||!p.weapon) return;
      const now=Date.now();if(now-p.lastShot<145) return;p.lastShot=now;p.ammo--;
      this.savePlayer(ws,p);this.sendSelf(ws,p);
      const ox=finite(msg.origin?.x,p.x,-21,21),oz=finite(msg.origin?.z,p.z,-21,21);
      let dx=finite(msg.direction?.x,0,-1,1),dz=finite(msg.direction?.z,-1,-1,1);const len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
      this.broadcast({type:"shot",id:p.id,name:p.name,x:ox,z:oz,dx,dz});
      const target=this.rayTarget(p,{x:ox,z:oz},{x:dx,z:dz});
      if(target){
        const damage=target.role==="anomaly"?26:34;
        await this.applyDamage(target,p,damage,"gunfire");
      }
      return;
    }

    if(msg.type==="reload"){
      if(p.dead||p.escaped||p.ammo>=12||p.reserve<=0) return;
      const take=Math.min(12-p.ammo,p.reserve);p.ammo+=take;p.reserve-=take;this.savePlayer(ws,p);this.sendSelf(ws,p);
      this.broadcast({type:"reload",id:p.id},ws);return;
    }

    if(msg.type==="ability"){
      if(p.role!=="anomaly"||p.dead||p.escaped) return;
      const now=Date.now();if(now-p.lastAbility<6500){this.send(ws,{type:"notice",text:"Assimilation response not ready."});return;}
      const target=this.nearestHuman(p,2.15);if(!target){this.send(ws,{type:"notice",text:"No viable host in reach."});return;}
      p.lastAbility=now;p.revealedUntil=now+2800;this.savePlayer(ws,p);
      this.broadcast({type:"reveal",id:p.id,until:p.revealedUntil});
      if(target.hp<=45){await this.convert(target,p);}else{await this.applyDamage(target,p,45,"anomaly");}
      return;
    }

    if(msg.type==="interact" && typeof msg.kind==="string"){
      await this.interact(ws,p,msg.kind);return;
    }
  }

  async webSocketClose(ws:WebSocket){
    const p=ws.deserializeAttachment() as Player|null;if(!p)return;
    this.players.delete(p.id);
    if(this.round.keycardHolder===p.id){this.round.keycardHolder=null;this.round.keycardTaken=false;p.hasKeycard=false;await this.persistRound();}
    this.broadcast({type:"event",kind:"leave",name:p.name,text:`${p.name} disappeared from comms.`});
    await this.checkWin();this.broadcastRound();
  }
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}

  private async interact(ws:WebSocket,p:Player,kind:string){
    if(p.dead||p.escaped) return;
    if(kind==="armory"){
      if(this.round.phase!=="active"||distance(p,POS.armory)>2.1||p.role==="anomaly"||p.role==="observer") return;
      if(p.weapon){this.send(ws,{type:"notice",text:"You are already armed."});return;}
      if(this.round.armoryCharges<=0){this.send(ws,{type:"notice",text:"Armory locker is empty."});return;}
      this.round.armoryCharges--;p.weapon=true;p.ammo=12;p.reserve=24;this.savePlayer(ws,p);await this.persistRound();this.sendSelf(ws,p);
      this.broadcast({type:"event",kind:"objective",text:`${p.name} opened a security weapon locker.`});this.broadcastRound();return;
    }
    if(kind==="med"){
      if(this.round.phase!=="active"||distance(p,POS.med)>2.1||p.role==="observer") return;
      if(p.hp>=p.maxHp){this.send(ws,{type:"notice",text:"No treatment required."});return;}
      if(this.round.medCharges<=0){this.send(ws,{type:"notice",text:"Medical cabinet depleted."});return;}
      this.round.medCharges--;p.hp=Math.min(p.maxHp,p.hp+55);this.savePlayer(ws,p);await this.persistRound();this.sendSelf(ws,p);this.broadcastRound();return;
    }
    if(kind==="keycard"){
      if(this.round.phase!=="active"||this.round.keycardTaken||distance(p,POS.keycard)>1.9) return;
      this.round.keycardTaken=true;this.round.keycardHolder=p.id;p.hasKeycard=true;this.savePlayer(ws,p);await this.persistRound();
      this.sendSelf(ws,p);this.broadcast({type:"event",kind:"objective",text:`${p.name} recovered the Threshold Keycard.`});this.broadcastRound();return;
    }
    if(kind==="terminal"){
      if(this.round.phase!=="active"||distance(p,POS.terminal)>2.15) return;
      if(this.round.keycardHolder!==p.id){this.send(ws,{type:"notice",text:"Threshold Keycard required."});return;}
      this.round.phase="extraction";this.round.extractionStartedAt=Date.now();this.round.extractionEndsAt=Date.now()+60000;
      await this.persistRound();this.broadcast({type:"event",kind:"alarm",text:"THRESHOLD OPENING. Sixty seconds until instability."});this.broadcastRound();return;
    }
    if(kind==="extract"){
      if(this.round.phase!=="extraction"||distance(p,POS.gate)>2.65) return;
      p.escaped=true;if(p.role==="anomaly") this.round.anomalyEscaped=true;
      this.savePlayer(ws,p);await this.persistRound();this.sendSelf(ws,p);
      this.broadcast({type:"event",kind:p.role==="anomaly"?"danger":"objective",text:`${p.name} crossed the Threshold.`});
      await this.checkWin();this.broadcastRound();return;
    }
    if(kind==="seal"){
      if(this.round.phase!=="extraction"||distance(p,POS.seal)>2.15) return;
      if(p.role!=="quarantine"&&p.role!=="security"){this.send(ws,{type:"notice",text:"Security authorization required."});return;}
      const quarantineAlive=[...this.players.values()].some(x=>x.role==="quarantine"&&!x.dead&&!x.escaped);
      if(p.role==="security"&&quarantineAlive&&Date.now()-this.round.extractionStartedAt<30000){this.send(ws,{type:"notice",text:"Quarantine Officer retains seal authority."});return;}
      await this.endRound(this.round.anomalyEscaped?"anomaly":"humans",this.round.anomalyEscaped?"An anomalous host crossed into baseline reality.":"Threshold sealed without anomalous escape.");return;
    }
  }

  private async checkTransitions(){
    const now=Date.now();
    if(this.round.phase==="briefing"&&this.round.startsAt&&now>=this.round.startsAt){await this.startRound();}
    if(this.round.phase==="extraction"&&this.round.extractionEndsAt&&now>=this.round.extractionEndsAt){await this.endRound("anomaly","Threshold destabilized before containment could be sealed.");}
  }

  private async startRound(){
    const candidates=[...this.players.values()].filter(p=>p.role==="unassigned");
    if(candidates.length<2){this.round.phase="waiting";this.round.startsAt=0;await this.persistRound();this.broadcastRound();return;}
    shuffle(candidates);
    candidates.forEach(p=>{p.role="researcher";p.dead=false;p.escaped=false;p.hp=100;p.maxHp=100;p.ammo=0;p.reserve=0;p.weapon=false;p.hasKeycard=false;p.revealedUntil=0;});
    candidates[0].role="anomaly";candidates[0].hp=125;candidates[0].maxHp=125;
    if(candidates.length>=3){candidates[1].role="security";candidates[1].weapon=true;candidates[1].ammo=12;candidates[1].reserve=48;}
    if(candidates.length>=4){candidates[2].role="quarantine";candidates[2].weapon=true;candidates[2].ammo=12;candidates[2].reserve=30;}
    let humanIndex=0;
    for(const p of candidates){
      const angle=(humanIndex++/Math.max(1,candidates.length))*Math.PI*2;
      p.x=-14+Math.cos(angle)*1.6;p.z=-14+Math.sin(angle)*1.6;p.lastSeen=Date.now();
      const ws=this.socketFor(p.id);if(ws){this.savePlayer(ws,p);this.sendSelf(ws,p);}
    }
    this.round={...this.round,phase:"active",startsAt:0,startedAt:Date.now(),extractionStartedAt:0,extractionEndsAt:0,endedAt:0,keycardTaken:false,keycardHolder:null,anomalyEscaped:false,winner:null,reason:""};
    await this.persistRound();this.broadcast({type:"event",kind:"start",text:"Containment incident is live."});this.broadcastSnapshot();
  }

  private async applyDamage(target:Player,attacker:Player,damage:number,source:string){
    if(target.dead||target.escaped)return;
    target.hp=Math.max(0,target.hp-damage);
    const tws=this.socketFor(target.id);if(tws){this.savePlayer(tws,target);this.sendSelf(tws,target);}
    this.broadcast({type:"hit",attacker:attacker.id,target:target.id,damage,hp:target.hp,source});
    if(target.hp<=0){
      target.dead=true;
      if(this.round.keycardHolder===target.id){this.round.keycardHolder=null;this.round.keycardTaken=false;target.hasKeycard=false;}
      if(tws){this.savePlayer(tws,target);this.sendSelf(tws,target);}
      await this.persistRound();this.broadcast({type:"death",id:target.id,name:target.name,killer:attacker.id});
      await this.checkWin();
    }
  }

  private async convert(target:Player,attacker:Player){
    if(target.dead||target.escaped||target.role==="anomaly")return;
    if(this.round.keycardHolder===target.id){this.round.keycardHolder=null;this.round.keycardTaken=false;target.hasKeycard=false;}
    target.role="anomaly";target.hp=100;target.maxHp=100;target.ammo=0;target.reserve=0;target.weapon=false;target.lastAbility=Date.now();target.revealedUntil=Date.now()+3500;
    const ws=this.socketFor(target.id);if(ws){this.savePlayer(ws,target);this.sendSelf(ws,target);}
    await this.persistRound();
    this.broadcast({type:"converted",id:target.id,name:target.name,by:attacker.id});
    await this.checkWin();this.broadcastSnapshot();
  }

  private rayTarget(shooter:Player,origin:Vec2,dir:Vec2){
    let best:Player|null=null,bestT=Infinity;
    for(const p of this.players.values()){
      if(p.id===shooter.id||p.dead||p.escaped||p.role==="observer")continue;
      const rx=p.x-origin.x,rz=p.z-origin.z;const t=rx*dir.x+rz*dir.z;if(t<0||t>38)continue;
      const px=origin.x+dir.x*t,pz=origin.z+dir.z*t;const perp=Math.hypot(p.x-px,p.z-pz);
      if(perp<.72&&t<bestT){best=p;bestT=t;}
    }
    return best;
  }

  private nearestHuman(from:Player,range:number){
    let best:Player|null=null,bestD=range;
    for(const p of this.players.values()){
      if(p.id===from.id||p.dead||p.escaped||p.role==="anomaly"||p.role==="observer")continue;
      const d=Math.hypot(p.x-from.x,p.z-from.z);if(d<bestD){best=p;bestD=d;}
    }return best;
  }

  private async checkWin(){
    if(!(this.round.phase==="active"||this.round.phase==="extraction"))return;
    const livingHumans=[...this.players.values()].filter(p=>p.role!=="anomaly"&&p.role!=="observer"&&!p.dead&&!p.escaped);
    const livingAnomalies=[...this.players.values()].filter(p=>p.role==="anomaly"&&!p.dead&&!p.escaped);
    const escapedHumans=[...this.players.values()].filter(p=>p.role!=="anomaly"&&p.role!=="observer"&&p.escaped);
    if(livingAnomalies.length===0&&!this.round.anomalyEscaped){await this.endRound("humans","All anomalous hosts were neutralized.");return;}
    if(livingHumans.length===0&&escapedHumans.length===0){await this.endRound("anomaly","No uninfected personnel remain in the incident zone.");}
  }

  private async endRound(winner:"humans"|"anomaly",reason:string){
    if(this.round.phase==="ended")return;
    this.round.phase="ended";this.round.winner=winner;this.round.reason=reason;this.round.endedAt=Date.now();await this.persistRound();
    this.broadcast({type:"roundEnd",winner,reason});this.broadcastRound();
  }

  private activeLobbyCount(){return [...this.players.values()].filter(p=>p.role==="unassigned").length;}
  private publicPlayer(p:Player){return {id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw,pitch:p.pitch,hp:p.hp,dead:p.dead,escaped:p.escaped,revealed:Date.now()<p.revealedUntil};}
  private publicPlayers(){return [...this.players.values()].map(p=>this.publicPlayer(p));}
  private selfView(p:Player){return {id:p.id,name:p.name,role:p.role,hp:p.hp,maxHp:p.maxHp,ammo:p.ammo,reserve:p.reserve,weapon:p.weapon,hasKeycard:p.hasKeycard,dead:p.dead,escaped:p.escaped,x:p.x,z:p.z,abilityReadyAt:p.lastAbility+6500};}
  private publicRound(){return {...this.round,keycardHolder:this.round.keycardHolder?"held":null};}
  private socketFor(id:string){for(const ws of this.ctx.getWebSockets()){const p=ws.deserializeAttachment() as Player|null;if(p?.id===id)return ws;}return null;}
  private savePlayer(ws:WebSocket,p:Player){this.players.set(p.id,p);ws.serializeAttachment(p);}
  private send(ws:WebSocket,obj:unknown){try{ws.send(JSON.stringify(obj));}catch{}}
  private sendSelf(ws:WebSocket,p:Player){this.send(ws,{type:"self",self:this.selfView(p)});}
  private broadcast(obj:unknown,except?:WebSocket){const data=JSON.stringify(obj);for(const ws of this.ctx.getWebSockets()){if(ws===except)continue;try{ws.send(data);}catch{}}}
  private broadcastRound(){this.broadcast({type:"round",round:this.publicRound()});}
  private broadcastSnapshot(){for(const ws of this.ctx.getWebSockets()){const p=ws.deserializeAttachment() as Player|null;if(p)this.send(ws,{type:"snapshot",players:this.publicPlayers(),self:this.selfView(p),round:this.publicRound()});}}
  private async persistRound(){await this.ctx.storage.put("round",this.round);}
}

function blankRound(seed:string):RoundState{return {phase:"waiting",seed,createdAt:Date.now(),startsAt:0,startedAt:0,extractionStartedAt:0,extractionEndsAt:0,endedAt:0,keycardTaken:false,keycardHolder:null,anomalyEscaped:false,winner:null,reason:"",roundNumber:1,armoryCharges:2,medCharges:2};}
function cleanName(v:string){return v.replace(/[^a-zA-Z0-9_\- ]/g,"").trim().slice(0,18)||"wanderer";}
function finite(v:any,fallback:number,min:number,max:number){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function distance(p:Player,v:Vec2){return Math.hypot(p.x-v.x,p.z-v.z);}
function shuffle<T>(a:T[]){for(let i=a.length-1;i>0;i--){const r=new Uint32Array(1);crypto.getRandomValues(r);const j=r[0]%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function json(v:unknown){return new Response(JSON.stringify(v),{headers:{"content-type":"application/json;charset=utf-8","access-control-allow-origin":"*"}});}
