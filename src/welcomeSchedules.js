const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/welcomeSchedules.json");

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[welcomeSchedules] Error leyendo data/welcomeSchedules.json:", e.message);
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

function normalizeScheduledAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha de bienvenida inválida");
  return date.toISOString();
}

function create(payload) {
  const items = load();
  const now = new Date().toISOString();
  const item = {
    id: uid(),
    clientId: payload.clientId,
    templateType: payload.templateType || "with_button",
    scheduledAt: normalizeScheduledAt(payload.scheduledAt),
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
    sentAt: "",
    error: "",
  };
  items.unshift(item);
  save(items);
  return item;
}

function update(id, patch) {
  const items = load();
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  const next = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
  if (patch.scheduledAt) next.scheduledAt = normalizeScheduledAt(patch.scheduledAt);
  items[index] = next;
  save(items);
  return next;
}

function cancel(id) {
  const item = update(id, { status: "cancelled", cancelledAt: new Date().toISOString() });
  if (!item) throw new Error("Bienvenida programada no encontrada");
  return item;
}

function due(now = new Date()) {
  const ts = now.getTime();
  return load().filter(item => item.status === "scheduled" && new Date(item.scheduledAt).getTime() <= ts);
}

function list(filter = {}) {
  return load()
    .filter(item => !filter.clientId || item.clientId === filter.clientId)
    .sort((a, b) => new Date(b.scheduledAt || b.createdAt) - new Date(a.scheduledAt || a.createdAt));
}

module.exports = { cancel, create, due, list, update };
