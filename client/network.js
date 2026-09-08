export class NetClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null;
    this.players = new Map();
    this.onPlayers = () => {};
    this.onEvent = () => {};
    this.onOpen = () => {};
    this.onClose = () => {};
  }

  connect(baseUrl, room, name) {
    return new Promise((resolve, reject) => {
      const url = new URL(baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/room/" + encodeURIComponent(room);
      url.searchParams.set("name", name);

      const ws = new WebSocket(url);
      this.ws = ws;
      this.room = room;

      ws.addEventListener("open", () => {
        this.onOpen();
        resolve();
      });
      ws.addEventListener("error", reject);
      ws.addEventListener("close", () => this.onClose());
      ws.addEventListener("message", (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === "welcome") {
          this.id = msg.id;
          this.players = new Map(msg.players.map(p => [p.id, p]));
          this.onPlayers(this.players);
        } else if (msg.type === "snapshot") {
          for (const p of msg.players) this.players.set(p.id, p);
          for (const id of [...this.players.keys()]) {
            if (!msg.players.some(p => p.id === id)) this.players.delete(id);
          }
          this.onPlayers(this.players);
        } else {
          this.onEvent(msg);
        }
      });
    });
  }

  send(type, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  sendState(state) { this.send("state", state); }
  shoot(data) { this.send("shoot", data); }
}
