const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/pendingContent.json");
const WAITING_STATUS = "waiting_patient_interaction";

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[pendingContent] Error leyendo data/pendingContent.json:", e.message);
    return [];
  }
}

function save(items) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pendingKey(item) {
  const phone = normalizePhone(item.phone);
  if (item.type === "tip") return `tip:${item.payload?.sendId || ""}:${phone}`;
  return `goal:${item.clientId}:${phone}:${item.payload?.goalId || ""}`;
}

function upsertWaiting(input) {
  const items = load();
  const now = new Date().toISOString();
  const next = {
    id: input.id || uid(),
    clientId: input.clientId,
    phone: normalizePhone(input.phone),
    originalPhone: input.originalPhone || input.phone || "",
    patientName: input.patientName || "Paciente",
    type: input.type,
    payload: input.payload || {},
    status: WAITING_STATUS,
    triggerTemplateId: input.triggerTemplateId || "",
    triggerTemplateName: input.triggerTemplateName || "",
    triggerButtonLabels: input.triggerButtonLabels || ["Ver seguimiento", "Ver mensaje", "Ver recomendación", "Ver recordatorio", "Vamos"],
    templateMessageId: input.templateMessageId || "",
    createdAt: input.createdAt || now,
    updatedAt: now,
    sentAt: input.sentAt || "",
    error: input.error || input.lastError || "",
    lastError: input.lastError || "",
  };
  const key = pendingKey(next);
  const index = items.findIndex(item => item.status === WAITING_STATUS && pendingKey(item) === key);
  if (index >= 0) items[index] = { ...items[index], ...next, id: items[index].id, createdAt: items[index].createdAt || next.createdAt };
  else items.unshift(next);
  save(items);
  return index >= 0 ? items[index] : next;
}

function findWaitingByPhone(phone) {
  const normalized = normalizePhone(phone);
  return load()
    .filter(item => normalizePhone(item.phone) === normalized && item.status === WAITING_STATUS)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function update(id, patch) {
  const items = load();
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
  save(items);
  return items[index];
}

function markSent(id, patch = {}) {
  return update(id, { ...patch, status: "sent", sentAt: new Date().toISOString(), error: "", lastError: "" });
}

function markError(id, error, patch = {}) {
  const message = String(error || "Error desconocido");
  return update(id, { ...patch, status: "error", error: message, lastError: message });
}

module.exports = { findWaitingByPhone, markError, markSent, normalizePhone, upsertWaiting };
