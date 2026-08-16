const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_PORT = Number(process.env.PORT || 3004);
const HOST = "127.0.0.1";
// Even on loopback, any local process could otherwise talk to the chat server.
const TOKEN = crypto.randomBytes(24).toString("hex");

// A second copy on the same machine is normally a stray double-click, but it is
// also how you try the mesh out on one PC, so it stays available behind a flag.
const ALLOW_MULTI = process.env.NOVA_STAR_MULTI === "1" || process.argv.includes("--multi");

if (!ALLOW_MULTI && !app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

async function startServer() {
  process.env.LIGHT_CHAT_HOST = HOST;
  process.env.LIGHT_CHAT_TOKEN = TOKEN;
  // Keep chat history and uploads in the user's writable app-data folder.
  process.env.LIGHT_CHAT_DATA_DIR = app.getPath("userData");
  const serverPath = path.join(__dirname, "..", "server.js");
  const { start } = await import(`file://${serverPath.replace(/\\/g, "/")}`);

  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 20; port++) {
    try {
      // Resolves only once the socket is actually listening, so the window
      // never loads before the server can answer.
      const listening = await start({ port, host: HOST });
      return listening.port;
    } catch (error) {
      if (!/already in use/i.test(error.message)) throw error;
    }
  }
  throw new Error(`No free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + 19}.`);
}

function isExternalLink(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function createWindow() {
  const port = await startServer();
  const appUrl = `http://${HOST}:${port}`;
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#111418",
    autoHideMenuBar: true,
    title: "Nova Star",
    icon: path.join(__dirname, "..", "public", "nova-star.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      if (isExternalLink(url)) shell.openExternal(url);
    }
  });

  await win.loadURL(`${appUrl}/?token=${TOKEN}`);
}

app.whenReady().then(() =>
  createWindow().catch(error => {
    dialog.showErrorBox("Nova Star could not start", error.message);
    app.quit();
  })
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
