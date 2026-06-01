const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/pendingContent.json");

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
  if (item.type === "tip") return `tip:${item.payload?.sendId || ""}:${item.phone}`;
  return `goal:${item.clientId}:${item.phone}:${item.payload?.goalId || ""}`;
}

function upsertWaiting(input) {
  const items = load();
  const now = new Date().toISOString();
  const next = {
    id: input.id || uid(),
    clientId: input.clientId,
    phone: input.phone,
    patientName: input.patientName || "Paciente",
    type: input.type,
    payload: input.payload || {},
    status: "waiting_patient_interaction",
    templateMessageId: input.templateMessageId || "",
    createdAt: input.createdAt || now,
    updatedAt: now,
    lastError: input.lastError || "",
  };
  const key = pendingKey(next);
  const index = items.findIndex(item => item.status === "waiting_patient_interaction" && pendingKey(item) === key);
  if (index >= 0) items[index] = { ...items[index], ...next, id: items[index].id, createdAt: items[index].createdAt || next.createdAt };
  else items.unshift(next);
  save(items);
  return index >= 0 ? items[index] : next;
}

function findWaitingByPhone(phone) {
  return load()
    .filter(item => item.phone === phone && item.status === "waiting_patient_interaction")
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
  return update(id, { ...patch, status: "sent", sentAt: new Date().toISOString(), lastError: "" });
}

function markError(id, error, patch = {}) {
  return update(id, { ...patch, status: "error", lastError: String(error || "Error desconocido") });
}

module.exports = { findWaitingByPhone, markError, markSent, upsertWaiting };
