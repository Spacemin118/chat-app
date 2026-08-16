# Nova Star

A peer-to-peer chat app for the computers on your own network. Every participant runs the same app, and every copy is its own node: it serves the UI to its own user on loopback, announces itself over the LAN, and links directly to the other nodes it finds. There is no central server - close any node and the rest keep talking.

## Run

```bash
npm install
npm start          # server only, http://127.0.0.1:3004
npm run app        # Electron desktop app (starts its own node)
npm run lint
npm run dist       # packaged installers into release/
```

Packaged binaries are **not** committed - build them with `npm run dist` and attach them to a GitHub release.

Start the app on two computers on the same network and they find each other within a few seconds; the sidebar lists the nodes that are linked. Nothing else has to be running.

## How the mesh works

1. Each node listens for peer links on `0.0.0.0:41235` and serves its own UI on `127.0.0.1:3004`. Only the peer protocol is exposed to the network - the UI never is.
2. Nodes announce `{peerId, name, room, port}` every 3 seconds - to `239.255.41.234:41234` on every IPv4 adapter, and to each adapter's subnet broadcast address, so discovery still works where multicast is filtered. Both sides dial (a firewall often blocks inbound on one machine only) and the duplicate link loses a deterministic tie-break, so each pair keeps exactly one.
3. Chat messages, typing and presence are flooded across the links and deduplicated by message id, so a node reaches peers it never dialed itself.
4. A node that has just linked receives the last 100 messages from its new peer, so joining late is not an empty room.
5. Small attachments travel inline over the link (up to `LIGHT_CHAT_MAX_RELAY_SIZE`) and are stored by each receiving node.
6. Bigger files are only advertised: the bytes stay on the sending computer until someone presses **Get file**, then stream across the direct link in 128 KB chunks with a progress bar. The two computers must be linked directly (both appear under Nearby nodes).
7. Nicknames, mutes and blocks are per-computer: there are no accounts, so each node decides for itself who it wants to see. Open them with **Manage** next to "In this room".

Set `LIGHT_CHAT_ROOM_KEY` to the same passphrase on every node to keep strangers out: peers prove knowledge of it with an HMAC over both handshake nonces, and links without a matching key are refused.

The Windows installer adds firewall rules for UDP `41234` and TCP `41235-41254`. When discovery is blocked anyway (routed subnets, VPNs, client isolation on the Wi-Fi), use **Nearby nodes -> Add** in the sidebar and dial the other computer's `address:41235` directly - the sidebar prints this node's own address for that purpose.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `LIGHT_CHAT_P2P` | `1` | Set to `0` to run a single isolated node |
| `LIGHT_CHAT_P2P_PORT` | `41235` | Peer link port (the next 20 ports are tried when busy) |
| `LIGHT_CHAT_P2P_HOST` | `0.0.0.0` | Bind address for the peer link |
| `LIGHT_CHAT_ROOM` | `lan` | Only nodes with the same room name link up |
| `LIGHT_CHAT_ROOM_KEY` | *(empty)* | Shared passphrase authenticating peer links |
| `LIGHT_CHAT_NODE_NAME` | hostname | Name shown for this node in the mesh |
| `LIGHT_CHAT_MAX_RELAY_SIZE` | `1048576` (1 MB) | Largest attachment sent inline; bigger files are fetched on demand |
| `LIGHT_CHAT_DISCOVERY_PORT` | `41234` | UDP discovery port |
| `LIGHT_CHAT_DISCOVERY_GROUP` | `239.255.41.234` | Multicast group |
| `PORT` | `3004` | HTTP/WebSocket port |
| `LIGHT_CHAT_HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` **only** together with `LIGHT_CHAT_TOKEN` |
| `LIGHT_CHAT_TOKEN` | *(empty)* | Shared secret required on the WebSocket upgrade (`?token=`) and on uploads (`X-Access-Token`). The desktop app generates one per launch |
| `LIGHT_CHAT_DATA_DIR` | app folder | Where `data/messages.json` and `uploads/` live |
| `LIGHT_CHAT_MAX_FILE_SIZE` | `104857600` (100 MB) | Upload size limit |

## Two nodes on one machine

Handy for trying the mesh out:

```bash
PORT=3004 LIGHT_CHAT_NODE_NAME=alpha LIGHT_CHAT_DATA_DIR=/tmp/alpha npm start
PORT=3005 LIGHT_CHAT_P2P_PORT=41236 LIGHT_CHAT_NODE_NAME=beta LIGHT_CHAT_DATA_DIR=/tmp/beta npm start
```

On Windows PowerShell, run each node in its own terminal:

```powershell
$env:PORT="3004"; $env:LIGHT_CHAT_NODE_NAME="alpha"; $env:LIGHT_CHAT_DATA_DIR="$env:TEMP\alpha"; npm start
$env:PORT="3005"; $env:LIGHT_CHAT_P2P_PORT="41236"; $env:LIGHT_CHAT_NODE_NAME="beta"; $env:LIGHT_CHAT_DATA_DIR="$env:TEMP\beta"; npm start
```

The desktop app normally allows one copy per machine; start it with `--multi` (or `NOVA_STAR_MULTI=1`) to run a second window for the same reason.

## Serving the UI to other devices

The mesh is the intended way to chat between computers. If you instead want a phone to open the UI of one node in a browser:

```bash
LIGHT_CHAT_HOST=0.0.0.0 LIGHT_CHAT_TOKEN=$(openssl rand -hex 24) npm start
```

Then open `http://<host>:3004/?token=<the token>`. Without a token the UI refuses to be useful to anyone but loopback clients - there are no user accounts, so an open port means an open chat room.

## Layout

```
server.js         Local UI server: history persistence, uploads, mesh wiring
p2p.js            The node itself: discovery, peer links, handshake, gossip
electron/main.cjs Desktop shell: starts the node on loopback, hardened BrowserWindow
public/           index.html, app.js, style.css (no build step, no runtime deps)
```
