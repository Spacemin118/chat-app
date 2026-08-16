import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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

function appendMessage(item) {
  messages.push(item);
  while (messages.length > MAX_HISTORY) pruneUpload(messages.shift()?.file?.url);
  saveMessages();
}

function broadcast(message, { except } = {}) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== except) client.send(payload);
  }
}

function presence() {
  const users = [];
  for (const client of wss.clients) {
    if (client.readyState === 1) users.push({ id: client.clientId, user: client.userName, avatar: client.avatarId });
  }
  return { type: "presence", users };
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

app.post("/api/upload", requireToken, (req, res) => {
  const originalName = String(req.headers["x-file-name"] || "file");
  const declaredSize = Number(req.headers["content-length"] || 0);

  if (declaredSize > MAX_FILE_SIZE) {
    return res.status(413).json({ error: `Maximum file size is ${formatLimit()}.` });
  }

  const safeName = originalName.replace(/[^a-zA-Z0-9._() -]/g, "_").slice(0, 180);
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

  socket.send(JSON.stringify({ type: "welcome", clientId: socket.clientId, maxFileSize: MAX_FILE_SIZE }));
  socket.send(JSON.stringify({ type: "history", messages }));
  broadcast(presence());

  socket.on("close", () => {
    broadcast({ type: "typing", clientId: socket.clientId, user: socket.userName, active: false });
    broadcast(presence());
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
      broadcast(presence());
    }

    if (message.type === "typing") {
      broadcast(
        { type: "typing", clientId: socket.clientId, user: socket.userName, active: Boolean(message.active) },
        { except: socket }
      );
    }

    if (message.type === "profile") broadcast(presence());
  });
});

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
  return new Promise((resolve, reject) => {
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
}

// Only auto-start when run directly (`npm start`); Electron awaits start().
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then(
    ({ port, host }) => console.log(`Light Chat running at http://${host}:${port}`),
    error => {
      console.error(error.message);
      process.exit(1);
    }
  );
}
