export class NetClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null;
    this.players = new Map();
    this.self = null;
    this.round = null;
    this.onPlayers = () => {};
    this.onSelf = () => {};
    this.onRound = () => {};
    this.onEvent = () => {};
    this.onOpen = () => {};
    this.onClose = () => {};
  }

  connect(baseUrl, room, name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = new URL(baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/room/" + encodeURIComponent(room);
      url.searchParams.set("name", name);

      const ws = new WebSocket(url);
      this.ws = ws;
      this.room = room;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error("Connection timed out"));
        }
      }, 8000);

      ws.addEventListener("open", () => this.onOpen());
      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        }
      });
      ws.addEventListener("close", () => this.onClose());
      ws.addEventListener("message", (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === "welcome") {
          this.id = msg.id;
          this.self = msg.self || null;
          this.round = msg.round || null;
          this.players = new Map((msg.players || []).map((p) => [p.id, p]));
          this.onSelf(this.self);
          this.onRound(this.round);
          this.onPlayers(this.players);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(msg);
          }
          return;
        }

        if (msg.type === "snapshot") {
          const incoming = msg.players || [];
          for (const p of incoming) this.players.set(p.id, p);
          for (const id of [...this.players.keys()]) {
            if (!incoming.some((p) => p.id === id)) this.players.delete(id);
          }
          if (msg.self) {
            this.self = msg.self;
            this.onSelf(this.self);
          }
          if (msg.round) {
            this.round = msg.round;
            this.onRound(this.round);
          }
          this.onPlayers(this.players);
          return;
        }

        if (msg.type === "self") {
          this.self = { ...(this.self || {}), ...msg.self };
          this.onSelf(this.self);
          return;
        }

        if (msg.type === "round") {
          this.round = msg.round;
          this.onRound(this.round);
          return;
        }

        this.onEvent(msg);
      });
    });
  }

  send(type, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  sendState(state) { this.send("state", state); }
  shoot(origin, direction) { this.send("shoot", { origin, direction }); }
  reload() { this.send("reload"); }
  interact(kind) { this.send("interact", { kind }); }
  ability() { this.send("ability"); }
  disconnect() {
    try { this.ws?.close(1000, "leaving"); } catch {}
  }
}
