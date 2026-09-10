import { DurableObject } from "cloudflare:workers";

type Env={GAME_ROOM:DurableObjectNamespace<GameRoom>};
type Role="unassigned"|"researcher"|"security"|"quarantine"|"anomaly"|"observer";
type Phase="lobby"|"briefing"|"active"|"extraction"|"ended";

type Player={
  id:string;name:string;ready:boolean;joinedAt:number;
  x:number;z:number;yaw:number;pitch:number;
  hp:number;maxHp:number;role:Role;dead:boolean;escaped:boolean;
  ammo:number;reserve:number;weapon:boolean;hasKeycard:boolean;
  lastSeen:number;lastShot:number;lastAbility:number;revealedUntil:number;
};

type RoundState={
  phase:Phase;seed:string;hostId:string|null;map:string;createdAt:number;startsAt:number;startedAt:number;
  extractionStartedAt:number;extractionEndsAt:number;endedAt:number;
  keycardTaken:boolean;keycardHolder:string|null;anomalyEscaped:boolean;
  winner:"humans"|"anomaly"|null;reason:string;roundNumber:number;armoryCharges:number;medCharges:number;
  supplyTaken:Record<string,boolean>;
};

type Vec2={x:number;z:number};
const POS={
  keycard:{x:-16,z:14},terminal:{x:14,z:13},gate:{x:17,z:-14},seal:{x:12.5,z:-14},armory:{x:-17,z:-4},med:{x:4,z:-17},
  supplyA:{x:-6,z:14},supplyB:{x:6,z:-10},supplyC:{x:-2,z:2}
} satisfies Record<string,Vec2>;
const MAX_PLAYERS=12;

export default{
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==="/health")return json({ok:true,service:"nullspace",version:5});
    const match=url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,16})$/);
    if(!match)return json({service:"NULLSPACE // Site-Null",status:"online",version:5,hint:"WebSocket /room/{code}"});
    if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("Expected WebSocket",{status:426});
    const code=match[1].toUpperCase(),id=env.GAME_ROOM.idFromName(code);
    return env.GAME_ROOM.get(id).fetch(request)
  }
};

export class GameRoom extends DurableObject<Env>{
  private players=new Map<string,Player>();
  private round:RoundState=blankRound("");

  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      const saved=await ctx.storage.get<RoundState>("round");
      if(saved)this.round={...blankRound(saved.seed||""),...saved,supplyTaken:{a:false,b:false,c:false,...(saved.supplyTaken||{})}};
      for(const ws of ctx.getWebSockets()){
        const p=ws.deserializeAttachment() as Player|null;
        if(p?.id)this.players.set(p.id,p)
      }
      if(this.round.hostId&&!this.players.has(this.round.hostId))this.round.hostId=this.oldestPlayer()?.id||null
    })
  }

  async fetch(request:Request):Promise<Response>{
    await this.checkTransitions();
    const url=new URL(request.url),code=(url.pathname.split("/").pop()||"NULL").toUpperCase();
    if(!this.round.seed){this.round=blankRound(code);await this.persistRound()}
    if(this.ctx.getWebSockets().length>=MAX_PLAYERS)return new Response("Incident is full",{status:409});

    const name=cleanName(url.searchParams.get("name")||"wanderer");
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    const id=crypto.randomUUID().slice(0,8),midRound=this.round.phase!=="lobby";
    const p:Player={
      id,name,ready:false,joinedAt:Date.now(),x:-14,z:-14,yaw:0,pitch:0,hp:100,maxHp:100,
      role:midRound?"observer":"unassigned",dead:midRound,escaped:false,ammo:0,reserve:0,weapon:false,hasKeycard:false,
      lastSeen:Date.now(),lastShot:0,lastAbility:0,revealedUntil:0
    };
    this.ctx.acceptWebSocket(server);server.serializeAttachment(p);this.players.set(id,p);
    if(!this.round.hostId){this.round.hostId=id;await this.persistRound()}

    server.send(JSON.stringify({type:"welcome",id,room:code,players:this.publicPlayers(),self:this.selfView(p),round:this.publicRound()}));
    this.broadcast({type:"event",kind:"join",name,text:`${name} entered the lobby.`},server);
    this.broadcastSnapshot();
    return new Response(null,{status:101,webSocket:client})
  }

  async alarm(){await this.checkTransitions()}

  async webSocketMessage(ws:WebSocket,data:string|ArrayBuffer){
    if(typeof data!=="string"||data.length>32768)return;
    let msg:any;try{msg=JSON.parse(data)}catch{return}
    const p=ws.deserializeAttachment() as Player|null;if(!p)return;
    await this.checkTransitions();

    if(msg.type==="ready"){
      if(this.round.phase!=="lobby"||p.role==="observer")return;
      p.ready=!!msg.ready;this.savePlayer(ws,p);this.broadcastSnapshot();return
    }

    if(msg.type==="start"){
      if(this.round.phase!=="lobby"||p.id!==this.round.hostId)return;
      const candidates=[...this.players.values()].filter(x=>x.role!=="observer");
      if(candidates.length<2){this.send(ws,{type:"notice",text:"At least 2 operatives are required."});return}
      if(!candidates.every(x=>x.ready)){this.send(ws,{type:"notice",text:"Every operative must be ready."});return}
      await this.beginBriefing();return
    }

    if(msg.type==="returnLobby"){
      if(this.round.phase!=="ended"||p.id!==this.round.hostId)return;
      await this.resetLobby();return
    }

    if(msg.type==="voiceSignal"){
      if(typeof msg.target!=="string"||!msg.payload)return;
      const target=this.socketFor(msg.target);
      if(target)this.send(target,{type:"voiceSignal",from:p.id,payload:msg.payload});
      return
    }

    if(msg.type==="state"){
      if(!this.gameplayLive()||p.dead||p.escaped)return;
      const now=Date.now(),dt=Math.max(.05,Math.min(1.5,(now-p.lastSeen)/1000));
      const nx=finite(msg.x,p.x,-19.7,19.7),nz=finite(msg.z,p.z,-19.7,19.7);
      const dist=Math.hypot(nx-p.x,nz-p.z),maxDist=8.0*dt+.35;
      if(dist<=maxDist){p.x=nx;p.z=nz}
      p.yaw=finite(msg.yaw,p.yaw,-20,20);p.pitch=finite(msg.pitch,p.pitch,-1.55,1.55);p.lastSeen=now;
      this.savePlayer(ws,p);this.broadcast({type:"playerState",player:this.publicPlayer(p)},ws);return
    }

    if(msg.type==="shoot"){
      if(!this.gameplayLive()||p.dead||p.escaped||p.ammo<=0||!p.weapon)return;
      const now=Date.now();if(now-p.lastShot<145)return;
      p.lastShot=now;p.ammo--;this.savePlayer(ws,p);this.sendSelf(ws,p);
      const ox=finite(msg.origin?.x,p.x,-21,21),oz=finite(msg.origin?.z,p.z,-21,21);
      let dx=finite(msg.direction?.x,0,-1,1),dz=finite(msg.direction?.z,-1,-1,1);const len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
      this.broadcast({type:"shot",id:p.id,name:p.name,x:ox,z:oz,dx,dz});
      const target=this.rayTarget(p,{x:ox,z:oz},{x:dx,z:dz});
      if(target)await this.applyDamage(target,p,target.role==="anomaly"?26:34,"gunfire");
      return
    }

    if(msg.type==="reload"){
      if(!this.gameplayLive()||p.dead||p.escaped||p.ammo>=12||p.reserve<=0)return;
      const take=Math.min(12-p.ammo,p.reserve);p.ammo+=take;p.reserve-=take;this.savePlayer(ws,p);this.sendSelf(ws,p);
      this.broadcast({type:"reload",id:p.id},ws);return
    }

    if(msg.type==="ability"){
      if(!this.gameplayLive()||p.role!=="anomaly"||p.dead||p.escaped)return;
      const now=Date.now();if(now-p.lastAbility<6500){this.send(ws,{type:"notice",text:"Assimilation response not ready."});return}
      const target=this.nearestHuman(p,2.15);if(!target){this.send(ws,{type:"notice",text:"No viable host in reach."});return}
      p.lastAbility=now;p.revealedUntil=now+2800;this.savePlayer(ws,p);this.broadcast({type:"reveal",id:p.id,until:p.revealedUntil});
      if(target.hp<=45)await this.convert(target,p);else await this.applyDamage(target,p,45,"anomaly");
      return
    }

    if(msg.type==="interact"&&typeof msg.kind==="string"){await this.interact(ws,p,msg.kind);return}
  }

  async webSocketClose(ws:WebSocket){
    const p=ws.deserializeAttachment() as Player|null;if(!p)return;
    this.players.delete(p.id);
    if(this.round.keycardHolder===p.id){this.round.keycardHolder=null;this.round.keycardTaken=false;await this.persistRound()}
    if(this.round.hostId===p.id){
      this.round.hostId=this.oldestPlayer()?.id||null;await this.persistRound();
      const nh=this.round.hostId?this.players.get(this.round.hostId):null;
      if(nh)this.broadcast({type:"event",kind:"host",text:`${nh.name} is now lobby leader.`})
    }
    this.broadcast({type:"event",kind:"leave",name:p.name,text:`${p.name} left the incident.`});
    if(this.gameplayLive())await this.checkWin();
    this.broadcastSnapshot()
  }
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws)}

  private gameplayLive(){return this.round.phase==="active"||this.round.phase==="extraction"}

  private async beginBriefing(){
    const candidates=[...this.players.values()].filter(p=>p.role!=="observer");
    shuffle(candidates);
    for(const p of candidates){
      p.role="researcher";p.dead=false;p.escaped=false;p.hp=100;p.maxHp=100;p.ammo=0;p.reserve=0;p.weapon=false;p.hasKeycard=false;p.revealedUntil=0;p.ready=false
    }
    candidates[0].role="anomaly";candidates[0].hp=125;candidates[0].maxHp=125;
    if(candidates.length>=3){candidates[1].role="security";candidates[1].weapon=true;candidates[1].ammo=12;candidates[1].reserve=48}
    if(candidates.length>=4){candidates[2].role="quarantine";candidates[2].weapon=true;candidates[2].ammo=12;candidates[2].reserve=30}

    let i=0;
    for(const p of candidates){
      const angle=(i++/Math.max(1,candidates.length))*Math.PI*2;
      if(p.role==="anomaly"){p.x=14;p.z=14}else{p.x=-14+Math.cos(angle)*1.5;p.z=-14+Math.sin(angle)*1.5}
      p.lastSeen=Date.now();const s=this.socketFor(p.id);if(s){this.savePlayer(s,p);this.sendSelf(s,p)}
    }

    this.round.phase="briefing";this.round.startsAt=Date.now()+4500;this.round.startedAt=0;this.round.winner=null;this.round.reason="";
    this.round.keycardTaken=false;this.round.keycardHolder=null;this.round.anomalyEscaped=false;this.round.armoryCharges=3;this.round.medCharges=4;this.round.supplyTaken={a:false,b:false,c:false};
    await this.persistRound();await this.ctx.storage.setAlarm(this.round.startsAt);
    this.broadcast({type:"event",kind:"countdown",text:"Assignments issued. Deployment in 4 seconds."});this.broadcastSnapshot()
  }

  private async startActive(){
    this.round.phase="active";this.round.startsAt=0;this.round.startedAt=Date.now();
    await this.persistRound();this.broadcast({type:"event",kind:"start",text:"Incident live. Trust protocol suspended."});this.broadcastSnapshot()
  }

  private async resetLobby(){
    for(const p of this.players.values()){
      p.ready=false;p.role="unassigned";p.dead=false;p.escaped=false;p.hp=100;p.maxHp=100;p.ammo=0;p.reserve=0;p.weapon=false;p.hasKeycard=false;p.x=-14;p.z=-14;p.lastSeen=Date.now();
      const ws=this.socketFor(p.id);if(ws)this.savePlayer(ws,p)
    }
    const code=this.round.seed||"NULL",hostId=this.round.hostId||this.oldestPlayer()?.id||null,next=this.round.roundNumber+1;
    this.round=blankRound(code);this.round.hostId=hostId;this.round.roundNumber=next;
    await this.persistRound();this.broadcast({type:"event",kind:"lobby",text:"Incident reset. Ready up for redeployment."});this.broadcastSnapshot()
  }

  private async interact(ws:WebSocket,p:Player,kind:string){
    if(!this.gameplayLive()||p.dead||p.escaped)return;

    if(kind==="supplyA"||kind==="supplyB"||kind==="supplyC"){
      const id=kind.slice(-1).toLowerCase(),pos=POS[kind as keyof typeof POS];
      if(!pos||distance(p,pos)>1.95)return;
      if(this.round.supplyTaken[id]){this.send(ws,{type:"notice",text:"Supply cache is empty."});return}
      if(kind==="supplyB"&&p.hp>=p.maxHp){this.send(ws,{type:"notice",text:"Medical supplies are not needed right now."});return}
      this.round.supplyTaken[id]=true;
      if(kind==="supplyA"){
        if(!p.weapon){p.weapon=true;p.ammo=8;p.reserve=Math.max(p.reserve,12)}else p.reserve=Math.min(96,p.reserve+24)
      }else if(kind==="supplyB"){
        p.hp=Math.min(p.maxHp,p.hp+45)
      }else{
        p.reserve=Math.min(96,p.reserve+30)
      }
      this.savePlayer(ws,p);await this.persistRound();this.sendSelf(ws,p);
      this.broadcast({type:"event",kind:"objective",text:`${p.name} searched a field supply cache.`});this.broadcastSnapshot();return
    }

    if(kind==="armory"){
      if(this.round.phase!=="active"||distance(p,POS.armory)>2.1||p.role==="anomaly"||p.role==="observer")return;
      if(p.weapon){this.send(ws,{type:"notice",text:"You are already armed."});return}
      if(this.round.armoryCharges<=0){this.send(ws,{type:"notice",text:"Armory locker is empty."});return}
      this.round.armoryCharges--;p.weapon=true;p.ammo=12;p.reserve=24;this.savePlayer(ws,p);await this.persistRound();this.sendSelf(ws,p);
      this.broadcast({type:"event",kind:"objective",text:`${p.name} opened a security locker.`});this.broadcastSnapshot();return
    }
    if(kind==="med"){
      if(this.round.phase!=="active"||distance(p,POS.med)>2.1||p.role==="observer")return;
      if(p.hp>=p.maxHp){this.send(ws,{type:"notice",text:"No treatment required."});return}
      if(this.round.medCharges<=0){this.send(ws,{type:"notice",text:"Medical cabinet depleted."});return}
      this.round.medCharges--;p.hp=Math.min(p.maxHp,p.hp+55);this.savePlayer(ws,p);await this.persistRound();this.sendSelf(ws,p);this.broadcastSnapshot();return
    }
    if(kind==="keycard"){
      if(this.round.phase!=="active"||this.round.keycardTaken||distance(p,POS.keycard)>1.9)return;
      this.round.keycardTaken=true;this.round.keycardHolder=p.id;p.hasKeycard=true;this.savePlayer(ws,p);await this.persistRound();this.sendSelf(ws,p);
      this.broadcast({type:"event",kind:"objective",text:`${p.name} recovered the Threshold Keycard.`});this.broadcastSnapshot();return
    }
    if(kind==="terminal"){
      if(this.round.phase!=="active"||distance(p,POS.terminal)>2.15)return;
      if(this.round.keycardHolder!==p.id){this.send(ws,{type:"notice",text:"Threshold Keycard required."});return}
      this.round.phase="extraction";this.round.extractionStartedAt=Date.now();this.round.extractionEndsAt=Date.now()+60000;
      await this.persistRound();await this.ctx.storage.setAlarm(this.round.extractionEndsAt);
      this.broadcast({type:"event",kind:"alarm",text:"THRESHOLD OPEN. Sixty seconds until instability."});this.broadcastSnapshot();return
    }
    if(kind==="extract"){
      if(this.round.phase!=="extraction"||distance(p,POS.gate)>2.65)return;
      p.escaped=true;if(p.role==="anomaly")this.round.anomalyEscaped=true;this.savePlayer(ws,p);this.sendSelf(ws,p);await this.persistRound();
      this.broadcast({type:"event",kind:p.role==="anomaly"?"danger":"objective",text:`${p.name} crossed the Threshold.`});await this.checkWin();this.broadcastSnapshot();return
    }
    if(kind==="seal"){
      if(this.round.phase!=="extraction"||distance(p,POS.seal)>2.15)return;
      if(p.role!=="quarantine"&&p.role!=="security"){this.send(ws,{type:"notice",text:"Security authorization required."});return}
      const quarantineAlive=[...this.players.values()].some(x=>x.role==="quarantine"&&!x.dead&&!x.escaped);
      if(p.role==="security"&&quarantineAlive&&Date.now()-this.round.extractionStartedAt<30000){this.send(ws,{type:"notice",text:"Quarantine Officer retains seal authority."});return}
      await this.endRound(this.round.anomalyEscaped?"anomaly":"humans",this.round.anomalyEscaped?"An anomalous host crossed into baseline reality.":"Threshold sealed without anomalous escape.");return
    }
  }

  private async checkTransitions(){
    const now=Date.now();
    if(this.round.phase==="briefing"&&this.round.startsAt&&now>=this.round.startsAt)await this.startActive();
    if(this.round.phase==="extraction"&&this.round.extractionEndsAt&&now>=this.round.extractionEndsAt)await this.endRound("anomaly","Threshold destabilized before containment could be sealed.")
  }

  private async applyDamage(target:Player,attacker:Player,damage:number,source:string){
    if(target.dead||target.escaped)return;
    target.hp=Math.max(0,target.hp-damage);const tws=this.socketFor(target.id);if(tws){this.savePlayer(tws,target);this.sendSelf(tws,target)}
    this.broadcast({type:"hit",attacker:attacker.id,target:target.id,damage,hp:target.hp,source});
    if(target.hp<=0){
      target.dead=true;
      if(this.round.keycardHolder===target.id){this.round.keycardHolder=null;this.round.keycardTaken=false;target.hasKeycard=false}
      if(tws){this.savePlayer(tws,target);this.sendSelf(tws,target)}
      await this.persistRound();this.broadcast({type:"death",id:target.id,name:target.name,killer:attacker.id});await this.checkWin()
    }
  }

  private async convert(target:Player,attacker:Player){
    if(target.dead||target.escaped||target.role==="anomaly")return;
    if(this.round.keycardHolder===target.id){this.round.keycardHolder=null;this.round.keycardTaken=false;target.hasKeycard=false}
    target.role="anomaly";target.hp=100;target.maxHp=100;target.weapon=false;target.ammo=0;target.reserve=0;
    const tws=this.socketFor(target.id);if(tws){this.savePlayer(tws,target);this.sendSelf(tws,target)}
    await this.persistRound();this.broadcast({type:"converted",id:target.id,name:target.name,by:attacker.id});await this.checkWin()
  }

  private async checkWin(){
    if(!this.gameplayLive())return;
    const active=[...this.players.values()].filter(p=>p.role!=="observer"&&!p.escaped);
    const humans=active.filter(p=>p.role!=="anomaly"&&!p.dead),anomalies=active.filter(p=>p.role==="anomaly"&&!p.dead);
    if(this.round.anomalyEscaped){await this.endRound("anomaly","A Mimic crossed the Threshold.");return}
    if(anomalies.length===0){await this.endRound("humans","All detected anomalous hosts were neutralized.");return}
    if(humans.length===0){await this.endRound("anomaly","No baseline human personnel remain.");return}
  }

  private async endRound(winner:"humans"|"anomaly",reason:string){
    if(this.round.phase==="ended")return;
    this.round.phase="ended";this.round.winner=winner;this.round.reason=reason;this.round.endedAt=Date.now();
    await this.persistRound();this.broadcast({type:"event",kind:winner==="humans"?"objective":"danger",text:reason});this.broadcastSnapshot()
  }

  private rayTarget(shooter:Player,o:Vec2,d:Vec2){
    let best:Player|null=null,bestT=999;
    for(const t of this.players.values()){
      if(t.id===shooter.id||t.dead||t.escaped||t.role==="observer")continue;
      const vx=t.x-o.x,vz=t.z-o.z,proj=vx*d.x+vz*d.z;if(proj<0||proj>24)continue;
      const side=Math.abs(vx*d.z-vz*d.x);if(side>.62)continue;
      if(proj<bestT){bestT=proj;best=t}
    }
    return best
  }
  private nearestHuman(p:Player,range:number){
    let best:Player|null=null,bestD=range;
    for(const t of this.players.values()){
      if(t.id===p.id||t.dead||t.escaped||t.role==="observer"||t.role==="anomaly")continue;
      const d=Math.hypot(t.x-p.x,t.z-p.z);if(d<bestD){bestD=d;best=t}
    }
    return best
  }

  private oldestPlayer(){return[...this.players.values()].sort((a,b)=>a.joinedAt-b.joinedAt)[0]||null}
  private socketFor(id:string){for(const ws of this.ctx.getWebSockets()){const p=ws.deserializeAttachment() as Player|null;if(p?.id===id)return ws}return null}
  private savePlayer(ws:WebSocket,p:Player){this.players.set(p.id,p);ws.serializeAttachment(p)}
  private send(ws:WebSocket,msg:unknown){try{ws.send(JSON.stringify(msg))}catch{}}
  private sendSelf(ws:WebSocket,p:Player){this.send(ws,{type:"self",self:this.selfView(p)})}
  private broadcast(msg:unknown,except?:WebSocket){const encoded=JSON.stringify(msg);for(const ws of this.ctx.getWebSockets()){if(ws===except)continue;try{ws.send(encoded)}catch{}}}
  private publicPlayer(p:Player){return{id:p.id,name:p.name,ready:p.ready,joinedAt:p.joinedAt,x:p.x,z:p.z,yaw:p.yaw,pitch:p.pitch,hp:p.hp,maxHp:p.maxHp,dead:p.dead,escaped:p.escaped,revealed:p.revealedUntil>Date.now()}}
  private publicPlayers(){return[...this.players.values()].map(p=>this.publicPlayer(p))}
  private selfView(p:Player){return{...this.publicPlayer(p),role:p.role,ammo:p.ammo,reserve:p.reserve,weapon:p.weapon,hasKeycard:p.hasKeycard}}
  private publicRound(){return{phase:this.round.phase,seed:this.round.seed,hostId:this.round.hostId,map:this.round.map,startsAt:this.round.startsAt,startedAt:this.round.startedAt,extractionStartedAt:this.round.extractionStartedAt,extractionEndsAt:this.round.extractionEndsAt,keycardTaken:this.round.keycardTaken,keycardHolder:this.round.keycardHolder,winner:this.round.winner,reason:this.round.reason,roundNumber:this.round.roundNumber,armoryCharges:this.round.armoryCharges,medCharges:this.round.medCharges,supplyTaken:this.round.supplyTaken}}
  private broadcastSnapshot(){
    const players=this.publicPlayers(),round=this.publicRound();
    for(const ws of this.ctx.getWebSockets()){
      const p=ws.deserializeAttachment() as Player|null;if(!p)continue;this.send(ws,{type:"snapshot",players,round,self:this.selfView(p)})
    }
  }
  private async persistRound(){await this.ctx.storage.put("round",this.round)}
}

function blankRound(seed:string):RoundState{
  return{phase:"lobby",seed,hostId:null,map:"level0",createdAt:Date.now(),startsAt:0,startedAt:0,extractionStartedAt:0,extractionEndsAt:0,endedAt:0,keycardTaken:false,keycardHolder:null,anomalyEscaped:false,winner:null,reason:"",roundNumber:1,armoryCharges:3,medCharges:4,supplyTaken:{a:false,b:false,c:false}}
}
function cleanName(v:string){return v.replace(/[^a-zA-Z0-9_\- ]/g,"").trim().slice(0,18)||"wanderer"}
function finite(v:any,fallback:number,min:number,max:number){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
function distance(p:Player,v:Vec2){return Math.hypot(p.x-v.x,p.z-v.z)}
function shuffle<T>(a:T[]){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}}
function json(value:unknown){return new Response(JSON.stringify(value),{headers:{"content-type":"application/json;charset=UTF-8","access-control-allow-origin":"*"}})}