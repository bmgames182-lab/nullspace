export class VoiceSystem {
  constructor(net, getLocalPosition, getPlayers, getVolume, getPushToTalk) {
    this.net = net;
    this.getLocalPosition = getLocalPosition;
    this.getPlayers = getPlayers;
    this.getVolume = getVolume;
    this.getPushToTalk = getPushToTalk;
    this.stream = null;
    this.peers = new Map();
    this.audios = new Map();
    this.pendingCandidates = new Map();
    this.reconnectTimers = new Map();
    this.enabled = false;
    this.talking = false;
    this.lastVolumeUpdate = 0;
  }

  async enable() {
    if (this.enabled) return true;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    this.enabled = true;
    this.applyMicState();
    this.syncPeers();
    for (const [id] of this.getPlayers()) if (id !== this.net.id) this.net.voiceSignal(id, { hello: true });
    return true;
  }

  disable() {
    this.enabled = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.pendingCandidates.clear();
    for (const audio of this.audios.values()) audio.remove();
    this.audios.clear();
  }

  setTalking(talking) {
    this.talking = talking;
    this.applyMicState();
  }

  applyMicState() {
    const shouldSend = !this.getPushToTalk() || this.talking;
    this.stream?.getAudioTracks().forEach((t) => t.enabled = shouldSend);
  }

  syncPeers() {
    if (!this.enabled || !this.net.id) return;
    const players = this.getPlayers();
    for (const [id] of players) {
      if (id === this.net.id) continue;
      if (!this.peers.has(id)) this.createPeer(id, this.net.id < id);
    }
    for (const id of [...this.peers.keys()]) if (!players.has(id)) this.dropPeer(id);
  }

  createPeer(id, initiator) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" }
      ],
      iceCandidatePoolSize: 4,
      bundlePolicy: "max-bundle"
    });
    this.peers.set(id, pc);
    this.pendingCandidates.set(id, []);
    this.stream?.getTracks().forEach((track) => pc.addTrack(track, this.stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.voiceSignal(id, { candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      let audio = this.audios.get(id);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.dataset.peer = id;
        document.body.appendChild(audio);
        this.audios.set(id, audio);
      }
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearTimeout(this.reconnectTimers.get(id));
        this.reconnectTimers.delete(id);
      } else if (pc.connectionState === "disconnected") {
        if (!this.reconnectTimers.has(id)) {
          this.reconnectTimers.set(id, setTimeout(() => {
            this.reconnectTimers.delete(id);
            if (!this.enabled || pc.connectionState === "connected") return;
            this.dropPeer(id);
            const retry = this.createPeer(id, this.net.id < id);
            if (this.net.id < id) this.makeOffer(id, retry);
            else this.net.voiceSignal(id, { hello: true });
          }, 3500));
        }
      } else if (["failed", "closed"].includes(pc.connectionState)) {
        this.dropPeer(id);
      }
    };

    if (initiator) setTimeout(() => this.makeOffer(id, pc), 250);
    return pc;
  }

  async makeOffer(id, pc) {
    try {
      if (!this.enabled || pc.signalingState !== "stable") return;
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      this.net.voiceSignal(id, { description: pc.localDescription });
    } catch {}
  }

  async flushCandidates(id, pc) {
    if (!pc.remoteDescription) return;
    const queue = this.pendingCandidates.get(id) || [];
    this.pendingCandidates.set(id, []);
    for (const candidate of queue) {
      try { await pc.addIceCandidate(candidate); } catch {}
    }
  }

  async handleSignal(from, payload) {
    if (!this.enabled || !from || !payload) return;
    const pc = this.peers.get(from) || this.createPeer(from, false);
    try {
      if (payload.hello) {
        if (this.net.id < from) await this.makeOffer(from, pc);
        return;
      }
      if (payload.description) {
        const desc = payload.description;
        if (desc.type === "offer" && pc.signalingState !== "stable") {
          await Promise.all([
            pc.setLocalDescription({ type: "rollback" }),
            pc.setRemoteDescription(desc)
          ]);
        } else {
          await pc.setRemoteDescription(desc);
        }
        await this.flushCandidates(from, pc);
        if (desc.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.net.voiceSignal(from, { description: pc.localDescription });
        }
      } else if (payload.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate);
        else {
          const queue = this.pendingCandidates.get(from) || [];
          queue.push(payload.candidate);
          if (queue.length > 64) queue.shift();
          this.pendingCandidates.set(from, queue);
        }
      }
    } catch {}
  }

  dropPeer(id) {
    clearTimeout(this.reconnectTimers.get(id));
    this.reconnectTimers.delete(id);
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.pendingCandidates.delete(id);
    this.audios.get(id)?.remove();
    this.audios.delete(id);
  }

  update(now) {
    if (!this.enabled || now - this.lastVolumeUpdate < 100) return;
    this.lastVolumeUpdate = now;
    this.syncPeers();
    const local = this.getLocalPosition();
    const players = this.getPlayers();
    for (const [id, audio] of this.audios) {
      const p = players.get(id);
      if (!p || !local) { audio.volume = 0; continue; }
      const dist = Math.hypot((p.x || 0) - local.x, (p.z || 0) - local.z);
      const proximity = dist <= 2.5 ? 1 : Math.max(0, Math.min(1, 1 - (dist - 2.5) / 16));
      audio.volume = Math.max(0, Math.min(1, proximity * this.getVolume()));
    }
  }
}
