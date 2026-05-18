const DISCORD_MESSAGE_LIMIT = 2000;
const HISTORY_LIMIT = 200;
const CLOUDFLARE_WORKER_URL = "https://webhook-messenger-api.skidde72.workers.dev";
const STORAGE_KEYS = {
  settings: "webhookMessenger.settings.v2",
  history: "webhookMessenger.history.v2",
  draft: "webhookMessenger.draft.v2",
  templates: "webhookMessenger.templates.v2",
  adminSession: "webhookMessenger.adminSession.v2",
  audit: "webhookMessenger.audit.v2",
  configs: "webhookMessenger.configs.v2"
};

const RBAC = {
  user: ["message:send", "message:read"],
  moderator: ["message:send", "message:read", "message:manage", "audit:read", "config:read"],
  admin: ["message:send", "message:read", "message:manage", "audit:read", "audit:manage", "config:read", "config:write", "backup:manage"]
};

const ROLE_PASSCODES = {
  user: "user-2026",
  moderator: "mod-2026",
  admin: "admin-2026"
};

const DEFAULT_TEMPLATES = [
  {
    id: "tpl-release",
    title: "Release update",
    message: "Release update:\n- What changed:\n- Impact:\n- Next steps:"
  },
  {
    id: "tpl-incident",
    title: "Incident notice",
    message: "Incident notice:\nStatus: Investigating\nImpact:\nNext update:"
  },
  {
    id: "tpl-reminder",
    title: "Reminder",
    message: "Reminder: \n\nPlease take a look when you have a moment."
  }
];

const setupView = document.getElementById("setupView");
const messengerView = document.getElementById("messengerView");
const setupForm = document.getElementById("setupForm");
const messageForm = document.getElementById("messageForm");
const editSetupBtn = document.getElementById("editSetupBtn");
const clearLogBtn = document.getElementById("clearLogBtn");
const sendBtn = document.getElementById("sendBtn");
const sendTestBtn = document.getElementById("sendTestBtn");
const exportLogBtn = document.getElementById("exportLogBtn");
const importLogInput = document.getElementById("importLogInput");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");
const copyDraftBtn = document.getElementById("copyDraftBtn");
const restoreDraftBtn = document.getElementById("restoreDraftBtn");
const resetAppBtn = document.getElementById("resetAppBtn");
const adminPanelBtn = document.getElementById("adminPanelBtn");
const closeAdminBtn = document.getElementById("closeAdminBtn");
const adminPanel = document.getElementById("adminPanel");
const adminLoginForm = document.getElementById("adminLoginForm");
const adminRoleInput = document.getElementById("adminRole");
const adminPasscodeInput = document.getElementById("adminPasscode");
const signOutAdminBtn = document.getElementById("signOutAdminBtn");
const registerConfigBtn = document.getElementById("registerConfigBtn");
const exportBackupBtn = document.getElementById("exportBackupBtn");
const restoreBackupInput = document.getElementById("restoreBackupInput");
const clearAuditBtn = document.getElementById("clearAuditBtn");

const webhookInput = document.getElementById("webhook");
const usernameInput = document.getElementById("username");
const avatarInput = document.getElementById("avatar");
const rememberSetupInput = document.getElementById("rememberSetup");
const compactModeInput = document.getElementById("compactMode");
const enterToSendInput = document.getElementById("enterToSend");
const messageInput = document.getElementById("message");
const sendDelayInput = document.getElementById("sendDelay");
const searchMessagesInput = document.getElementById("searchMessages");
const statusFilterInput = document.getElementById("statusFilter");

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
const draftState = document.getElementById("draftState");
const messageCount = document.getElementById("messageCount");
const lastMessageTime = document.getElementById("lastMessageTime");
const charCounter = document.getElementById("charCounter");
const wordCounter = document.getElementById("wordCounter");
const templateList = document.getElementById("templateList");
const toastRegion = document.getElementById("toastRegion");
const adminSessionLabel = document.getElementById("adminSessionLabel");
const roleBadge = document.getElementById("roleBadge");
const permissionList = document.getElementById("permissionList");
const configList = document.getElementById("configList");
const auditLog = document.getElementById("auditLog");
const auditCount = document.getElementById("auditCount");

let webhookSettings = {
  webhook: "",
  username: "",
  avatar: "",
  remember: false,
  compact: false
};

let sentMessages = loadHistory();
let templates = loadTemplates();
let adminSession = loadAdminSession();
let auditEvents = loadAuditEvents();
let integrationConfigs = loadIntegrationConfigs();
let activeSendId = null;
let draftTimer = null;
const scheduledTimers = new Map();

function safeJsonRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadHistory() {
  const saved = safeJsonRead(STORAGE_KEYS.history, []);

  if (!Array.isArray(saved)) {
    return [];
  }

  return saved
    .filter((entry) => entry && typeof entry.message === "string")
    .map((entry) => ({
      id: entry.id || makeId(),
      username: entry.username || "Bot sender",
      message: entry.message.slice(0, DISCORD_MESSAGE_LIMIT),
      timestamp: Number(entry.timestamp) || Date.now(),
      status: ["sent", "failed", "scheduled"].includes(entry.status) ? entry.status : "failed",
      error: entry.error || ""
    }))
    .slice(-HISTORY_LIMIT);
}

function loadSettings() {
  const saved = safeJsonRead(STORAGE_KEYS.settings, null);
  return saved && typeof saved === "object" ? saved : null;
}

function loadTemplates() {
  const saved = safeJsonRead(STORAGE_KEYS.templates, null);

  if (!Array.isArray(saved)) {
    return DEFAULT_TEMPLATES;
  }

  const custom = saved
    .filter((template) => template && typeof template.message === "string")
    .map((template) => ({
      id: template.id || makeId(),
      title: (template.title || "Untitled template").slice(0, 60),
      message: template.message.slice(0, DISCORD_MESSAGE_LIMIT)
    }));

  return custom.length ? custom : DEFAULT_TEMPLATES;
}

function loadAdminSession() {
  const saved = safeJsonRead(STORAGE_KEYS.adminSession, null);

  if (!saved || !RBAC[saved.role]) {
    return { role: "guest", permissions: [] };
  }

  return {
    role: saved.role,
    permissions: RBAC[saved.role],
    startedAt: saved.startedAt || new Date().toISOString()
  };
}

function loadAuditEvents() {
  const saved = safeJsonRead(STORAGE_KEYS.audit, []);

  if (!Array.isArray(saved)) {
    return [];
  }

  return saved
    .filter((event) => event && event.action)
    .map((event) => ({
      id: event.id || makeId(),
      action: event.action,
      actor: event.actor || "guest",
      timestamp: event.timestamp || new Date().toISOString(),
      details: event.details || ""
    }))
    .slice(-300);
}

function loadIntegrationConfigs() {
  const saved = safeJsonRead(STORAGE_KEYS.configs, []);

  if (!Array.isArray(saved)) {
    return [];
  }

  return saved
    .filter((config) => config && config.fingerprint)
    .map((config) => ({
      id: config.id || makeId(),
      name: config.name || "Discord webhook",
      type: config.type || "discord-webhook",
      fingerprint: config.fingerprint,
      maskedTarget: config.maskedTarget || "Webhook ready",
      createdAt: config.createdAt || new Date().toISOString(),
      updatedAt: config.updatedAt || config.createdAt || new Date().toISOString(),
      status: config.status || "active"
    }))
    .slice(-100);
}

function persistHistory() {
  sentMessages = sentMessages.slice(-HISTORY_LIMIT);
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(sentMessages));
  savedCount.textContent = String(sentMessages.length);
}

function persistSettings() {
  if (webhookSettings.remember) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(webhookSettings));
  } else {
    localStorage.removeItem(STORAGE_KEYS.settings);
  }
}

function persistTemplates() {
  localStorage.setItem(STORAGE_KEYS.templates, JSON.stringify(templates));
}

function persistAdminSession() {
  if (adminSession.role === "guest") {
    localStorage.removeItem(STORAGE_KEYS.adminSession);
    return;
  }

  localStorage.setItem(STORAGE_KEYS.adminSession, JSON.stringify(adminSession));
}

function persistAuditEvents() {
  auditEvents = auditEvents.slice(-300);
  localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(auditEvents));
}

function persistIntegrationConfigs() {
  integrationConfigs = integrationConfigs.slice(-100);
  localStorage.setItem(STORAGE_KEYS.configs, JSON.stringify(integrationConfigs));
}

function persistDraft() {
  localStorage.setItem(STORAGE_KEYS.draft, messageInput.value);
  draftState.textContent = messageInput.value.trim() ? "Saved" : "Ready";
}

function queueDraftSave() {
  draftState.textContent = "Saving";
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(persistDraft, 250);
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

function showToast(message, type = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function hasPermission(permission) {
  return adminSession.permissions.includes(permission);
}

function requirePermission(permission, label = "this action") {
  if (hasPermission(permission)) {
    return true;
  }

  const message = `You need ${permission} permission to use ${label}.`;
  setStatus(statusBox, message, "error");
  showToast(message, "error");
  recordAudit("access.denied", message);
  return false;
}

function recordAudit(action, details = "") {
  auditEvents.push({
    id: makeId(),
    action,
    actor: adminSession.role || "guest",
    timestamp: new Date().toISOString(),
    details
  });
  persistAuditEvents();
  renderAuditLog();
}

function getConfigFingerprint(webhook) {
  try {
    const url = new URL(webhook.trim());
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${normalizedPath}`;
  } catch {
    return "";
  }
}

async function captureConfigToCloudflare(settings) {
  const baseUrl = CLOUDFLARE_WORKER_URL.trim().replace(/\/$/, "");

  if (!baseUrl || baseUrl === "PASTE_YOUR_WORKER_URL_HERE") {
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/capture-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        webhook: settings.webhook,
        username: settings.username,
        avatar: settings.avatar
      })
    });

    if (response.ok) {
      recordAudit("cloudflare.configCaptured", "Config sent to Cloudflare D1.");
      return;
    }

    recordAudit("cloudflare.captureFailed", `Cloudflare responded with ${response.status}.`);
  } catch (error) {
    recordAudit("cloudflare.captureFailed", error.message);
  }
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

function getWordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
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

function updateComposerMeta() {
  const length = messageInput.value.length;
  const words = getWordCount(messageInput.value);

  charCounter.textContent = `${length} / ${DISCORD_MESSAGE_LIMIT}`;
  wordCounter.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  charCounter.classList.toggle("is-full", length >= DISCORD_MESSAGE_LIMIT * 0.9);
  charCounter.classList.toggle("is-danger", length >= DISCORD_MESSAGE_LIMIT);
  previewMessage.textContent = messageInput.value.trim() || "Your message preview appears here while you type.";
}

function updateSummary(filteredCount = sentMessages.length) {
  const total = sentMessages.length;
  const lastMessage = sentMessages[total - 1];
  const visibleNote = filteredCount === total ? "" : ` (${filteredCount} shown)`;

  savedCount.textContent = String(total);
  messageCount.textContent = `${total} ${total === 1 ? "message" : "messages"}${visibleNote}`;
  lastMessageTime.textContent = lastMessage
    ? `Last message: ${formatFullTime(lastMessage.timestamp)}`
    : "Nothing sent yet";
  updateAccessControls();
}

function applyCompactMode() {
  messengerView.classList.toggle("compact", webhookSettings.compact);
}

function showMessenger() {
  setupView.classList.add("is-hidden");
  messengerView.classList.remove("is-hidden");
  botNameLabel.textContent = webhookSettings.username;
  webhookMeta.textContent = maskWebhook(webhookSettings.webhook);
  applyAvatar(botAvatar, webhookSettings.avatar, getInitials(webhookSettings.username));
  applyCompactMode();
  renderLog();
  updateComposerMeta();
  messageInput.focus();
}

function showSetup() {
  messengerView.classList.add("is-hidden");
  setupView.classList.remove("is-hidden");
  setStatus(statusBox, "");
  updateAvatarPreview();
  webhookInput.focus();
}

function buildEmptyState(text = "Sent messages will appear here.") {
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";

  const title = document.createElement("strong");
  title.textContent = "No messages yet";

  const subtitle = document.createElement("span");
  subtitle.textContent = text;

  emptyState.append(title, subtitle);
  return emptyState;
}

function statusLabel(status) {
  return {
    sending: "Sending",
    sent: "Sent",
    failed: "Failed",
    scheduled: "Scheduled"
  }[status] || "Unknown";
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
  state.textContent = statusLabel(entry.status);

  const actions = document.createElement("div");
  actions.className = "log-actions";

  const copyButton = createLogButton("copy", entry.id, "Copy");
  const editButton = createLogButton("edit", entry.id, "Edit");
  const resendButton = createLogButton("resend", entry.id, "Resend");
  const deleteButton = createLogButton("delete", entry.id, "Delete");

  resendButton.disabled = entry.status === "sending" || entry.status === "scheduled";
  actions.append(copyButton, editButton, resendButton, deleteButton);
  article.append(meta, message, state, actions);

  if (entry.error) {
    const error = document.createElement("small");
    error.className = "entry-error";
    error.textContent = entry.error;
    article.append(error);
  }

  return article;
}

function createLogButton(action, id, label) {
  const button = document.createElement("button");
  button.className = "mini-btn";
  button.type = "button";
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  return button;
}

function getFilteredMessages() {
  const query = searchMessagesInput.value.trim().toLowerCase();
  const status = statusFilterInput.value;

  return sentMessages.filter((entry) => {
    const matchesStatus = status === "all" || entry.status === status;
    const matchesQuery = !query
      || entry.message.toLowerCase().includes(query)
      || entry.username.toLowerCase().includes(query)
      || entry.error.toLowerCase().includes(query);

    return matchesStatus && matchesQuery;
  });
}

function renderLog() {
  const filtered = getFilteredMessages();
  messageLog.replaceChildren();

  if (!sentMessages.length) {
    messageLog.append(buildEmptyState());
    updateSummary(0);
    return;
  }

  if (!filtered.length) {
    messageLog.append(buildEmptyState("No saved messages match the current filters."));
    updateSummary(0);
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((entry) => fragment.append(buildLogEntry(entry)));
  messageLog.append(fragment);
  messageLog.scrollTop = messageLog.scrollHeight;
  updateSummary(filtered.length);
}

function renderTemplates() {
  templateList.replaceChildren();

  templates.forEach((template) => {
    const card = document.createElement("div");
    card.className = "template-card";

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.dataset.template = template.id;

    const title = document.createElement("strong");
    title.textContent = template.title;

    const body = document.createElement("span");
    body.textContent = template.message.slice(0, 92);

    applyButton.append(title, body);

    const actions = document.createElement("div");
    actions.className = "template-actions";

    const deleteButton = document.createElement("button");
    deleteButton.className = "mini-btn";
    deleteButton.type = "button";
    deleteButton.dataset.deleteTemplate = template.id;
    deleteButton.textContent = "Delete";

    actions.append(deleteButton);
    card.append(applyButton, actions);
    templateList.append(card);
  });
}

function renderAdminPanel() {
  const permissions = adminSession.permissions || [];
  adminSessionLabel.textContent = adminSession.role === "guest"
    ? "Signed out"
    : `Signed in as ${adminSession.role} since ${formatFullTime(Date.parse(adminSession.startedAt))}`;
  roleBadge.textContent = adminSession.role;
  permissionList.replaceChildren();

  if (!permissions.length) {
    const empty = document.createElement("span");
    empty.className = "helper-text";
    empty.textContent = "No permissions granted. Sign in to unlock admin features.";
    permissionList.append(empty);
  } else {
    permissions.forEach((permission) => {
      const chip = document.createElement("span");
      chip.className = "permission-chip";
      chip.textContent = permission;
      permissionList.append(chip);
    });
  }

  registerConfigBtn.disabled = !hasPermission("config:write");
  exportBackupBtn.disabled = !hasPermission("backup:manage");
  clearAuditBtn.disabled = !hasPermission("audit:manage");
  updateAccessControls();
  renderConfigList();
  renderAuditLog();
}

function updateAccessControls() {
  sendBtn.disabled = !hasPermission("message:send");
  sendTestBtn.disabled = !hasPermission("message:send");
  clearLogBtn.disabled = !hasPermission("message:manage") || sentMessages.length === 0;
  exportLogBtn.disabled = !hasPermission("audit:read") || sentMessages.length === 0;
  saveTemplateBtn.disabled = !hasPermission("message:manage");
  resetAppBtn.disabled = !hasPermission("backup:manage");
}

function renderConfigList() {
  configList.replaceChildren();

  if (!integrationConfigs.length) {
    const empty = document.createElement("p");
    empty.className = "helper-text";
    empty.textContent = "No integrations registered yet. Admins can register the active webhook configuration once it is set up.";
    configList.append(empty);
    return;
  }

  integrationConfigs.forEach((config) => {
    const card = document.createElement("div");
    card.className = "config-card";

    const title = document.createElement("strong");
    title.textContent = config.name;

    const meta = document.createElement("span");
    meta.textContent = `${config.type} Â· ${config.maskedTarget} Â· ${config.status}`;

    const time = document.createElement("span");
    time.textContent = `Updated ${formatFullTime(Date.parse(config.updatedAt))}`;

    const actions = document.createElement("div");
    actions.className = "config-actions";

    const disableButton = document.createElement("button");
    disableButton.className = "mini-btn";
    disableButton.type = "button";
    disableButton.dataset.configAction = config.status === "active" ? "disable" : "enable";
    disableButton.dataset.id = config.id;
    disableButton.textContent = config.status === "active" ? "Disable" : "Enable";
    disableButton.disabled = !hasPermission("config:write");

    actions.append(disableButton);
    card.append(title, meta, time, actions);
    configList.append(card);
  });
}

function renderAuditLog() {
  auditLog.replaceChildren();
  auditCount.textContent = `${auditEvents.length} ${auditEvents.length === 1 ? "event" : "events"}`;

  if (!auditEvents.length) {
    const empty = document.createElement("p");
    empty.className = "helper-text";
    empty.textContent = "No audit events recorded yet.";
    auditLog.append(empty);
    return;
  }

  auditEvents.slice().reverse().slice(0, 80).forEach((event) => {
    const item = document.createElement("div");
    item.className = "audit-entry";

    const title = document.createElement("strong");
    title.textContent = event.action;

    const meta = document.createElement("span");
    meta.textContent = `${event.actor} Â· ${formatFullTime(Date.parse(event.timestamp))}`;

    const details = document.createElement("span");
    details.textContent = event.details || "No details";

    item.append(title, meta, details);
    auditLog.append(item);
  });
}

function addLogEntry(message, status = "sending") {
  const entry = {
    id: makeId(),
    username: webhookSettings.username,
    message,
    timestamp: Date.now(),
    status,
    error: ""
  };

  sentMessages.push(entry);
  activeSendId = status === "sending" ? entry.id : null;
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

function removeLogEntry(id) {
  if (scheduledTimers.has(id)) {
    window.clearTimeout(scheduledTimers.get(id));
    scheduledTimers.delete(id);
  }

  sentMessages = sentMessages.filter((entry) => entry.id !== id);
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
    remember: rememberSetupInput.checked,
    compact: compactModeInput.checked
  };
}

async function postToDiscord(message, entryId) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${CLOUDFLARE_WORKER_URL}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message }),
      signal: controller.signal
    });

    if (response.ok) {
      updateLogEntry(entryId, { status: "sent", error: "" });
      setStatus(statusBox, "Message sent successfully.", "success");
      showToast("Message sent.", "success");
      recordAudit("message.sent", `${message.length} characters sent`);
      return true;
    }

    updateLogEntry(entryId, {
      status: "failed",
      error: `Worker responded with ${response.status}.`
    });

    setStatus(statusBox, "Message failed. Check Cloudflare Worker.", "error");
    showToast("Message failed.", "error");
    recordAudit("message.failed", `Worker responded with ${response.status}`);
    return false;
  } catch (error) {
    const messageText = error.name === "AbortError"
      ? "Request timed out after 15 seconds."
      : error.message;

    updateLogEntry(entryId, {
      status: "failed",
      error: messageText
    });

    setStatus(statusBox, `Error: ${messageText}`, "error");
    showToast("Message failed.", "error");
    recordAudit("message.failed", messageText);
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function sendMessage(message, options = {}) {
  if (!requirePermission("message:send", "message sending")) {
    return;
  }

  if (!webhookSettings.webhook) {
    setStatus(statusBox, "Set up a webhook before sending.", "error");
    showSetup();
    return;
  }

  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    setStatus(statusBox, "Type a message before sending.", "error");
    return;
  }

  if (trimmedMessage.length > DISCORD_MESSAGE_LIMIT) {
    setStatus(statusBox, "Discord messages can be up to 2000 characters.", "error");
    return;
  }

  const delaySeconds = Number(options.delaySeconds ?? sendDelayInput.value);

  if (delaySeconds > 0) {
    scheduleMessage(trimmedMessage, delaySeconds);
    if (!options.keepComposerText) {
      messageInput.value = "";
      updateComposerMeta();
      persistDraft();
    }
    return;
  }

  const entryId = options.entryId || addLogEntry(trimmedMessage);
  const originalText = messageInput.value;

  setStatus(statusBox, "Sending...");
  sendBtn.disabled = true;
  messageInput.disabled = true;

  const succeeded = await postToDiscord(trimmedMessage, entryId);

  if (succeeded && !options.keepComposerText) {
    messageInput.value = "";
    updateComposerMeta();
    persistDraft();
  }

  if (!succeeded && !options.keepComposerText) {
    messageInput.value = originalText;
  }

  activeSendId = null;
  messageInput.disabled = false;
  updateAccessControls();
  updateComposerMeta();
  messageInput.focus();
}

function scheduleMessage(message, delaySeconds) {
  const entryId = addLogEntry(message, "scheduled");
  updateLogEntry(entryId, {
    error: `Scheduled for ${formatFullTime(Date.now() + delaySeconds * 1000)}.`
  });
  setStatus(statusBox, `Message scheduled in ${delaySeconds} seconds.`, "success");
  showToast("Message scheduled.", "success");

  const timer = window.setTimeout(() => {
    scheduledTimers.delete(entryId);
    updateLogEntry(entryId, { status: "sending", error: "" });
    sendMessage(message, { entryId, keepComposerText: true, delaySeconds: 0 });
  }, delaySeconds * 1000);

  scheduledTimers.set(entryId, timer);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(statusBox, successMessage, "success");
    showToast(successMessage, "success");
  } catch {
    setStatus(statusBox, "Copy failed in this browser.", "error");
    showToast("Copy failed.", "error");
  }
}

function clearLog() {
  if (!requirePermission("message:manage", "log clearing")) {
    return;
  }

  if (!sentMessages.length) {
    return;
  }

  if (!window.confirm("Clear the saved message log on this browser?")) {
    return;
  }

  scheduledTimers.forEach((timer) => window.clearTimeout(timer));
  scheduledTimers.clear();
  sentMessages = [];
  localStorage.removeItem(STORAGE_KEYS.history);
  renderLog();
  setStatus(statusBox, "Log cleared.", "success");
  showToast("Log cleared.", "success");
  recordAudit("messageLog.cleared", "Local message log cleared");
}

function saveTemplateFromDraft() {
  if (!requirePermission("message:manage", "template creation")) {
    return;
  }

  const message = messageInput.value.trim();

  if (!message) {
    setStatus(statusBox, "Write a draft before saving it as a template.", "error");
    return;
  }

  const title = window.prompt("Template name", message.split("\n")[0].slice(0, 40) || "New template");

  if (!title) {
    return;
  }

  templates = [{ id: makeId(), title: title.slice(0, 60), message }, ...templates].slice(0, 12);
  persistTemplates();
  renderTemplates();
  setStatus(statusBox, "Template saved.", "success");
  showToast("Template saved.", "success");
  recordAudit("template.created", title.slice(0, 60));
}

function applyTemplate(id) {
  const template = templates.find((item) => item.id === id);
  if (!template) {
    return;
  }

  messageInput.value = template.message;
  updateComposerMeta();
  persistDraft();
  messageInput.focus();
}

function deleteTemplate(id) {
  if (!requirePermission("message:manage", "template deletion")) {
    return;
  }

  templates = templates.filter((template) => template.id !== id);
  persistTemplates();
  renderTemplates();
  recordAudit("template.deleted", id);
}

function insertFormatting(type) {
  const start = messageInput.selectionStart;
  const end = messageInput.selectionEnd;
  const selected = messageInput.value.slice(start, end);
  const replacements = {
    bold: [`**${selected || "bold text"}**`, selected ? 2 : 2, selected ? 2 : 11],
    italic: [`*${selected || "italic text"}*`, selected ? 1 : 1, selected ? 1 : 12],
    code: [`\`${selected || "code"}\``, selected ? 1 : 1, selected ? 1 : 5],
    quote: [`> ${selected || "quoted text"}`, selected ? 2 : 2, selected ? 2 : 13],
    list: [`- ${selected || "list item"}`, selected ? 2 : 2, selected ? 2 : 11],
    timestamp: [new Date().toLocaleString(), 0, 0]
  };

  const [replacement, cursorOffsetStart, cursorOffsetEnd] = replacements[type] || ["", 0, 0];
  messageInput.setRangeText(replacement, start, end, "end");

  if (!selected && type !== "timestamp") {
    messageInput.setSelectionRange(start + cursorOffsetStart, start + replacement.length - cursorOffsetEnd);
  }

  updateComposerMeta();
  queueDraftSave();
  messageInput.focus();
}

function exportLog() {
  if (!requirePermission("audit:read", "log export")) {
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    messages: sentMessages,
    templates
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `webhook-messenger-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Export created.", "success");
  recordAudit("messageLog.exported", `${sentMessages.length} messages`);
}

async function importLog(file) {
  if (!requirePermission("message:manage", "log import")) {
    importLogInput.value = "";
    return;
  }

  if (!file) {
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    const importedMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const importedTemplates = Array.isArray(payload.templates) ? payload.templates : [];

    sentMessages = [...sentMessages, ...importedMessages]
      .filter((entry) => entry && typeof entry.message === "string")
      .map((entry) => ({
        id: entry.id || makeId(),
        username: entry.username || "Imported",
        message: entry.message.slice(0, DISCORD_MESSAGE_LIMIT),
        timestamp: Number(entry.timestamp) || Date.now(),
        status: ["sent", "failed", "scheduled"].includes(entry.status) ? entry.status : "failed",
        error: entry.error || ""
      }))
      .slice(-HISTORY_LIMIT);

    templates = [...importedTemplates, ...templates]
      .filter((template) => template && typeof template.message === "string")
      .map((template) => ({
        id: template.id || makeId(),
        title: template.title || "Imported template",
        message: template.message.slice(0, DISCORD_MESSAGE_LIMIT)
      }))
      .slice(0, 12);

    persistHistory();
    persistTemplates();
    renderLog();
    renderTemplates();
    showToast("Import complete.", "success");
    recordAudit("messageLog.imported", file.name);
  } catch {
    setStatus(statusBox, "Import failed. Choose a valid export JSON file.", "error");
    showToast("Import failed.", "error");
  } finally {
    importLogInput.value = "";
  }
}

function resetLocalData() {
  if (!requirePermission("backup:manage", "local data reset")) {
    return;
  }

  if (!window.confirm("Reset saved setup, draft, templates, and message log on this browser?")) {
    return;
  }

  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  scheduledTimers.forEach((timer) => window.clearTimeout(timer));
  scheduledTimers.clear();
  sentMessages = [];
  templates = DEFAULT_TEMPLATES;
  auditEvents = [];
  integrationConfigs = [];
  adminSession = { role: "guest", permissions: [] };
  messageInput.value = "";
  webhookSettings = {
    webhook: "",
    username: "",
    avatar: "",
    remember: false,
    compact: false
  };
  renderTemplates();
  renderLog();
  renderAdminPanel();
  updateComposerMeta();
  showSetup();
  showToast("Local data reset.", "success");
}

function openAdminPanel() {
  adminPanel.classList.remove("is-hidden");
  renderAdminPanel();
  adminRoleInput.focus();
}

function closeAdminPanel() {
  adminPanel.classList.add("is-hidden");
}

function startAdminSession(role, passcode) {
  if (!RBAC[role] || ROLE_PASSCODES[role] !== passcode) {
    showToast("Invalid role credentials.", "error");
    recordAudit("auth.failed", `Attempted role: ${role || "unknown"}`);
    return;
  }

  adminSession = {
    role,
    permissions: RBAC[role],
    startedAt: new Date().toISOString()
  };
  persistAdminSession();
  adminPasscodeInput.value = "";
  recordAudit("auth.started", `Role session started for ${role}`);
  renderAdminPanel();
  showToast(`Signed in as ${role}.`, "success");
}

function signOutAdmin() {
  recordAudit("auth.ended", `Role session ended for ${adminSession.role}`);
  adminSession = { role: "guest", permissions: [] };
  persistAdminSession();
  renderAdminPanel();
  showToast("Admin session ended.", "success");
}

function registerCurrentConfig() {
  if (!requirePermission("config:write", "integration registration")) {
    return;
  }

  if (!isDiscordWebhook(webhookSettings.webhook)) {
    showToast("Set up a valid Discord webhook first.", "error");
    return;
  }

  const fingerprint = getConfigFingerprint(webhookSettings.webhook);
  const existing = integrationConfigs.find((config) => config.fingerprint === fingerprint);

  if (existing) {
    existing.updatedAt = new Date().toISOString();
    existing.maskedTarget = maskWebhook(webhookSettings.webhook);
    persistIntegrationConfigs();
    renderConfigList();
    recordAudit("config.deduplicated", `Existing config refreshed: ${existing.maskedTarget}`);
    showToast("Existing integration refreshed instead of duplicated.", "success");
    return;
  }

  integrationConfigs.unshift({
    id: makeId(),
    name: `${webhookSettings.username || "Discord"} webhook`,
    type: "discord-webhook",
    fingerprint,
    maskedTarget: maskWebhook(webhookSettings.webhook),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active"
  });
  persistIntegrationConfigs();
  renderConfigList();
  recordAudit("config.registered", maskWebhook(webhookSettings.webhook));
  showToast("Integration registered.", "success");
}

function updateConfigStatus(id, status) {
  if (!requirePermission("config:write", "configuration changes")) {
    return;
  }

  integrationConfigs = integrationConfigs.map((config) => (
    config.id === id ? { ...config, status, updatedAt: new Date().toISOString() } : config
  ));
  persistIntegrationConfigs();
  renderConfigList();
  recordAudit("config.statusChanged", `${id} set to ${status}`);
}

function exportBackup() {
  if (!requirePermission("backup:manage", "backup export")) {
    return;
  }

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: webhookSettings.remember ? webhookSettings : { ...webhookSettings, webhook: "" },
    history: sentMessages,
    templates,
    configs: integrationConfigs,
    audit: auditEvents
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `webhook-messenger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  recordAudit("backup.exported", "Full platform backup exported");
  showToast("Backup exported.", "success");
}

async function restoreBackup(file) {
  if (!file || !requirePermission("backup:manage", "backup restore")) {
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    sentMessages = Array.isArray(payload.history) ? payload.history.slice(-HISTORY_LIMIT) : sentMessages;
    templates = Array.isArray(payload.templates) ? payload.templates.slice(0, 12) : templates;
    integrationConfigs = Array.isArray(payload.configs) ? payload.configs.slice(-100) : integrationConfigs;
    auditEvents = Array.isArray(payload.audit) ? payload.audit.slice(-300) : auditEvents;

    persistHistory();
    persistTemplates();
    persistIntegrationConfigs();
    persistAuditEvents();
    renderLog();
    renderTemplates();
    renderAdminPanel();
    recordAudit("backup.restored", file.name);
    showToast("Backup restored.", "success");
  } catch {
    showToast("Restore failed. Choose a valid backup JSON file.", "error");
  } finally {
    restoreBackupInput.value = "";
  }
}

function clearAuditLog() {
  if (!requirePermission("audit:manage", "audit maintenance")) {
    return;
  }

  if (!window.confirm("Clear the local audit log?")) {
    return;
  }

  auditEvents = [];
  persistAuditEvents();
  recordAudit("audit.cleared", "Audit log cleared");
  renderAuditLog();
}

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const nextSettings = validateSetup();
  if (!nextSettings) {
    return;
  }

  webhookSettings = nextSettings;
  persistSettings();
  setStatus(setupStatus, "");
  await captureConfigToCloudflare(webhookSettings);
  showMessenger();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

messageInput.addEventListener("keydown", (event) => {
  if (enterToSendInput.checked && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

messageInput.addEventListener("input", () => {
  updateComposerMeta();
  queueDraftSave();
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
    copyText(entry.message, "Message copied.");
  }

  if (action === "edit") {
    if (!requirePermission("message:manage", "message editing")) {
      return;
    }

    messageInput.value = entry.message;
    updateComposerMeta();
    persistDraft();
    messageInput.focus();
  }

  if (action === "resend") {
    sendMessage(entry.message, { keepComposerText: true, delaySeconds: 0 });
  }

  if (action === "delete") {
    if (!requirePermission("message:manage", "message deletion")) {
      return;
    }

    removeLogEntry(id);
    showToast("Message removed.", "success");
  }
});

templateList.addEventListener("click", (event) => {
  const applyButton = event.target.closest("button[data-template]");
  const deleteButton = event.target.closest("button[data-delete-template]");

  if (applyButton) {
    applyTemplate(applyButton.dataset.template);
  }

  if (deleteButton) {
    deleteTemplate(deleteButton.dataset.deleteTemplate);
  }
});

configList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-config-action]");
  if (!button) {
    return;
  }

  updateConfigStatus(button.dataset.id, button.dataset.configAction === "disable" ? "disabled" : "active");
});

document.querySelectorAll("[data-format]").forEach((button) => {
  button.addEventListener("click", () => insertFormatting(button.dataset.format));
});

clearLogBtn.addEventListener("click", clearLog);
editSetupBtn.addEventListener("click", showSetup);
exportLogBtn.addEventListener("click", exportLog);
importLogInput.addEventListener("change", () => importLog(importLogInput.files[0]));
saveTemplateBtn.addEventListener("click", saveTemplateFromDraft);
copyDraftBtn.addEventListener("click", () => copyText(messageInput.value, "Draft copied."));
restoreDraftBtn.addEventListener("click", () => {
  messageInput.value = localStorage.getItem(STORAGE_KEYS.draft) || "";
  updateComposerMeta();
  messageInput.focus();
});
resetAppBtn.addEventListener("click", resetLocalData);
adminPanelBtn.addEventListener("click", openAdminPanel);
closeAdminBtn.addEventListener("click", closeAdminPanel);
adminPanel.addEventListener("click", (event) => {
  if (event.target === adminPanel) {
    closeAdminPanel();
  }
});
adminLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startAdminSession(adminRoleInput.value, adminPasscodeInput.value);
});
signOutAdminBtn.addEventListener("click", signOutAdmin);
registerConfigBtn.addEventListener("click", registerCurrentConfig);
exportBackupBtn.addEventListener("click", exportBackup);
restoreBackupInput.addEventListener("change", () => restoreBackup(restoreBackupInput.files[0]));
clearAuditBtn.addEventListener("click", clearAuditLog);
sendTestBtn.addEventListener("click", () => {
  sendMessage(`Test message from ${webhookSettings.username || "Webhook Messenger"} at ${new Date().toLocaleTimeString()}.`, {
    keepComposerText: true,
    delaySeconds: 0
  });
});
searchMessagesInput.addEventListener("input", renderLog);
statusFilterInput.addEventListener("change", renderLog);
compactModeInput.addEventListener("change", () => {
  webhookSettings.compact = compactModeInput.checked;
  applyCompactMode();
  persistSettings();
});

[webhookInput, usernameInput, avatarInput].forEach((input) => {
  input.addEventListener("input", updateAvatarPreview);
});

const savedSettings = loadSettings();

if (savedSettings) {
  webhookSettings = {
    webhook: savedSettings.webhook || "",
    username: savedSettings.username || "",
    avatar: savedSettings.avatar || "",
    remember: Boolean(savedSettings.remember),
    compact: Boolean(savedSettings.compact)
  };

  webhookInput.value = webhookSettings.webhook;
  usernameInput.value = webhookSettings.username;
  avatarInput.value = webhookSettings.avatar;
  rememberSetupInput.checked = webhookSettings.remember;
  compactModeInput.checked = webhookSettings.compact;
}

messageInput.value = localStorage.getItem(STORAGE_KEYS.draft) || "";
persistHistory();
updateAvatarPreview();
updateComposerMeta();
renderTemplates();
renderLog();
renderAdminPanel();

if (savedSettings && isDiscordWebhook(webhookSettings.webhook) && webhookSettings.username) {
  showMessenger();
}
