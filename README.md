# Light Chat

A lightweight local-first chat app: an Express + WebSocket server serving a dependency-free front end, wrapped in Electron for the desktop build.

## Run

```bash
npm install
npm start          # server only, http://127.0.0.1:3004
npm run app        # Electron desktop app (starts the server itself)
npm run lint
npm run dist       # packaged installers into release/
```

Packaged binaries are **not** committed - build them with `npm run dist` and attach them to a GitHub release.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3004` | HTTP/WebSocket port |
| `LIGHT_CHAT_HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` **only** together with `LIGHT_CHAT_TOKEN` |
| `LIGHT_CHAT_TOKEN` | *(empty)* | Shared secret required on the WebSocket upgrade (`?token=`) and on uploads (`X-Access-Token`). The desktop app generates one per launch |
| `LIGHT_CHAT_DATA_DIR` | app folder | Where `data/messages.json` and `uploads/` live |
| `LIGHT_CHAT_MAX_FILE_SIZE` | `104857600` (100 MB) | Upload size limit |

## Sharing the chat on a LAN

```bash
LIGHT_CHAT_HOST=0.0.0.0 LIGHT_CHAT_TOKEN=$(openssl rand -hex 24) npm start
```

Then open `http://<host>:3004/?token=<the token>`. Without a token the server refuses to be useful to anyone but loopback clients - there are no user accounts, so an open port means an open chat room.

## Layout

```
server.js        Express + ws server, history persistence, uploads
electron/main.cjs Desktop shell: starts the server on loopback, hardened BrowserWindow
public/          index.html, app.js, style.css (no build step, no runtime deps)
```
