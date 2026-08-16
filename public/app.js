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

// The desktop shell passes a per-launch token; the server rejects sockets and
// uploads without it.
const ACCESS_TOKEN = new URLSearchParams(location.search).get("token") || "";

let maxFileSize = 100 * 1024 * 1024;

// Sample avatars everyone can pick from (no image files needed).
const AVATARS = [
  { id: "fox",     emoji: "🦊", bg: "linear-gradient(145deg,#ffb257,#f4762a)" },
  { id: "cat",     emoji: "🐱", bg: "linear-gradient(145deg,#ffd76e,#f5a623)" },
  { id: "panda",   emoji: "🐼", bg: "linear-gradient(145deg,#e7ecf5,#aab6c8)" },
  { id: "koala",   emoji: "🐨", bg: "linear-gradient(145deg,#b8c6da,#8496b0)" },
  { id: "frog",    emoji: "🐸", bg: "linear-gradient(145deg,#7fe08a,#35b26a)" },
  { id: "owl",     emoji: "🦉", bg: "linear-gradient(145deg,#c0a68a,#8a6b4f)" },
  { id: "penguin", emoji: "🐧", bg: "linear-gradient(145deg,#9fb4ff,#4d6fe0)" },
  { id: "unicorn", emoji: "🦄", bg: "linear-gradient(145deg,#f7a8ff,#a86bff)" },
  { id: "robot",   emoji: "🤖", bg: "linear-gradient(145deg,#8fd7ff,#3a8fd6)" },
  { id: "alien",   emoji: "👽", bg: "linear-gradient(145deg,#9df5d0,#2fbf94)" },
  { id: "ninja",   emoji: "🥷", bg: "linear-gradient(145deg,#5b6577,#2d3440)" },
  { id: "astro",   emoji: "🧑‍🚀", bg: "linear-gradient(145deg,#7f9cff,#3d55c9)" },
  { id: "ghost",   emoji: "👻", bg: "linear-gradient(145deg,#dfe6f5,#a6b2cd)" },
  { id: "dragon",  emoji: "🐲", bg: "linear-gradient(145deg,#7be3b6,#20a37a)" },
  { id: "rocket",  emoji: "🚀", bg: "linear-gradient(145deg,#ff8fa3,#e0455f)" },
  { id: "star",    emoji: "⭐", bg: "linear-gradient(145deg,#ffe27a,#f2b705)" }
];

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
const renderedIds = new Set();
const typingUsers = new Map();

const storedName = localStorage.getItem("chat-name") || "";
nameEl.value = storedName;
renderAvatarPicker();
updateProfileUI();

function getName() {
  return nameEl.value.trim() || "Guest";
}

function getAvatar(id) {
  return AVATARS.find(item => item.id === id) || null;
}

function paintAvatar(element, name, avatarId) {
  const preset = getAvatar(avatarId);
  if (preset) {
    element.textContent = preset.emoji;
    element.style.background = preset.bg;
    element.classList.add("avatar-emoji");
  } else {
    element.textContent = initials(name);
    element.style.background = "";
    element.classList.remove("avatar-emoji");
  }
}

function renderAvatarPicker() {
  if (!avatarGrid) return;
  avatarGrid.innerHTML = "";
  AVATARS.forEach(item => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `avatar-option${item.id === selectedAvatar ? " selected" : ""}`;
    option.style.background = item.bg;
    option.textContent = item.emoji;
    option.title = item.id;
    option.setAttribute("aria-label", `Use ${item.id} avatar`);
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
    } else if (data.type === "history") {
      const known = renderedIds.size > 0;
      const incoming = known ? data.messages.filter(item => !renderedIds.has(item.id)) : data.messages;
      if (!known) resetMessages();
      incoming.forEach(renderMessage);
      messageCount = renderedIds.size;
      updateCount();
      if (!known || isNearBottom) requestAnimationFrame(scrollBottom);
    } else if (data.type === "message") {
      if (renderedIds.has(data.id)) return;
      renderMessage(data);
      messageCount++;
      updateCount();
      if (!isMine(data)) announce(`${data.user} said ${data.text || "sent a file"}`);
      if (isNearBottom) scrollBottom();
      else newMessagesButton.classList.add("visible");
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
  messageCountEl.textContent = messageCount > 999 ? "999+" : String(messageCount);
  emptyStateEl.hidden = messageCount > 0;
}

function resetMessages() {
  messagesEl.innerHTML = "";
  renderedIds.clear();
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
  user.textContent = message.user;
  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = formatTime(message.time);
  head.append(user, time);
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

  if (message.file) content.appendChild(createFileCard(message.file));
  row.appendChild(content);
  messagesEl.appendChild(row);
  lastRenderedUser = message.clientId || message.user;
}

function updateTyping(data) {
  if (data.clientId === clientId) return;
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
  presenceCountEl.textContent = String(users.length);
  peopleListEl.innerHTML = "";
  users.forEach(person => {
    const row = document.createElement("div");
    row.className = "person";
    const avatar = document.createElement("div");
    avatar.className = "avatar person-avatar";
    paintAvatar(avatar, person.user, person.avatar);
    const name = document.createElement("span");
    name.className = "person-name";
    name.textContent = person.id === clientId ? `${person.user} (you)` : person.user;
    row.append(avatar, name);
    peopleListEl.appendChild(row);
  });
}

function createFileCard(file) {
  const card = document.createElement("div");
  card.className = "file-card";
  const isImage = file.type?.startsWith("image/");
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
  const download = document.createElement("a");
  download.className = "download-button";
  download.href = file.url;
  download.download = file.name;
  download.textContent = "Download";
  info.append(icon, details, download);
  card.appendChild(info);
  return card;
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
