import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PeerNetwork, MAX_RELAY_FILE_SIZE } from "./p2p.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3004);
// Loopback by default: the chat has no user accounts, so it must not be
// reachable from the local network unless the operator opts in.
const HOST = process.env.LIGHT_CHAT_HOST || "127.0.0.1";
const ACCESS_TOKEN = process.env.LIGHT_CHAT_TOKEN || "";
const MAX_FILE_SIZE = Number(process.env.LIGHT_CHAT_MAX_FILE_SIZE || 100 * 1024 * 1024);
const MAX_TEXT_LENGTH = 5000;
const MAX_NAME_LENGTH = 40;
const MAX_HISTORY = 500;
const MESSAGE_BURST = 20;
const MESSAGE_REFILL_PER_SECOND = 5;
const HEARTBEAT_INTERVAL = 30_000;
const HISTORY_SYNC_LIMIT = 100;

// Peer-to-peer mode: every participant runs this same app, the nodes find each
// other on the LAN and gossip messages directly. No node is "the server".
const P2P_ENABLED = process.env.LIGHT_CHAT_P2P !== "0";
const P2P_PORT = Number(process.env.LIGHT_CHAT_P2P_PORT || 41235);
const P2P_HOST = process.env.LIGHT_CHAT_P2P_HOST || "0.0.0.0";
const ROOM = (process.env.LIGHT_CHAT_ROOM || "lan").slice(0, 40);
const ROOM_KEY = process.env.LIGHT_CHAT_ROOM_KEY || "";
const NODE_NAME = (process.env.LIGHT_CHAT_NODE_NAME || os.hostname() || "Node").slice(0, 40);

const app = express();
app.disable("x-powered-by");
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
// In the packaged desktop app the app folder is read-only, so allow an override.
const storageRoot = process.env.LIGHT_CHAT_DATA_DIR || __dirname;
const uploadsDir = path.join(storageRoot, "uploads");
const dataDir = path.join(storageRoot, "data");
const messagesFile = path.join(dataDir, "messages.json");

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

function tokenMatches(candidate) {
  if (!ACCESS_TOKEN) return true;
  const expected = Buffer.from(ACCESS_TOKEN);
  const actual = Buffer.from(String(candidate || ""));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function requireToken(req, res, next) {
  if (tokenMatches(req.headers["x-access-token"])) return next();
  res.status(401).json({ error: "Invalid access token." });
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const INLINE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"]
]);

// Uploads are arbitrary user content: only bitmap images may be served with a
// renderable type, and everything else downloads as an opaque blob. Otherwise
// an uploaded .html or .svg is stored XSS in the app's own origin.
app.use(
  "/uploads",
  express.static(uploadsDir, {
    index: false,
    setHeaders(res, filePath) {
      const inlineType = INLINE_TYPES.get(path.extname(filePath).toLowerCase());
      res.setHeader("Content-Type", inlineType || "application/octet-stream");
      if (!inlineType) res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    }
  })
);

function readMessages() {
  try {
    const parsed = JSON.parse(fs.readFileSync(messagesFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const messages = readMessages();

// Write to a sibling file and rename: a crash mid-write can no longer truncate
// the whole history.
function saveMessages() {
  const tempFile = `${messagesFile}.${process.pid}.tmp`;
  const handle = fs.openSync(tempFile, "w");
  try {
    fs.writeFileSync(handle, JSON.stringify(messages));
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tempFile, messagesFile);
}

function pruneUpload(url) {
  if (!url) return;
  const name = path.basename(decodeURIComponent(url));
  fs.promises.unlink(path.join(uploadsDir, name)).catch(() => {});
}

const messageIds = new Set(messages.map(item => item?.id).filter(Boolean));

// Returns false when the id is already known: the mesh floods messages, so the
// same item can arrive from several peers and across restarts.
function appendMessage(item) {
  if (messageIds.has(item.id)) return false;
  messageIds.add(item.id);
  messages.push(item);
  while (messages.length > MAX_HISTORY) {
    const dropped = messages.shift();
    messageIds.delete(dropped?.id);
    pruneUpload(dropped?.file?.url);
  }
  saveMessages();
  return true;
}

function broadcast(message, { except } = {}) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== except) client.send(payload);
  }
}

function localUsers() {
  const users = [];
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      users.push({ id: client.clientId, user: client.userName, avatar: client.avatarId, nodeName: NODE_NAME, local: true });
    }
  }
  return users;
}

function presence() {
  return { type: "presence", users: [...localUsers(), ...(network?.presenceUsers() || [])] };
}

// Local roster changes are interesting to every other node in the mesh.
function syncPresence() {
  broadcast(presence());
  network?.publishPresence(localUsers());
}

const EXTENSION_FOR_TYPE = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"]
]);

const IMAGE_SIGNATURES = [
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }
];

// The client-declared MIME type decides whether we render a file inline, so
// derive it from the bytes instead of trusting the upload header.
function sniffImageType(filePath) {
  let handle;
  try {
    handle = fs.openSync(filePath, "r");
    const head = Buffer.alloc(12);
    fs.readSync(handle, head, 0, head.length, 0);
    for (const { type, bytes } of IMAGE_SIGNATURES) {
      if (bytes.every((byte, index) => head[index] === byte)) {
        if (type !== "image/webp" || head.subarray(8, 12).toString("ascii") === "WEBP") return type;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

// Shared by uploads and by attachments arriving over a peer link: the stored
// extension - not any client-supplied label - decides how a file is served.
function storeBuffer(buffer, originalName) {
  const safeName = sanitizeFileName(originalName);
  const storedName = `${crypto.randomUUID()}-${safeName.replace(/\.[^.]{1,10}$/, "")}`;
  const tempPath = path.join(uploadsDir, storedName);
  fs.writeFileSync(tempPath, buffer);
  const imageType = sniffImageType(tempPath);
  const finalName = `${storedName}${imageType ? EXTENSION_FOR_TYPE.get(imageType) : ".bin"}`;
  fs.renameSync(tempPath, path.join(uploadsDir, finalName));
  return {
    url: `/uploads/${encodeURIComponent(finalName)}`,
    name: safeName,
    size: buffer.length,
    type: imageType || "application/octet-stream"
  };
}

function sanitizeFileName(name) {
  return String(name || "file").replace(/[^a-zA-Z0-9._() -]/g, "_").slice(0, 180);
}

app.post("/api/upload", requireToken, (req, res) => {
  const originalName = String(req.headers["x-file-name"] || "file");
  const declaredSize = Number(req.headers["content-length"] || 0);

  if (declaredSize > MAX_FILE_SIZE) {
    return res.status(413).json({ error: `Maximum file size is ${formatLimit()}.` });
  }

  const safeName = sanitizeFileName(originalName);
  // The stored name carries no extension of its own; one is appended below
  // based on the sniffed content.
  const storedName = `${crypto.randomUUID()}-${safeName.replace(/\.[^.]{1,10}$/, "")}`;
  const storedPath = path.join(uploadsDir, storedName);
  // Stream straight to disk so large transfers never buffer in memory.
  const writeStream = fs.createWriteStream(storedPath);
  let size = 0;
  let aborted = false;

  const cleanup = () => fs.promises.unlink(storedPath).catch(() => {});

  req.on("data", chunk => {
    size += chunk.length;
    if (size > MAX_FILE_SIZE && !aborted) {
      aborted = true;
      writeStream.destroy();
      cleanup();
      if (!res.headersSent) res.status(413).json({ error: `Maximum file size is ${formatLimit()}.` });
      req.destroy();
    }
  });

  req.pipe(writeStream);

  writeStream.on("finish", () => {
    if (aborted) return;
    // The stored extension - not the upload header - decides how the file is
    // later served, so make it agree with the actual bytes.
    const imageType = sniffImageType(storedPath);
    const extension = imageType ? EXTENSION_FOR_TYPE.get(imageType) : ".bin";
    const finalName = `${storedName}${extension}`;
    try {
      fs.renameSync(storedPath, path.join(uploadsDir, finalName));
    } catch {
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: "Upload failed." });
      return;
    }
    res.json({
      url: `/uploads/${encodeURIComponent(finalName)}`,
      name: safeName,
      size,
      type: imageType || "application/octet-stream"
    });
  });

  const fail = () => {
    if (aborted) return;
    aborted = true;
    writeStream.destroy();
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: "Upload failed." });
  };

  req.on("error", fail);
  writeStream.on("error", fail);
});

function formatLimit() {
  const mb = MAX_FILE_SIZE / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb.toFixed(0)} MB`;
}

function allowMessage(socket) {
  const now = Date.now();
  const elapsed = (now - socket.lastRefill) / 1000;
  socket.tokens = Math.min(MESSAGE_BURST, socket.tokens + elapsed * MESSAGE_REFILL_PER_SECOND);
  socket.lastRefill = now;
  if (socket.tokens < 1) return false;
  socket.tokens -= 1;
  return true;
}

function sanitizeFile(file) {
  if (!file || typeof file !== "object") return null;
  const url = String(file.url || "");
  // Only accept a URL we handed out from /api/upload.
  if (!/^\/uploads\/[^/\\]+$/.test(url)) return null;
  return {
    url,
    name: String(file.name || "file").slice(0, 180),
    size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0,
    type: String(file.type || "application/octet-stream").slice(0, 80)
  };
}

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url, "http://localhost");
  if (!tokenMatches(requestUrl.searchParams.get("token"))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});

wss.on("connection", socket => {
  socket.clientId = crypto.randomUUID();
  socket.userName = "Guest";
  socket.avatarId = "";
  socket.isAlive = true;
  socket.tokens = MESSAGE_BURST;
  socket.lastRefill = Date.now();

  socket.on("pong", () => { socket.isAlive = true; });

  socket.send(
    JSON.stringify({
      type: "welcome",
      clientId: socket.clientId,
      maxFileSize: MAX_FILE_SIZE,
      maxRelayFileSize: MAX_RELAY_FILE_SIZE,
      network: networkStatus()
    })
  );
  socket.send(JSON.stringify({ type: "history", messages }));
  syncPresence();

  socket.on("close", () => {
    broadcast({ type: "typing", clientId: socket.clientId, user: socket.userName, active: false });
    syncPresence();
  });

  socket.on("message", raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid message." }));
      return;
    }

    if (typeof message?.user === "string") socket.userName = message.user.trim().slice(0, MAX_NAME_LENGTH) || "Guest";
    if (typeof message?.avatar === "string") socket.avatarId = message.avatar.slice(0, 20);

    if (message.type === "message") {
      if (!allowMessage(socket)) {
        socket.send(JSON.stringify({ type: "error", message: "You are sending messages too quickly." }));
        return;
      }
      const text = String(message.text || "").slice(0, MAX_TEXT_LENGTH);
      const file = sanitizeFile(message.file);
      if (!text && !file) return;
      const item = {
        id: crypto.randomUUID(),
        type: "message",
        clientId: socket.clientId,
        user: socket.userName,
        text,
        avatar: socket.avatarId,
        file,
        time: new Date().toISOString()
      };
      appendMessage(item);
      broadcast(item);
      network?.publishMessage(packForMesh(item));
      syncPresence();
    }

    if (message.type === "typing") {
      const payload = {
        type: "typing",
        clientId: socket.clientId,
        user: socket.userName,
        active: Boolean(message.active)
      };
      broadcast(payload, { except: socket });
      network?.publishTyping(payload);
    }

    if (message.type === "profile") syncPresence();

    // The UI is loopback-only, so a manual dial can be triggered from it for
    // peers that multicast never reaches (routed subnets, VPN links).
    if (message.type === "connect-peer" && network) {
      const address = String(message.address || "").trim();
      const port = Number(message.port);
      if (!/^[a-zA-Z0-9.:_-]{1,64}$/.test(address) || !Number.isInteger(port) || port < 1 || port > 65535) {
        socket.send(JSON.stringify({ type: "error", message: "Enter a valid address and port." }));
        return;
      }
      network.connectTo(address, port);
      socket.send(JSON.stringify({ type: "info", message: `Dialling ${address}:${port}…` }));
    }
  });
});

// --- Peer mesh -------------------------------------------------------------

let network = null;

function networkStatus() {
  return network
    ? { ...network.status(), enabled: true }
    : { enabled: false, room: ROOM, secured: Boolean(ROOM_KEY), peers: [], addresses: [], nodeName: NODE_NAME };
}

function announceNetwork() {
  broadcast({ type: "network", network: networkStatus() });
}

// Attachments travel inline over the peer link: a URL only means something on
// the node that stored the bytes. Relayed history keeps the node that first
// sent each message, so it is not re-badged with whoever passed it along.
function packForMesh(item) {
  const origin = item.node || NODE_NAME;
  if (!item.file?.url) return { ...item, node: origin };
  try {
    const filePath = path.join(uploadsDir, path.basename(decodeURIComponent(item.file.url)));
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_RELAY_FILE_SIZE) {
      return { ...item, node: origin, file: { ...item.file, url: null, unavailable: true } };
    }
    return { ...item, node: origin, file: { ...item.file, url: null, data: fs.readFileSync(filePath).toString("base64") } };
  } catch {
    return { ...item, node: origin, file: { ...item.file, url: null, unavailable: true } };
  }
}

function unpackFromMesh(item) {
  const base = {
    id: String(item.id || crypto.randomUUID()).slice(0, 64),
    type: "message",
    clientId: String(item.clientId || "").slice(0, 64),
    user: String(item.user || "Guest").slice(0, MAX_NAME_LENGTH),
    text: String(item.text || "").slice(0, MAX_TEXT_LENGTH),
    avatar: String(item.avatar || "").slice(0, 20),
    node: String(item.node || "").slice(0, MAX_NAME_LENGTH),
    time: typeof item.time === "string" ? item.time : new Date().toISOString(),
    file: null
  };
  const file = item.file;
  if (!file || typeof file !== "object") return base;
  if (typeof file.data === "string") {
    const buffer = Buffer.from(file.data, "base64");
    if (buffer.length && buffer.length <= MAX_RELAY_FILE_SIZE) {
      try {
        return { ...base, file: storeBuffer(buffer, file.name) };
      } catch {
        // Fall through to the "not available here" card below.
      }
    }
  }
  return {
    ...base,
    file: {
      url: null,
      unavailable: true,
      name: sanitizeFileName(file.name),
      size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0,
      type: String(file.type || "application/octet-stream").slice(0, 80)
    }
  };
}

function acceptRemote(item) {
  const message = unpackFromMesh(item);
  if (!message.text && !message.file) return;
  if (!appendMessage(message)) return;
  broadcast(message);
}

async function startNetwork() {
  if (!P2P_ENABLED) return null;
  const node = new PeerNetwork({
    dataDir,
    nodeName: NODE_NAME,
    room: ROOM,
    roomKey: ROOM_KEY,
    port: P2P_PORT,
    host: P2P_HOST
  });

  node.on("message", acceptRemote);
  node.on("history", items => {
    let added = 0;
    for (const item of items) {
      const message = unpackFromMesh(item);
      if ((message.text || message.file) && appendMessage(message)) added += 1;
    }
    if (!added) return;
    messages.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    saveMessages();
    broadcast({ type: "history", messages });
  });
  node.on("typing", payload => {
    if (payload?.type === "typing") broadcast(payload);
  });
  node.on("presence", () => broadcast(presence()));
  node.on("peers", () => announceNetwork());
  node.on("link", ({ peerId }) => {
    // Hand the newcomer our recent history so nobody joins into an empty room.
    node.sendHistory(peerId, messages.slice(-HISTORY_SYNC_LIMIT).map(packForMesh));
    node.publishPresence(localUsers());
    announceNetwork();
  });
  node.on("warning", message => console.warn(`[p2p] ${message}`));

  await node.start();
  network = node;
  announceNetwork();
  return node;
}

// Drop half-open sockets (closed lid, dropped Wi-Fi) instead of broadcasting to
// them forever.
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!client.isAlive) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_INTERVAL);
heartbeat.unref();

export function start({ port = PORT, host = HOST } = {}) {
  const listening = new Promise((resolve, reject) => {
    const onError = error => {
      server.off("listening", onListening);
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`Port ${port} is already in use. Try: $env:PORT=3005; npm start`)
          : error
      );
    };
    const onListening = () => {
      server.off("error", onError);
      server.on("error", error => console.error(error));
      resolve({ port: server.address().port, host });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  // A failed mesh (no multicast, blocked port) must never stop the local chat.
  return listening.then(async info => {
    const node = await startNetwork().catch(error => {
      console.warn(`[p2p] ${error.message}`);
      return null;
    });
    return { ...info, p2pPort: node?.port ?? null, peerId: node?.peerId ?? null };
  });
}

export function stop() {
  network?.stop();
  network = null;
  server.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
}

// Only auto-start when run directly (`npm start`); Electron awaits start().
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then(
    ({ port, host, p2pPort }) => {
      console.log(`Nova Star running at http://${host}:${port}`);
      if (p2pPort) console.log(`Peer mesh listening on ${P2P_HOST}:${p2pPort} (room "${ROOM}")`);
    },
    error => {
      console.error(error.message);
      process.exit(1);
    }
  );
}
