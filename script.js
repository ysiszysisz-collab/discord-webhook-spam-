const DISCORD_MESSAGE_LIMIT = 2000;
const STORAGE_KEYS = {
  settings: "webhookMessenger.settings",
  history: "webhookMessenger.history"
};

const setupView = document.getElementById("setupView");
const messengerView = document.getElementById("messengerView");
const setupForm = document.getElementById("setupForm");
const messageForm = document.getElementById("messageForm");
const editSetupBtn = document.getElementById("editSetupBtn");
const clearLogBtn = document.getElementById("clearLogBtn");
const sendBtn = document.getElementById("sendBtn");

const webhookInput = document.getElementById("webhook");
const usernameInput = document.getElementById("username");
const avatarInput = document.getElementById("avatar");
const rememberSetupInput = document.getElementById("rememberSetup");
const messageInput = document.getElementById("message");

const setupStatus = document.getElementById("setupStatus");
const statusBox = document.getElementById("status");
const messageLog = document.getElementById("messageLog");
const botNameLabel = document.getElementById("botNameLabel");
const webhookMeta = document.getElementById("webhookMeta");
const botAvatar = document.getElementById("botAvatar");
const avatarPreview = document.getElementById("avatarPreview");
const previewAvatar = document.getElementById("previewAvatar");
const previewName = document.getElementById("previewName");
const previewWebhook = document.getElementById("previewWebhook");
const previewMessage = document.getElementById("previewMessage");
const savedCount = document.getElementById("savedCount");
const messageCount = document.getElementById("messageCount");
const lastMessageTime = document.getElementById("lastMessageTime");
const charCounter = document.getElementById("charCounter");

let webhookSettings = {
  webhook: "",
  username: "",
  avatar: "",
  remember: false
};

let sentMessages = loadHistory();
let activeSendId = null;

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");

    if (!Array.isArray(saved)) {
      return [];
    }

    return saved
      .filter((entry) => entry && typeof entry.message === "string")
      .map((entry) => ({
        id: entry.id || makeId(),
        username: entry.username || "Bot sender",
        message: entry.message,
        timestamp: Number(entry.timestamp) || Date.now(),
        status: entry.status === "sent" || entry.status === "failed" ? entry.status : "failed",
        error: entry.status === "sending" ? "This send was interrupted." : entry.error || ""
      }));
  } catch {
    return [];
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "null");
    return saved && typeof saved === "object" ? saved : null;
  } catch {
    return null;
  }
}

function persistHistory() {
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(sentMessages.slice(-100)));
  savedCount.textContent = String(sentMessages.length);
}

function persistSettings() {
  if (webhookSettings.remember) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(webhookSettings));
  } else {
    localStorage.removeItem(STORAGE_KEYS.settings);
  }
}

function isValidUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isDiscordWebhook(value) {
  if (!isValidUrl(value)) {
    return false;
  }

  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return (host === "discord.com" || host === "discordapp.com") && url.pathname.startsWith("/api/webhooks/");
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `status ${type}`.trim();
}

function makeId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";
}

function applyAvatar(target, url, fallbackText) {
  target.textContent = fallbackText;
  target.style.backgroundImage = "";

  if (url) {
    target.textContent = "";
    target.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
  }
}

function maskWebhook(value) {
  if (!value) {
    return "Webhook not connected";
  }

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[2] || "";
    const shortId = id.length > 8 ? `${id.slice(0, 4)}...${id.slice(-4)}` : "ready";
    return `${url.hostname} / ${shortId}`;
  } catch {
    return "Webhook ready";
  }
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function formatFullTime(timestamp) {
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function updateAvatarPreview() {
  const name = usernameInput.value.trim() || "Bot name";
  const avatar = avatarInput.value.trim();
  const usableAvatar = isValidUrl(avatar) ? avatar : "";
  const initials = getInitials(name);

  applyAvatar(avatarPreview, usableAvatar, initials);
  applyAvatar(previewAvatar, usableAvatar, initials);
  previewName.textContent = name;
  previewWebhook.textContent = maskWebhook(webhookInput.value.trim());
}

function updateCharCounter() {
  const length = messageInput.value.length;
  charCounter.textContent = `${length} / ${DISCORD_MESSAGE_LIMIT}`;
  charCounter.classList.toggle("is-full", length >= DISCORD_MESSAGE_LIMIT);
}

function updateSummary() {
  const total = sentMessages.length;
  const lastMessage = sentMessages[total - 1];

  savedCount.textContent = String(total);
  messageCount.textContent = `${total} ${total === 1 ? "message" : "messages"}`;
  lastMessageTime.textContent = lastMessage
    ? `Last message: ${formatFullTime(lastMessage.timestamp)}`
    : "Nothing sent yet";
  clearLogBtn.disabled = total === 0;
}

function showMessenger() {
  setupView.classList.add("is-hidden");
  messengerView.classList.remove("is-hidden");
  botNameLabel.textContent = webhookSettings.username;
  webhookMeta.textContent = maskWebhook(webhookSettings.webhook);
  applyAvatar(botAvatar, webhookSettings.avatar, getInitials(webhookSettings.username));
  renderLog();
  updateCharCounter();
  messageInput.focus();
}

function showSetup() {
  messengerView.classList.add("is-hidden");
  setupView.classList.remove("is-hidden");
  setStatus(statusBox, "");
  updateAvatarPreview();
  webhookInput.focus();
}

function buildEmptyState() {
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";

  const title = document.createElement("strong");
  title.textContent = "No messages yet";

  const subtitle = document.createElement("span");
  subtitle.textContent = "Sent messages will appear here.";

  emptyState.append(title, subtitle);
  return emptyState;
}

function buildLogEntry(entry) {
  const article = document.createElement("article");
  article.className = `log-entry ${entry.status}`;

  const meta = document.createElement("div");
  meta.className = "log-meta";

  const name = document.createElement("strong");
  name.textContent = entry.username;

  const time = document.createElement("time");
  time.dateTime = new Date(entry.timestamp).toISOString();
  time.textContent = formatTime(entry.timestamp);

  meta.append(name, time);

  const message = document.createElement("p");
  message.textContent = entry.message;

  const state = document.createElement("span");
  state.className = `log-state ${entry.status}`;
  state.textContent = entry.status === "sending"
    ? "Sending"
    : entry.status === "sent"
      ? "Sent"
      : "Failed";

  const actions = document.createElement("div");
  actions.className = "log-actions";

  const copyButton = document.createElement("button");
  copyButton.className = "mini-btn";
  copyButton.type = "button";
  copyButton.dataset.action = "copy";
  copyButton.dataset.id = entry.id;
  copyButton.textContent = "Copy";

  const resendButton = document.createElement("button");
  resendButton.className = "mini-btn";
  resendButton.type = "button";
  resendButton.dataset.action = "resend";
  resendButton.dataset.id = entry.id;
  resendButton.textContent = "Resend";
  resendButton.disabled = entry.status === "sending";

  actions.append(copyButton, resendButton);
  article.append(meta, message, state, actions);

  if (entry.error) {
    const error = document.createElement("small");
    error.className = "entry-error";
    error.textContent = entry.error;
    article.append(error);
  }

  return article;
}

function renderLog() {
  messageLog.replaceChildren();

  if (!sentMessages.length) {
    messageLog.append(buildEmptyState());
    updateSummary();
    return;
  }

  const fragment = document.createDocumentFragment();
  sentMessages.forEach((entry) => fragment.append(buildLogEntry(entry)));
  messageLog.append(fragment);
  messageLog.scrollTop = messageLog.scrollHeight;
  updateSummary();
}

function addLogEntry(message) {
  const entry = {
    id: makeId(),
    username: webhookSettings.username,
    message,
    timestamp: Date.now(),
    status: "sending",
    error: ""
  };

  sentMessages.push(entry);
  activeSendId = entry.id;
  renderLog();
  persistHistory();
  return entry.id;
}

function updateLogEntry(id, updates) {
  sentMessages = sentMessages.map((entry) => (
    entry.id === id ? { ...entry, ...updates } : entry
  ));
  renderLog();
  persistHistory();
}

function validateSetup() {
  const webhook = webhookInput.value.trim();
  const username = usernameInput.value.trim();
  const avatar = avatarInput.value.trim();

  if (!isDiscordWebhook(webhook)) {
    setStatus(setupStatus, "Enter a valid Discord webhook URL.", "error");
    webhookInput.focus();
    return null;
  }

  if (!username) {
    setStatus(setupStatus, "Choose a bot name.", "error");
    usernameInput.focus();
    return null;
  }

  if (avatar && !isValidUrl(avatar)) {
    setStatus(setupStatus, "Profile picture needs to be a valid HTTPS URL.", "error");
    avatarInput.focus();
    return null;
  }

  return {
    webhook,
    username,
    avatar,
    remember: rememberSetupInput.checked
  };
}

async function sendMessage(message, options = {}) {
  if (!webhookSettings.webhook) {
    setStatus(statusBox, "Set up a webhook before sending.", "error");
    showSetup();
    return;
  }

  if (!message.trim()) {
    setStatus(statusBox, "Type a message before sending.", "error");
    return;
  }

  if (message.length > DISCORD_MESSAGE_LIMIT) {
    setStatus(statusBox, "Discord messages can be up to 2000 characters.", "error");
    return;
  }

  const entryId = addLogEntry(message.trim());
  const originalText = messageInput.value;

  setStatus(statusBox, "Sending...");
  sendBtn.disabled = true;
  messageInput.disabled = true;

  try {
    const response = await fetch(webhookSettings.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: webhookSettings.username,
        avatar_url: webhookSettings.avatar || undefined,
        content: message.trim()
      })
    });

    if (response.ok) {
      updateLogEntry(entryId, { status: "sent", error: "" });
      setStatus(statusBox, "Message sent successfully.", "success");

      if (!options.keepComposerText) {
        messageInput.value = "";
        updateCharCounter();
      }
    } else {
      updateLogEntry(entryId, {
        status: "failed",
        error: `Discord responded with ${response.status}.`
      });
      setStatus(statusBox, "Discord rejected the message. Check the webhook.", "error");
      messageInput.value = originalText;
    }
  } catch (error) {
    updateLogEntry(entryId, {
      status: "failed",
      error: error.message
    });
    setStatus(statusBox, `Error: ${error.message}`, "error");
    messageInput.value = originalText;
  } finally {
    activeSendId = null;
    sendBtn.disabled = false;
    messageInput.disabled = false;
    updateCharCounter();
    messageInput.focus();
  }
}

async function copyMessage(id) {
  const entry = sentMessages.find((item) => item.id === id);
  if (!entry) {
    return;
  }

  try {
    await navigator.clipboard.writeText(entry.message);
    setStatus(statusBox, "Message copied.", "success");
  } catch {
    setStatus(statusBox, "Copy failed in this browser.", "error");
  }
}

function clearLog() {
  sentMessages = [];
  localStorage.removeItem(STORAGE_KEYS.history);
  renderLog();
  setStatus(statusBox, "Log cleared.", "success");
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const nextSettings = validateSetup();
  if (!nextSettings) {
    return;
  }

  webhookSettings = nextSettings;
  persistSettings();
  setStatus(setupStatus, "");
  showMessenger();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

messageInput.addEventListener("input", () => {
  updateCharCounter();
  previewMessage.textContent = messageInput.value.trim() || "Your message will appear in the log after sending.";
});

messageLog.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || activeSendId) {
    return;
  }

  const { action, id } = button.dataset;
  const entry = sentMessages.find((item) => item.id === id);

  if (!entry) {
    return;
  }

  if (action === "copy") {
    copyMessage(id);
  }

  if (action === "resend") {
    sendMessage(entry.message, { keepComposerText: true });
  }
});

clearLogBtn.addEventListener("click", clearLog);
editSetupBtn.addEventListener("click", showSetup);

[webhookInput, usernameInput, avatarInput].forEach((input) => {
  input.addEventListener("input", updateAvatarPreview);
});

const savedSettings = loadSettings();

if (savedSettings) {
  webhookSettings = {
    webhook: savedSettings.webhook || "",
    username: savedSettings.username || "",
    avatar: savedSettings.avatar || "",
    remember: Boolean(savedSettings.remember)
  };

  webhookInput.value = webhookSettings.webhook;
  usernameInput.value = webhookSettings.username;
  avatarInput.value = webhookSettings.avatar;
  rememberSetupInput.checked = webhookSettings.remember;
}

persistHistory();
updateAvatarPreview();
renderLog();

if (savedSettings && isDiscordWebhook(webhookSettings.webhook) && webhookSettings.username) {
  showMessenger();
}
