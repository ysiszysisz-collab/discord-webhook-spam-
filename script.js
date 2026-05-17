const DISCORD_MESSAGE_LIMIT = 2000;
const HISTORY_LIMIT = 200;
const STORAGE_KEYS = {
  settings: "webhookMessenger.settings.v2",
  history: "webhookMessenger.history.v2",
  draft: "webhookMessenger.draft.v2",
  templates: "webhookMessenger.templates.v2"
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

let webhookSettings = {
  webhook: "",
  username: "",
  avatar: "",
  remember: false,
  compact: false
};

let sentMessages = loadHistory();
let templates = loadTemplates();
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
  clearLogBtn.disabled = total === 0;
  exportLogBtn.disabled = total === 0;
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
    const response = await fetch(webhookSettings.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: webhookSettings.username,
        avatar_url: webhookSettings.avatar || undefined,
        content: message
      }),
      signal: controller.signal
    });

    if (response.ok) {
      updateLogEntry(entryId, { status: "sent", error: "" });
      setStatus(statusBox, "Message sent successfully.", "success");
      showToast("Message sent.", "success");
      return true;
    }

    const retryAfter = response.headers.get("retry-after");
    const rateLimitMessage = retryAfter ? ` Try again in ${retryAfter} seconds.` : "";
    updateLogEntry(entryId, {
      status: "failed",
      error: `Discord responded with ${response.status}.${rateLimitMessage}`
    });
    setStatus(statusBox, "Discord rejected the message. Check the webhook.", "error");
    showToast("Message failed.", "error");
    return false;
  } catch (error) {
    const messageText = error.name === "AbortError" ? "Request timed out after 15 seconds." : error.message;
    updateLogEntry(entryId, {
      status: "failed",
      error: messageText
    });
    setStatus(statusBox, `Error: ${messageText}`, "error");
    showToast("Message failed.", "error");
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function sendMessage(message, options = {}) {
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
  sendBtn.disabled = false;
  messageInput.disabled = false;
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
}

function saveTemplateFromDraft() {
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
  templates = templates.filter((template) => template.id !== id);
  persistTemplates();
  renderTemplates();
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
}

async function importLog(file) {
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
  } catch {
    setStatus(statusBox, "Import failed. Choose a valid export JSON file.", "error");
    showToast("Import failed.", "error");
  } finally {
    importLogInput.value = "";
  }
}

function resetLocalData() {
  if (!window.confirm("Reset saved setup, draft, templates, and message log on this browser?")) {
    return;
  }

  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  scheduledTimers.forEach((timer) => window.clearTimeout(timer));
  scheduledTimers.clear();
  sentMessages = [];
  templates = DEFAULT_TEMPLATES;
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
  updateComposerMeta();
  showSetup();
  showToast("Local data reset.", "success");
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
    messageInput.value = entry.message;
    updateComposerMeta();
    persistDraft();
    messageInput.focus();
  }

  if (action === "resend") {
    sendMessage(entry.message, { keepComposerText: true, delaySeconds: 0 });
  }

  if (action === "delete") {
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

if (savedSettings && isDiscordWebhook(webhookSettings.webhook) && webhookSettings.username) {
  showMessenger();
}
