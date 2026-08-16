const messagesEl = document.getElementById("messages");
const statusEl = document.getElementById("status");
const typingEl = document.getElementById("typing");
const nameEl = document.getElementById("profileNameInput");
const textEl = document.getElementById("text");
const fileEl = document.getElementById("file");
const fileQueueEl = document.getElementById("fileQueue");
const composer = document.getElementById("composer");
const dropZone = document.getElementById("dropZone");
const sendButton = document.getElementById("sendButton");
const messageCountEl = document.getElementById("messageCount");
const profileNameEl = document.getElementById("profileName");
const profileAvatarEl = document.getElementById("profileAvatar");
const profileModal = document.getElementById("profileModal");
const profileButton = document.getElementById("profileButton");
const closeProfile = document.getElementById("closeProfile");
const saveProfile = document.getElementById("saveProfile");
const themeButton = document.getElementById("themeButton");
const scrollButton = document.getElementById("scrollButton");
const newMessagesButton = document.getElementById("newMessages");
const toastRegion = document.getElementById("toastRegion");
const emojiButton = document.getElementById("emojiButton");
const emojiPanel = document.getElementById("emojiPanel");
const avatarGrid = document.getElementById("avatarGrid");
const sidebarAvatarEl = document.getElementById("sidebarAvatar");
const peopleListEl = document.getElementById("peopleList");
const presenceCountEl = document.getElementById("presenceCount");
const emptyStateEl = document.getElementById("emptyState");
const announcerEl = document.getElementById("announcer");
const meshStatusEl = document.getElementById("meshStatus");
const peerListEl = document.getElementById("peerList");
const peerCountEl = document.getElementById("peerCount");
const meshEmptyEl = document.getElementById("meshEmpty");
const nodeNameEl = document.getElementById("nodeName");
const nodeRoomEl = document.getElementById("nodeRoom");
const nodeAddressEl = document.getElementById("nodeAddress");
const peerModal = document.getElementById("peerModal");
const addPeerButton = document.getElementById("addPeerButton");
const closePeerModal = document.getElementById("closePeerModal");
const dialPeerButton = document.getElementById("dialPeer");
const peerAddressInput = document.getElementById("peerAddressInput");
const peerPortInput = document.getElementById("peerPortInput");
const conversationSubtitle = document.getElementById("conversationSubtitle");
const peopleModal = document.getElementById("peopleModal");
const peopleManagerList = document.getElementById("peopleManagerList");
const peopleSearch = document.getElementById("peopleSearch");
const peopleEmpty = document.getElementById("peopleEmpty");
const managePeopleButton = document.getElementById("managePeopleButton");
const closePeopleModal = document.getElementById("closePeopleModal");

// The desktop shell passes a per-launch token; the server rejects sockets and
// uploads without it.
const ACCESS_TOKEN = new URLSearchParams(location.search).get("token") || "";

let maxFileSize = 100 * 1024 * 1024;

// Cartoon crew drawn as inline SVG - see avatars.js.
const AVATARS = window.NovaAvatars?.list || [];

const EMOJIS = [
  "😀","😄","😁","😂","🤣","😊","😉","😍","😘","😜","🤪","🤗",
  "🤔","🤨","😐","😴","😎","🥳","😢","😭","😤","😱","🥺","😇",
  "👍","👎","👏","🙌","🙏","💪","🤝","✌️","👋","🤞","🫶","👀",
  "❤️","🧡","💛","💚","💙","💜","🔥","✨","🎉","🎊","💯","⚡",
  "☕","🍕","🍔","🍰","🍺","🌙","☀️","🌈","🐱","🐶","🚀","⭐"
];

let selectedAvatar = localStorage.getItem("chat-avatar") || "";
let selectedFiles = [];
let typingTimer;
let socket;
let reconnectTimer;
let reconnectAttempt = 0;
let shouldReconnect = true;
let messageCount = 0;
let lastRenderedUser = null;
let lastRenderedDay = null;
let isNearBottom = true;
let clientId = null;
let meshPort = null;
let myNode = "";
const renderedIds = new Set();
const typingUsers = new Map();
// Kept so the transcript can be redrawn when somebody is blocked or renamed.
const transcript = [];
const historyIds = new Set();
const HISTORY_CAP = 600;
const fileCards = new Map();
let onlineUsers = [];

// --- People you have met ---------------------------------------------------

// There are no accounts in a serverless chat, so "managing users" is something
// each node does for itself: a local address book with nicknames, mutes and
// blocks that survives restarts.
const PEOPLE_KEY = "nova-people";
const people = loadPeople();

function loadPeople() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PEOPLE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? new Map(Object.entries(parsed)) : new Map();
  } catch {
    return new Map();
  }
}

function savePeople() {
  localStorage.setItem(PEOPLE_KEY, JSON.stringify(Object.fromEntries(people)));
}

function personKey(user, node) {
  return `${String(user || "Guest").toLowerCase()}@${String(node || myNode || "this").toLowerCase()}`;
}

function rememberPerson({ user, node, avatar, local }) {
  const key = personKey(user, node);
  const entry = people.get(key) || { nickname: "", muted: false, blocked: false };
  entry.name = user;
  entry.node = node || myNode || "this computer";
  entry.local = Boolean(local);
  if (avatar) entry.avatar = avatar;
  entry.lastSeen = Date.now();
  people.set(key, entry);
  return entry;
}

function personFor(user, node) {
  return people.get(personKey(user, node)) || null;
}

function displayName(user, node) {
  return personFor(user, node)?.nickname || user;
}

function isBlocked(user, node) {
  return Boolean(personFor(user, node)?.blocked);
}

function isMuted(user, node) {
  const entry = personFor(user, node);
  return Boolean(entry?.muted || entry?.blocked);
}

const storedName = localStorage.getItem("chat-name") || "";
nameEl.value = storedName;
renderAvatarPicker();
updateProfileUI();

function getName() {
  return nameEl.value.trim() || "Guest";
}

function paintAvatar(element, name, avatarId) {
  const art = window.NovaAvatars?.svg(avatarId) || "";
  if (art) {
    element.innerHTML = art;
    element.classList.add("avatar-art");
  } else {
    element.textContent = initials(name);
    element.classList.remove("avatar-art");
  }
}

function renderAvatarPicker() {
  if (!avatarGrid) return;
  avatarGrid.innerHTML = "";
  AVATARS.forEach(item => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `avatar-option${item.id === selectedAvatar ? " selected" : ""}`;
    option.innerHTML = window.NovaAvatars.svg(item.id);
    option.title = item.label;
    option.setAttribute("aria-label", `Use the ${item.label} avatar`);
    option.addEventListener("click", () => {
      selectedAvatar = item.id === selectedAvatar ? "" : item.id;
      renderAvatarPicker();
      paintAvatar(profileAvatarEl, nameEl.value.trim() || "Guest", selectedAvatar);
    });
    avatarGrid.appendChild(option);
  });
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "G";
  return parts.slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function updateProfileUI() {
  const name = getName();
  profileNameEl.textContent = name;
  paintAvatar(profileAvatarEl, name, selectedAvatar);
  paintAvatar(sidebarAvatarEl, name, selectedAvatar);
}

function setStatus(label, state) {
  statusEl.className = `connection-pill ${state}`;
  statusEl.innerHTML = `<i></i>${label}`;
}

function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  setStatus(reconnectAttempt ? "Reconnecting" : "Connecting", "connecting");
  const query = ACCESS_TOKEN ? `?token=${encodeURIComponent(ACCESS_TOKEN)}` : "";
  socket = new WebSocket(`${protocol}//${location.host}${query}`);

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    setStatus("Connected", "online");
  });

  socket.addEventListener("close", () => {
    setStatus("Reconnecting", "connecting");
    if (shouldReconnect) scheduleReconnect();
  });

  socket.addEventListener("error", () => setStatus("Connection issue", "offline"));

  socket.addEventListener("message", event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === "welcome") {
      clientId = data.clientId;
      if (Number.isFinite(data.maxFileSize)) maxFileSize = data.maxFileSize;
      renderNetwork(data.network);
    } else if (data.type === "network") {
      renderNetwork(data.network);
    } else if (data.type === "info") {
      showToast(data.message || "");
    } else if (data.type === "history") {
      const known = historyIds.size > 0;
      const incoming = data.messages.filter(remember);
      if (!known) {
        redrawMessages();
      } else {
        incoming.forEach(item => { if (!isBlocked(item.user, item.node)) renderMessage(item); });
      }
      updateCount();
      if (!known || isNearBottom) requestAnimationFrame(scrollBottom);
    } else if (data.type === "message") {
      if (!remember(data)) return;
      updateCount();
      if (isBlocked(data.user, data.node)) return;
      renderMessage(data);
      if (!isMine(data) && !isMuted(data.user, data.node)) {
        announce(`${displayName(data.user, data.node)} said ${data.text || "sent a file"}`);
      }
      if (isNearBottom) scrollBottom();
      else newMessagesButton.classList.add("visible");
    } else if (data.type === "transfer") {
      updateTransfer(data);
    } else if (data.type === "file-ready") {
      applyReadyFile(data);
    } else if (data.type === "typing") {
      updateTyping(data);
    } else if (data.type === "presence") {
      renderPresence(data.users || []);
    } else if (data.type === "error") {
      showToast(data.message || "Something went wrong.");
    }
  });
}

function scheduleReconnect() {
  reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
  const delay = Math.min(1000 * 2 ** (reconnectAttempt - 1), 8000);
  reconnectTimer = setTimeout(connect, delay);
}

function updateCount() {
  messageCount = transcript.length;
  messageCountEl.textContent = messageCount > 999 ? "999+" : String(messageCount);
  emptyStateEl.hidden = messageCount > 0;
}

// Returns false for a message we already hold: the mesh floods, so the same
// item can arrive twice.
function remember(message) {
  if (!message?.id || historyIds.has(message.id)) return false;
  historyIds.add(message.id);
  transcript.push(message);
  if (transcript.length > HISTORY_CAP) historyIds.delete(transcript.shift()?.id);
  rememberPerson({ user: message.user, node: message.node, avatar: message.avatar });
  return true;
}

function redrawMessages() {
  resetMessages();
  transcript.forEach(item => { if (!isBlocked(item.user, item.node)) renderMessage(item); });
  updateCount();
}

function resetMessages() {
  messagesEl.innerHTML = "";
  renderedIds.clear();
  fileCards.clear();
  lastRenderedUser = null;
  lastRenderedDay = null;
}

// Ownership follows the server-assigned connection id, so two people using the
// same display name no longer see each other's messages as their own.
function isMine(message) {
  return Boolean(clientId) && message.clientId === clientId;
}

function announce(text) {
  announcerEl.textContent = text;
}

function dayKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toDateString();
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function renderMessage(message) {
  renderedIds.add(message.id);

  const key = dayKey(message.time);
  if (key && key !== lastRenderedDay) {
    const separator = document.createElement("div");
    separator.className = "day-separator";
    const label = document.createElement("span");
    label.textContent = dayLabel(message.time);
    separator.appendChild(label);
    messagesEl.appendChild(separator);
    lastRenderedDay = key;
    lastRenderedUser = null;
  }

  const mine = isMine(message);
  const grouped = lastRenderedUser === (message.clientId || message.user);
  const row = document.createElement("article");
  row.className = `message-row ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`;

  if (!mine) {
    const avatar = document.createElement("div");
    avatar.className = "avatar message-avatar";
    paintAvatar(avatar, message.user, message.avatar);
    row.appendChild(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";

  const head = document.createElement("div");
  head.className = "message-head";
  const user = document.createElement("span");
  user.className = "message-user";
  user.textContent = displayName(message.user, message.node);
  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = formatTime(message.time);
  head.append(user, time);
  if (message.node) {
    // Remote messages carry the node they were typed on, so it is always clear
    // which computer a message came from.
    const origin = document.createElement("span");
    origin.className = "message-node";
    origin.textContent = message.node;
    head.appendChild(origin);
  }
  content.appendChild(head);

  if (message.text) {
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = message.text;
    bubble.appendChild(body);
    content.appendChild(bubble);
  }

  if (message.file) content.appendChild(createFileCard(message.file, message.id));
  row.appendChild(content);
  messagesEl.appendChild(row);
  lastRenderedUser = message.clientId || message.user;
}

function updateTyping(data) {
  if (data.clientId === clientId) return;
  if (isMuted(data.user, data.node)) return;
  const existing = typingUsers.get(data.clientId);
  if (existing) clearTimeout(existing.timer);
  if (!data.active) typingUsers.delete(data.clientId);
  else {
    typingUsers.set(data.clientId, {
      user: data.user,
      // Expire locally so a dropped "stopped typing" cannot wedge the indicator.
      timer: setTimeout(() => { typingUsers.delete(data.clientId); renderTyping(); }, 4000)
    });
  }
  renderTyping();
}

function renderTyping() {
  const names = [...typingUsers.values()].map(entry => entry.user);
  if (!names.length) typingEl.textContent = "";
  else if (names.length === 1) typingEl.textContent = `${names[0]} is typing`;
  else if (names.length === 2) typingEl.textContent = `${names[0]} and ${names[1]} are typing`;
  else typingEl.textContent = `${names[0]} and ${names.length - 1} others are typing`;
}

function renderPresence(users) {
  onlineUsers = users;
  users.forEach(person => rememberPerson({ user: person.user, node: person.nodeName, avatar: person.avatar, local: person.local }));
  savePeople();
  presenceCountEl.textContent = String(users.length);
  peopleListEl.innerHTML = "";
  users.forEach(person => {
    const entry = personFor(person.user, person.nodeName);
    const row = document.createElement("div");
    row.className = `person${entry?.blocked ? " blocked" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar person-avatar";
    paintAvatar(avatar, person.user, person.avatar);
    const copy = document.createElement("div");
    copy.className = "person-copy";
    const name = document.createElement("span");
    name.className = "person-name";
    const shown = displayName(person.user, person.nodeName);
    name.textContent = person.id === clientId ? `${shown} (you)` : shown;
    copy.appendChild(name);
    if (person.nodeName) {
      const node = document.createElement("span");
      node.className = "person-node";
      const tags = [person.local ? "this computer" : person.nodeName];
      if (entry?.muted) tags.push("muted");
      if (entry?.blocked) tags.push("blocked");
      node.textContent = tags.join(" · ");
      copy.appendChild(node);
    }
    row.append(avatar, copy);
    if (person.id !== clientId) {
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "person-manage";
      manage.title = `Manage ${shown}`;
      manage.setAttribute("aria-label", `Manage ${shown}`);
      manage.textContent = "⋯";
      manage.addEventListener("click", () => openPeople(personKey(person.user, person.nodeName)));
      row.appendChild(manage);
    }
    peopleListEl.appendChild(row);
  });
  if (!peopleModal.hidden) renderPeopleManager();
}

// --- People manager --------------------------------------------------------

function onlineKeys() {
  return new Set(onlineUsers.map(person => personKey(person.user, person.nodeName)));
}

function renderPeopleManager() {
  const online = onlineKeys();
  const term = peopleSearch.value.trim().toLowerCase();
  const rows = [...people.entries()]
    .filter(([key, entry]) => !term || key.includes(term) || (entry.nickname || "").toLowerCase().includes(term))
    .sort(([aKey, a], [bKey, b]) =>
      Number(online.has(bKey)) - Number(online.has(aKey)) || (b.lastSeen || 0) - (a.lastSeen || 0));

  peopleManagerList.innerHTML = "";
  peopleEmpty.hidden = rows.length > 0;
  rows.forEach(([key, entry]) => peopleManagerList.appendChild(managedRow(key, entry, online.has(key))));
}

function managedRow(key, entry, isOnline) {
  const row = document.createElement("div");
  row.className = `managed${entry.blocked ? " blocked" : ""}${isOnline ? " online" : ""}`;
  row.dataset.key = key;

  const avatar = document.createElement("div");
  avatar.className = "avatar managed-avatar";
  paintAvatar(avatar, entry.name, entry.avatar);

  const copy = document.createElement("div");
  copy.className = "managed-copy";
  const name = document.createElement("strong");
  name.textContent = entry.nickname || entry.name;
  const meta = document.createElement("span");
  const tags = [entry.local ? "this computer" : entry.node, isOnline ? "online" : "offline"];
  if (entry.nickname) tags.unshift(`really ${entry.name}`);
  meta.textContent = tags.join(" · ");
  copy.append(name, meta);

  const nickname = document.createElement("input");
  nickname.className = "managed-input";
  nickname.maxLength = 40;
  nickname.placeholder = "Nickname";
  nickname.value = entry.nickname || "";
  nickname.setAttribute("aria-label", `Nickname for ${entry.name}`);
  const commit = () => {
    entry.nickname = nickname.value.trim().slice(0, 40);
    savePeople();
    redrawMessages();
    renderPeopleManager();
  };
  nickname.addEventListener("change", commit);
  nickname.addEventListener("keydown", event => { if (event.key === "Enter") commit(); });

  const actions = document.createElement("div");
  actions.className = "managed-actions";
  actions.append(
    toggleButton(entry.muted ? "Unmute" : "Mute", entry.muted, () => {
      entry.muted = !entry.muted;
      savePeople();
      renderPeopleManager();
      renderPresence(onlineUsers);
    }),
    toggleButton(entry.blocked ? "Unblock" : "Block", entry.blocked, () => {
      entry.blocked = !entry.blocked;
      savePeople();
      redrawMessages();
      renderPeopleManager();
      renderPresence(onlineUsers);
      showToast(entry.blocked ? `${entry.name} is blocked on this computer.` : `${entry.name} is back.`);
    }),
    toggleButton("Forget", false, () => {
      people.delete(key);
      savePeople();
      redrawMessages();
      renderPeopleManager();
    })
  );

  row.append(avatar, copy, nickname, actions);
  return row;
}

function toggleButton(label, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `chip-button${active ? " active" : ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function openPeople(focusKey) {
  peopleModal.hidden = false;
  renderPeopleManager();
  requestAnimationFrame(() => {
    const target = focusKey ? peopleManagerList.querySelector(`[data-key="${CSS.escape(focusKey)}"] .managed-input`) : peopleSearch;
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  });
}

function closePeople() {
  peopleModal.hidden = true;
}

managePeopleButton.addEventListener("click", () => openPeople());
closePeopleModal.addEventListener("click", closePeople);
peopleModal.addEventListener("click", event => { if (event.target === peopleModal) closePeople(); });
peopleSearch.addEventListener("input", renderPeopleManager);

const startedAt = Date.now();
// Discovery usually lands in a couple of seconds; if it has not, the cause is
// almost always a firewall or a network that drops broadcast, so say so instead
// of spinning on "looking…" forever.
const SEARCH_GRACE = 20_000;

let lastNetwork = null;
// Nothing changes on the wire while a node sits alone, so refresh the panel on
// a timer to let the hint appear.
setInterval(() => {
  if (lastNetwork && !meshEmptyEl.hidden) renderNetwork(lastNetwork);
}, 5000);

function searchHint(network, address) {
  if (!network.enabled) return "Peer mesh is switched off.";
  if (Date.now() - startedAt < SEARCH_GRACE) return "Looking for other computers on your network…";
  const here = address && network.port ? `${address}:${network.port}` : "this computer's address";
  return `No one found yet. On the other computer press Add and enter ${here}. `
    + "If that fails too, allow Nova Star through Windows Firewall (UDP 41234, TCP 41235) "
    + "and check both computers are on the same network.";
}

// The mesh panel is the whole point of the app: it shows the other computers
// this node is talking to directly, with no server in between.
function renderNetwork(network) {
  if (!network) return;
  lastNetwork = network;
  meshPort = network.port || null;
  myNode = network.nodeName || myNode;
  const peers = network.peers || [];
  const connected = peers.filter(peer => peer.connected);

  nodeNameEl.textContent = network.nodeName || "–";
  nodeRoomEl.textContent = network.secured ? `${network.room} · locked` : network.room || "–";
  const address = (network.addresses || [])[0];
  nodeAddressEl.textContent = network.enabled && address && network.port ? `${address}:${network.port}` : network.enabled ? "starting…" : "disabled";

  peerCountEl.textContent = String(peers.length);
  meshEmptyEl.hidden = peers.length > 0;
  if (!peers.length) meshEmptyEl.textContent = searchHint(network, address);
  peerListEl.innerHTML = "";
  peers.forEach(peer => {
    const row = document.createElement("div");
    row.className = `peer${peer.connected ? " connected" : ""}`;
    const dot = document.createElement("i");
    const copy = document.createElement("div");
    copy.className = "peer-copy";
    const name = document.createElement("span");
    name.className = "peer-name";
    name.textContent = peer.name;
    const meta = document.createElement("span");
    meta.className = "peer-meta";
    const where = peer.address ? `${peer.address}${peer.port ? `:${peer.port}` : ""}` : "discovered";
    meta.textContent = peer.connected ? `linked · ${where}` : `seen · ${where}`;
    copy.append(name, meta);
    row.append(dot, copy);
    peerListEl.appendChild(row);
  });

  if (!network.enabled) {
    meshStatusEl.className = "connection-pill mesh-pill";
    meshStatusEl.innerHTML = "<i></i>Mesh off";
    conversationSubtitle.textContent = "Local only – peer mesh disabled";
    return;
  }
  meshStatusEl.className = `connection-pill mesh-pill ${connected.length ? "online" : "connecting"}`;
  meshStatusEl.innerHTML = `<i></i>${connected.length ? `${connected.length} node${connected.length === 1 ? "" : "s"} linked` : "Searching"}`;
  conversationSubtitle.textContent = connected.length
    ? `Direct peer-to-peer · ${connected.map(peer => peer.name).join(", ")}`
    : "Direct peer-to-peer · waiting for nodes";
}

function createFileCard(file, messageId) {
  const card = document.createElement("div");
  card.className = "file-card";
  if (messageId) fileCards.set(messageId, card);
  const isImage = file.type?.startsWith("image/") && Boolean(file.url);
  if (isImage) {
    const img = document.createElement("img");
    img.className = "image-preview";
    img.src = file.url;
    img.alt = file.name;
    img.loading = "lazy";
    img.addEventListener("click", () => window.open(file.url, "_blank", "noopener,noreferrer"));
    card.appendChild(img);
  }

  const info = document.createElement("div");
  info.className = "file-info";
  const icon = document.createElement("span");
  icon.className = "file-icon";
  icon.textContent = fileExtension(file.name, isImage ? "IMG" : "FILE");
  const details = document.createElement("div");
  details.className = "file-details";
  const name = document.createElement("strong");
  name.textContent = file.name;
  const size = document.createElement("span");
  size.textContent = `${formatSize(file.size)} · ${isImage ? "Image" : file.type || "File"}`;
  details.append(name, size);
  info.append(icon, details);
  if (file.url) {
    const download = document.createElement("a");
    download.className = "download-button";
    download.href = file.url;
    download.download = file.name;
    download.textContent = "Download";
    info.appendChild(download);
  } else if (file.transfer && messageId) {
    // Big files stay on the sender's computer until somebody wants them, then
    // stream across the direct link in chunks.
    const get = document.createElement("button");
    get.type = "button";
    get.className = "download-button";
    get.textContent = "Get file";
    get.addEventListener("click", () => {
      if (socket?.readyState !== WebSocket.OPEN) return showToast("Chat connection is not ready yet.");
      get.disabled = true;
      get.textContent = "Starting…";
      socket.send(JSON.stringify({ type: "fetch-file", id: messageId }));
    });
    info.appendChild(get);
  } else {
    const note = document.createElement("span");
    note.className = "file-unavailable";
    note.textContent = "Not shared";
    info.appendChild(note);
  }
  card.appendChild(info);

  const progress = document.createElement("div");
  progress.className = "transfer-progress";
  progress.hidden = true;
  const bar = document.createElement("span");
  const label = document.createElement("em");
  progress.append(bar, label);
  card.appendChild(progress);
  card._progress = { wrap: progress, bar, label };
  return card;
}

function updateTransfer(data) {
  const card = fileCards.get(data.id);
  if (!card?._progress) return;
  const { wrap, bar, label } = card._progress;
  wrap.hidden = false;
  if (data.failed) {
    bar.style.width = "100%";
    wrap.classList.add("failed");
    label.textContent = data.message || "Transfer failed.";
    const button = card.querySelector("button.download-button");
    if (button) { button.disabled = false; button.textContent = "Try again"; }
    return;
  }
  wrap.classList.remove("failed");
  const percent = data.size ? Math.min(100, Math.round((data.received / data.size) * 100)) : 0;
  bar.style.width = `${percent}%`;
  label.textContent = data.done ? "Saved on this computer" : `Receiving ${percent}% of ${formatSize(data.size)}`;
}

// The bytes arrived: swap the placeholder card for a real, openable file.
function applyReadyFile(data) {
  const item = transcript.find(message => message.id === data.id);
  if (item) item.file = data.file;
  const card = fileCards.get(data.id);
  if (!card) return;
  const replacement = createFileCard(data.file, data.id);
  card.replaceWith(replacement);
  showToast(`${data.file.name} is ready.`);
}

function fileExtension(name, fallback) {
  const ext = name.includes(".") ? name.split(".").pop().slice(0, 4) : "";
  return (ext || fallback).toUpperCase();
}

fileEl.addEventListener("change", () => {
  addFiles(Array.from(fileEl.files || []));
  fileEl.value = "";
});

function addFiles(files) {
  for (const file of files) {
    if (file.size > maxFileSize) {
      showToast(`${file.name} is larger than ${formatSize(maxFileSize)}.`);
      continue;
    }
    const duplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
    if (!duplicate) selectedFiles.push(file);
  }
  renderFileQueue();
}

function renderFileQueue() {
  fileQueueEl.innerHTML = "";
  selectedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "queue-item";
    const main = document.createElement("div");
    main.className = "queue-main";
    const name = document.createElement("div");
    name.className = "queue-name";
    name.textContent = file.name;
    const meta = document.createElement("div");
    meta.className = "queue-meta";
    meta.textContent = formatSize(file.size);
    const progress = document.createElement("div");
    progress.className = "queue-progress";
    const bar = document.createElement("span");
    progress.appendChild(bar);
    main.append(name, meta, progress);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-file";
    remove.textContent = "×";
    remove.title = "Remove file";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => { selectedFiles.splice(index, 1); renderFileQueue(); });
    item.append(main, remove);
    item.dataset.index = String(index);
    item._progressBar = bar;
    fileQueueEl.appendChild(item);
  });
}

// Keyed by queue position: two files can share a name.
function updateFileProgress(index, percent) {
  const item = fileQueueEl.querySelector(`[data-index="${index}"]`);
  if (item?._progressBar) item._progressBar.style.width = `${percent}%`;
}

for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
  document.addEventListener(eventName, event => { event.preventDefault(); event.stopPropagation(); });
}
for (const eventName of ["dragenter", "dragover"]) composer.addEventListener(eventName, () => dropZone.classList.add("active"));
for (const eventName of ["dragleave", "drop"]) composer.addEventListener(eventName, () => dropZone.classList.remove("active"));
composer.addEventListener("drop", event => addFiles(Array.from(event.dataTransfer.files || [])));

// Pasting a screenshot is the most common way to share an image in a chat app.
textEl.addEventListener("paste", event => {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;
  event.preventDefault();
  addFiles(files);
});

textEl.addEventListener("input", () => {
  autoGrow();
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type:"typing", user:getName(), active:true }));
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:"typing", user:getName(), active:false }));
  }, 700);
});

textEl.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

composer.addEventListener("submit", async event => {
  event.preventDefault();
  if (!socket || socket.readyState !== WebSocket.OPEN) { showToast("Chat connection is not ready yet."); return; }
  const text = textEl.value.trim();
  if (!text && selectedFiles.length === 0) return;
  sendButton.disabled = true;
  try {
    const queued = selectedFiles;
    const uploadedFiles = [];
    for (const [index, file] of queued.entries()) uploadedFiles.push(await uploadFile(file, index));
    if (!uploadedFiles.length) sendMessage(text, null);
    else uploadedFiles.forEach((file, index) => sendMessage(index === 0 ? text : "", file));
    textEl.value = "";
    selectedFiles = [];
    renderFileQueue();
    autoGrow();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not send the file.");
  } finally { sendButton.disabled = false; textEl.focus(); }
});

function sendMessage(text, file) {
  socket.send(JSON.stringify({ type:"message", user:getName(), text, file, avatar:selectedAvatar }));
}

function uploadFile(file, index) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-File-Name", file.name);
    if (ACCESS_TOKEN) xhr.setRequestHeader("X-Access-Token", ACCESS_TOKEN);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) updateFileProgress(index, Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Invalid upload response.")); }
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).error)); }
        catch { reject(new Error("File upload failed.")); }
      }
    };
    xhr.onerror = () => reject(new Error("Network error during file upload."));
    xhr.send(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
}

function autoGrow() {
  textEl.style.height = "auto";
  textEl.style.height = `${Math.min(textEl.scrollHeight, 150)}px`;
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  isNearBottom = true;
  newMessagesButton.classList.remove("visible");
}

messagesEl.addEventListener("scroll", () => {
  isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  if (isNearBottom) newMessagesButton.classList.remove("visible");
});
newMessagesButton.addEventListener("click", scrollBottom);
scrollButton.addEventListener("click", scrollBottom);

let profileOpener = null;

function openProfile() {
  profileOpener = document.activeElement;
  nameEl.value = getName();
  selectedAvatar = localStorage.getItem("chat-avatar") || "";
  renderAvatarPicker();
  profileModal.hidden = false;
  requestAnimationFrame(() => { nameEl.focus(); nameEl.select(); });
}

function closeProfileModal() {
  if (profileModal.hidden) return;
  profileModal.hidden = true;
  if (profileOpener instanceof HTMLElement) profileOpener.focus();
}

profileButton.addEventListener("click", openProfile);
closeProfile.addEventListener("click", closeProfileModal);
profileModal.addEventListener("click", event => { if (event.target === profileModal) closeProfileModal(); });

// Keep Tab inside the dialog while it is open.
profileModal.addEventListener("keydown", event => {
  if (event.key !== "Tab") return;
  const focusable = profileModal.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])");
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

saveProfile.addEventListener("click", () => {
  const nextName = nameEl.value.trim().slice(0, 40);
  localStorage.setItem("chat-name", nextName);
  localStorage.setItem("chat-avatar", selectedAvatar);
  updateProfileUI();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "profile", user: getName(), avatar: selectedAvatar }));
  }
  closeProfileModal();
  showToast("Profile updated.");
});

function openPeerModal() {
  peerPortInput.value = peerPortInput.value || String(meshPort || 41235);
  peerModal.hidden = false;
  requestAnimationFrame(() => peerAddressInput.focus());
}

function closePeerDialog() {
  peerModal.hidden = true;
}

addPeerButton.addEventListener("click", openPeerModal);
closePeerModal.addEventListener("click", closePeerDialog);
peerModal.addEventListener("click", event => { if (event.target === peerModal) closePeerDialog(); });
peerAddressInput.addEventListener("keydown", event => { if (event.key === "Enter") dialPeerButton.click(); });
peerPortInput.addEventListener("keydown", event => { if (event.key === "Enter") dialPeerButton.click(); });

dialPeerButton.addEventListener("click", () => {
  const address = peerAddressInput.value.trim();
  const port = Number(peerPortInput.value.trim());
  if (!address || !Number.isInteger(port)) {
    showToast("Enter an address and a port.");
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN) {
    showToast("Chat connection is not ready yet.");
    return;
  }
  socket.send(JSON.stringify({ type: "connect-peer", address, port }));
  peerAddressInput.value = "";
  closePeerDialog();
});

const savedTheme = localStorage.getItem("chat-theme");
if (savedTheme === "light") document.body.classList.add("light");
updateThemeIcon();
themeButton.addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("chat-theme", document.body.classList.contains("light") ? "light" : "dark");
  updateThemeIcon();
});
function updateThemeIcon() { themeButton.textContent = document.body.classList.contains("light") ? "☀" : "☾"; }

function renderEmojiPanel() {
  emojiPanel.innerHTML = "";
  EMOJIS.forEach(emoji => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-option";
    button.textContent = emoji;
    button.addEventListener("click", () => insertEmoji(emoji));
    emojiPanel.appendChild(button);
  });
}

function insertEmoji(emoji) {
  const start = textEl.selectionStart ?? textEl.value.length;
  const end = textEl.selectionEnd ?? textEl.value.length;
  textEl.value = `${textEl.value.slice(0, start)}${emoji}${textEl.value.slice(end)}`;
  const caret = start + emoji.length;
  textEl.focus();
  textEl.setSelectionRange(caret, caret);
  autoGrow();
}

function toggleEmojiPanel(force) {
  const open = typeof force === "boolean" ? force : emojiPanel.hidden;
  emojiPanel.hidden = !open;
  emojiButton.classList.toggle("active", open);
  emojiButton.setAttribute("aria-expanded", String(open));
}

emojiButton.addEventListener("click", event => { event.stopPropagation(); toggleEmojiPanel(); });
emojiPanel.addEventListener("click", event => event.stopPropagation());
document.addEventListener("click", () => toggleEmojiPanel(false));
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!emojiPanel.hidden) toggleEmojiPanel(false);
  else if (!peerModal.hidden) closePeerDialog();
  else if (!peopleModal.hidden) closePeople();
  else closeProfileModal();
});
renderEmojiPanel();

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

window.addEventListener("beforeunload", () => {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  if (socket) socket.close();
});

updateCount();
connect();
autoGrow();
