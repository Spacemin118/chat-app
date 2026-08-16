import { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import dgram from "node:dgram";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DISCOVERY_PORT = Number(process.env.LIGHT_CHAT_DISCOVERY_PORT || 41234);
const DISCOVERY_GROUP = process.env.LIGHT_CHAT_DISCOVERY_GROUP || "239.255.41.234";
const ANNOUNCE_INTERVAL = 3000;
const PEER_TTL = 12_000;
const HANDSHAKE_TIMEOUT = 8000;
const SEEN_LIMIT = 4000;
// Peers exchange whole attachments inline, so the link payload has to be
// comfortably larger than the biggest file we are willing to relay.
export const MAX_RELAY_FILE_SIZE = Number(process.env.LIGHT_CHAT_MAX_RELAY_SIZE || 8 * 1024 * 1024);
const MAX_LINK_PAYLOAD = MAX_RELAY_FILE_SIZE * 2 + 1024 * 1024;

function readIdentity(dataDir) {
  const file = path.join(dataDir, "identity.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed?.peerId === "string" && parsed.peerId.length >= 8) return parsed;
  } catch {
    // A missing or corrupt identity file simply means we mint a new one.
  }
  const identity = { peerId: crypto.randomUUID() };
  try {
    fs.writeFileSync(file, JSON.stringify(identity));
  } catch {
    // Read-only data dir: the id stays valid for this run only.
  }
  return identity;
}

function broadcastAddress(address, netmask) {
  const host = address.split(".").map(Number);
  const mask = (netmask || "255.255.255.0").split(".").map(Number);
  return host.map((part, index) => (part & mask[index]) | (~mask[index] & 255)).join(".");
}

/** Every usable IPv4 interface, with the subnet broadcast address for each. */
function interfaces() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      found.push({ address: entry.address, broadcast: broadcastAddress(entry.address, entry.netmask) });
    }
  }
  return found;
}

export function localAddresses() {
  return interfaces().map(entry => entry.address);
}

function safeSend(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

/**
 * A serverless chat node: it announces itself over UDP multicast, dials the
 * other nodes it hears, and floods chat traffic across the resulting mesh.
 * Every participant runs one, so there is no central server to keep alive.
 */
export class PeerNetwork extends EventEmitter {
  constructor({ dataDir, nodeName, room = "lan", roomKey = "", port = 41235, host = "0.0.0.0" }) {
    super();
    const identity = readIdentity(dataDir);
    this.peerId = identity.peerId;
    this.nodeName = nodeName;
    this.room = room;
    this.roomKey = roomKey;
    this.requestedPort = port;
    this.host = host;
    this.port = null;
    this.links = new Map(); // peerId -> live socket
    this.pending = new Map(); // "host:port" -> dial timer/state
    this.directory = new Map(); // peerId -> { name, address, port, lastSeen }
    this.remoteUsers = new Map(); // peerId -> [{ id, user, avatar, peerId, nodeName }]
    this.seen = new Set();
    this.seenQueue = [];
    this.started = false;
  }

  async start() {
    if (this.started) return { port: null };
    this.started = true;
    await this.#listen();
    this.#startDiscovery();
    return { port: this.port, peerId: this.peerId };
  }

  async #listen() {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_LINK_PAYLOAD });
    const http = await import("node:http");
    this.httpServer = http.createServer((req, res) => {
      res.writeHead(426, { "Content-Type": "text/plain" });
      res.end("Nova Star peer link: WebSocket only.\n");
    });
    this.httpServer.on("upgrade", (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, ws => this.#adopt(ws, { dialed: false }));
    });

    for (let port = this.requestedPort; port < this.requestedPort + 20; port++) {
      try {
        await new Promise((resolve, reject) => {
          const onError = error => {
            this.httpServer.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            this.httpServer.off("error", onError);
            resolve();
          };
          this.httpServer.once("error", onError);
          this.httpServer.once("listening", onListening);
          this.httpServer.listen(port, this.host);
        });
        this.port = port;
        this.httpServer.on("error", error => this.emit("warning", error.message));
        return;
      } catch (error) {
        if (error.code !== "EADDRINUSE") throw error;
      }
    }
    throw new Error(`No free peer port between ${this.requestedPort} and ${this.requestedPort + 19}.`);
  }

  #startDiscovery() {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.discovery = socket;

    socket.on("error", error => {
      this.emit("warning", `Discovery unavailable: ${error.message}`);
      socket.close();
      this.discovery = null;
    });

    socket.on("message", (raw, rinfo) => this.#onAnnounce(raw, rinfo));

    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setMulticastTTL(1);
        // Several nodes may share one machine while testing, so keep loopback on.
        socket.setMulticastLoopback(true);
        socket.setBroadcast(true);
      } catch (error) {
        this.emit("warning", `Discovery socket limited: ${error.message}`);
      }
      // Machines routinely have several adapters (Wi-Fi, Ethernet, VPN, Hyper-V)
      // and the default one is often not the one the other computers are on.
      let joined = 0;
      for (const entry of [{ address: undefined }, ...interfaces()]) {
        try {
          socket.addMembership(DISCOVERY_GROUP, entry.address);
          joined += 1;
        } catch {
          // Already joined on this interface, or it does not support multicast.
        }
      }
      if (!joined) this.emit("warning", "Multicast unavailable: relying on broadcast discovery.");
      this.#announce();
    });

    this.announceTimer = setInterval(() => {
      this.#announce();
      this.#expirePeers();
    }, ANNOUNCE_INTERVAL);
    this.announceTimer.unref?.();
  }

  #announce(type = "announce") {
    if (!this.discovery || !this.port) return;
    const payload = JSON.stringify({
      t: type,
      peerId: this.peerId,
      name: this.nodeName,
      room: this.room,
      port: this.port
    });
    const nics = interfaces();
    // Multicast once per adapter, then repeat over subnet broadcast so nodes
    // still find each other where multicast is filtered out.
    for (const nic of nics) {
      try {
        this.discovery.setMulticastInterface(nic.address);
      } catch {
        // Adapter disappeared between the scan and the send.
      }
      this.discovery.send(payload, DISCOVERY_PORT, DISCOVERY_GROUP, () => {});
    }
    if (!nics.length) this.discovery.send(payload, DISCOVERY_PORT, DISCOVERY_GROUP, () => {});

    for (const target of new Set([...nics.map(nic => nic.broadcast), "255.255.255.255"])) {
      this.discovery.send(payload, DISCOVERY_PORT, target, () => {});
    }
  }

  #onAnnounce(raw, rinfo) {
    let packet;
    try {
      packet = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (packet.room !== this.room) return;
    if (typeof packet.peerId !== "string" || packet.peerId === this.peerId) return;

    if (packet.t === "bye") {
      this.directory.delete(packet.peerId);
      this.links.get(packet.peerId)?.close();
      this.emit("peers", this.peerList());
      return;
    }
    if (packet.t !== "announce" || !Number.isInteger(packet.port)) return;

    const address = rinfo?.address || null;
    const known = this.directory.get(packet.peerId);
    this.directory.set(packet.peerId, {
      name: String(packet.name || "Peer").slice(0, 40),
      address: address || known?.address || null,
      port: packet.port,
      lastSeen: Date.now()
    });
    if (!known) this.emit("peers", this.peerList());

    // Both sides dial: a firewall often blocks inbound on one machine only, and
    // #activate drops whichever duplicate link loses the tie-break.
    if (!this.links.has(packet.peerId)) this.#dial(this.directory.get(packet.peerId));
  }

  #expirePeers() {
    let changed = false;
    for (const [peerId, entry] of this.directory) {
      if (Date.now() - entry.lastSeen > PEER_TTL && !this.links.has(peerId)) {
        this.directory.delete(peerId);
        changed = true;
      }
    }
    if (changed) this.emit("peers", this.peerList());
  }

  #dial(entry) {
    if (!entry?.address || !entry.port) return;
    const key = `${entry.address}:${entry.port}`;
    if (this.pending.has(key)) return;
    for (const socket of this.links.values()) {
      if (socket.remoteKey === key) return;
    }
    this.pending.set(key, true);
    const socket = new WebSocket(`ws://${entry.address}:${entry.port}`, { maxPayload: MAX_LINK_PAYLOAD });
    socket.remoteKey = key;
    socket.remoteAddress = entry.address;
    socket.remotePort = entry.port;
    socket.on("open", () => {
      this.pending.delete(key);
      this.#adopt(socket, { dialed: true });
    });
    socket.on("error", () => {
      this.pending.delete(key);
      socket.terminate();
    });
  }

  /** Dial a node the multicast never reached (different subnet, VPN, etc.). */
  connectTo(address, port) {
    this.#dial({ address, port: Number(port), name: address });
  }

  #adopt(socket, { dialed }) {
    socket.nonce = crypto.randomBytes(16).toString("hex");
    socket.verified = !this.roomKey;
    socket.handshakeDone = false;
    socket.dialed = dialed;

    const timeout = setTimeout(() => {
      if (!socket.handshakeDone) socket.close(4001, "Handshake timeout");
    }, HANDSHAKE_TIMEOUT);
    timeout.unref?.();

    safeSend(socket, {
      t: "hello",
      peerId: this.peerId,
      name: this.nodeName,
      room: this.room,
      nonce: socket.nonce,
      requiresKey: Boolean(this.roomKey)
    });

    socket.on("message", raw => this.#onLinkMessage(socket, raw));
    socket.on("close", () => {
      clearTimeout(timeout);
      if (socket.peerId && this.links.get(socket.peerId) === socket) {
        this.links.delete(socket.peerId);
        this.remoteUsers.delete(socket.peerId);
        this.emit("presence");
        this.emit("peers", this.peerList());
      }
    });
    socket.on("error", () => socket.terminate());
  }

  #proof(theirNonce, ourNonce) {
    const material = [theirNonce, ourNonce].sort().join(":");
    return crypto.createHmac("sha256", this.roomKey).update(material).digest("hex");
  }

  #onLinkMessage(socket, raw) {
    let packet;
    try {
      packet = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (packet.t === "hello") {
      if (packet.room !== this.room || packet.peerId === this.peerId) {
        socket.close(4002, "Different room");
        return;
      }
      if (Boolean(packet.requiresKey) !== Boolean(this.roomKey)) {
        socket.close(4003, "Room key mismatch");
        return;
      }
      socket.peerId = packet.peerId;
      socket.peerName = String(packet.name || "Peer").slice(0, 40);
      socket.theirNonce = String(packet.nonce || "");
      if (this.roomKey) {
        safeSend(socket, { t: "auth", proof: this.#proof(socket.theirNonce, socket.nonce) });
      } else {
        this.#activate(socket);
      }
      return;
    }

    if (packet.t === "auth") {
      if (!this.roomKey || !socket.theirNonce) return;
      const expected = Buffer.from(this.#proof(socket.theirNonce, socket.nonce));
      const actual = Buffer.from(String(packet.proof || ""));
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        socket.close(4004, "Bad room key");
        return;
      }
      socket.verified = true;
      this.#activate(socket);
      return;
    }

    if (!socket.handshakeDone) return;

    if (packet.t === "msg" && packet.message?.id) {
      if (this.#remember(packet.message.id)) {
        // Relay before emitting: the local handler rewrites attachment fields
        // on the same object, and downstream peers need the original payload.
        this.#relay(packet, socket);
        this.emit("message", packet.message);
      }
      return;
    }

    if (packet.t === "history" && Array.isArray(packet.messages)) {
      const fresh = packet.messages.filter(item => item?.id && this.#remember(item.id));
      if (fresh.length) this.emit("history", fresh);
      return;
    }

    if (packet.t === "typing") {
      this.emit("typing", packet.payload);
      this.#relay(packet, socket);
      return;
    }

    if (packet.t === "presence") {
      const users = Array.isArray(packet.users) ? packet.users : [];
      this.remoteUsers.set(
        socket.peerId,
        users.map(user => ({ ...user, peerId: socket.peerId, nodeName: socket.peerName, local: false }))
      );
      this.emit("presence");
    }
  }

  #activate(socket) {
    if (socket.handshakeDone) return;
    socket.handshakeDone = true;

    const existing = this.links.get(socket.peerId);
    if (existing && existing !== socket) {
      // Both sides dialed at once: keep one link deterministically.
      const keepExisting = this.peerId < socket.peerId ? existing.dialed : !existing.dialed;
      if (keepExisting) {
        socket.close(4005, "Duplicate link");
        return;
      }
      existing.close(4005, "Duplicate link");
    }

    this.links.set(socket.peerId, socket);
    const known = this.directory.get(socket.peerId);
    this.directory.set(socket.peerId, {
      name: socket.peerName,
      address: known?.address || socket.remoteAddress || socket._socket?.remoteAddress || null,
      port: known?.port || socket.remotePort || null,
      lastSeen: Date.now()
    });

    this.emit("peers", this.peerList());
    this.emit("link", { peerId: socket.peerId, name: socket.peerName });
  }

  #remember(id) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.seenQueue.push(id);
    if (this.seenQueue.length > SEEN_LIMIT) this.seen.delete(this.seenQueue.shift());
    return true;
  }

  #relay(packet, from) {
    for (const socket of this.links.values()) {
      if (socket !== from && socket.handshakeDone) safeSend(socket, packet);
    }
  }

  /** Flood a locally created message to the whole mesh. */
  publishMessage(message) {
    this.#remember(message.id);
    this.#relay({ t: "msg", message }, null);
  }

  publishTyping(payload) {
    this.#relay({ t: "typing", payload }, null);
  }

  publishPresence(users) {
    this.#relay({ t: "presence", users }, null);
  }

  /** Hand a newcomer our recent history so late joiners are not empty. */
  sendHistory(peerId, messages) {
    const socket = this.links.get(peerId);
    if (socket) safeSend(socket, { t: "history", messages });
  }

  presenceUsers() {
    return [...this.remoteUsers.values()].flat();
  }

  peerList() {
    const peers = [];
    for (const [peerId, entry] of this.directory) {
      peers.push({
        peerId,
        name: entry.name,
        address: entry.address,
        port: entry.port,
        connected: this.links.has(peerId),
        verified: Boolean(this.links.get(peerId)?.verified)
      });
    }
    return peers.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  }

  status() {
    return {
      peerId: this.peerId,
      nodeName: this.nodeName,
      room: this.room,
      port: this.port,
      secured: Boolean(this.roomKey),
      addresses: localAddresses(),
      peers: this.peerList()
    };
  }

  stop() {
    this.#announce("bye");
    clearInterval(this.announceTimer);
    for (const socket of this.links.values()) socket.close();
    this.links.clear();
    try {
      this.discovery?.close();
    } catch {
      // Already closed.
    }
    this.httpServer?.close();
    this.started = false;
  }
}
