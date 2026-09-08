import { DurableObject } from "cloudflare:workers";

type Env = { GAME_ROOM: DurableObjectNamespace<GameRoom> };
type Player = { id:string; name:string; x:number; z:number; yaw:number; pitch:number; hp:number; lastSeen:number };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,16})$/);
    if (!match) return new Response("NULLSPACE multiplayer worker", { status: 200 });

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const roomCode = match[1].toUpperCase();
    const id = env.GAME_ROOM.idFromName(roomCode);
    const stub = env.GAME_ROOM.get(id);
    return stub.fetch(request);
  }
};

export class GameRoom extends DurableObject<Env> {
  private players = new Map<string, Player>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const ws of this.ctx.getWebSockets()) {
      const p = ws.deserializeAttachment() as Player | null;
      if (p?.id) this.players.set(p.id, p);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = cleanName(url.searchParams.get("name") || "wanderer");

    if (this.ctx.getWebSockets().length >= 12) {
      return new Response("Room full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID().slice(0, 8);
    const player: Player = { id, name, x:0, z:4, yaw:0, pitch:0, hp:100, lastSeen:Date.now() };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(player);
    this.players.set(id, player);

    server.send(JSON.stringify({ type:"welcome", id, players:[...this.players.values()] }));
    this.broadcast({ type:"join", id, name }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string") return;
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }

    const player = ws.deserializeAttachment() as Player | null;
    if (!player) return;

    if (msg.type === "state") {
      player.x = finite(msg.x, player.x, -1000, 1000);
      player.z = finite(msg.z, player.z, -1000, 1000);
      player.yaw = finite(msg.yaw, player.yaw, -50, 50);
      player.pitch = finite(msg.pitch, player.pitch, -2, 2);
      player.hp = finite(msg.hp, player.hp, 0, 100);
      player.lastSeen = Date.now();
      this.players.set(player.id, player);
      ws.serializeAttachment(player);
      this.broadcast({ type:"snapshot", players:[...this.players.values()] });
      return;
    }

    if (msg.type === "shoot") {
      this.broadcast({
        type:"shot", id:player.id, name:player.name,
        x:finite(msg.x,0,-1000,1000), y:finite(msg.y,1.6,-100,100), z:finite(msg.z,0,-1000,1000),
        dx:finite(msg.dx,0,-1,1), dy:finite(msg.dy,0,-1,1), dz:finite(msg.dz,-1,-1,1)
      });
      return;
    }

    if (msg.type === "claimHit" && typeof msg.target === "string") {
      const target = this.players.get(msg.target);
      if (!target || target.hp <= 0) return;
      const damage = Math.round(finite(msg.damage, 25, 1, 35));
      target.hp = Math.max(0, target.hp - damage);
      this.players.set(target.id, target);
      this.broadcast({ type:"hit", attacker:player.id, target:target.id, damage, hp:target.hp });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const p = ws.deserializeAttachment() as Player | null;
    if (p) {
      this.players.delete(p.id);
      this.broadcast({ type:"leave", id:p.id, name:p.name });
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  private broadcast(message: unknown, except?: WebSocket) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try { socket.send(encoded); } catch {}
    }
  }
}

function cleanName(v:string) {
  return v.replace(/[^a-zA-Z0-9_\- ]/g,"").trim().slice(0,18) || "wanderer";
}
function finite(v:any, fallback:number, min:number, max:number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
