const fs = require("fs");
const path = require("path");
const db = require("./db");

const FILE = path.join(__dirname, "../data/welcomeSchedules.json");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const HAS_DATABASE_URL = Boolean(DATABASE_URL);
const pool = db.pool || db;

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
  console.log("[welcome-schedules] save llamado", JSON.stringify({ count: Array.isArray(items) ? items.length : 0 }));
  syncWelcomeSchedulesMirrorToPostgres(items).catch(error => {
    console.warn("[welcome-schedules] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  });
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function syncWelcomeScheduleToPostgres(item) {
  if (!item?.id || !item?.clientId) return false;
  await pool.query(`
    INSERT INTO welcome_schedules (
      schedule_id,
      client_id,
      template_type,
      scheduled_at,
      status,
      error,
      sent_at,
      cancelled_at,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    ON CONFLICT (schedule_id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      template_type = EXCLUDED.template_type,
      scheduled_at = EXCLUDED.scheduled_at,
      status = EXCLUDED.status,
      error = EXCLUDED.error,
      sent_at = EXCLUDED.sent_at,
      cancelled_at = EXCLUDED.cancelled_at,
      created_at = COALESCE(welcome_schedules.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    item.id,
    item.clientId,
    item.templateType || null,
    timestampValue(item.scheduledAt),
    item.status || null,
    item.error || null,
    timestampValue(item.sentAt),
    timestampValue(item.cancelledAt),
    timestampValue(item.createdAt),
    timestampValue(item.updatedAt) || new Date().toISOString(),
    JSON.stringify(item),
  ]);
  console.log("[welcome-schedules] bienvenida sincronizada", JSON.stringify({ scheduleId: item.id, clientId: item.clientId, status: item.status || "" }));
  return true;
}

async function syncWelcomeSchedulesMirrorToPostgres(items) {
  if (!HAS_DATABASE_URL) {
    console.warn("[welcome-schedules] DATABASE_URL no está configurada. No se sincronizará espejo PostgreSQL.");
    return;
  }
  const schedules = Array.isArray(items) ? items : [];
  console.log("[welcome-schedules] espejo solicitado");
  console.log("[welcome-schedules] bienvenidas detectadas", schedules.length);
  try {
    let synced = 0;
    for (const item of schedules) {
      if (await syncWelcomeScheduleToPostgres(item)) synced += 1;
    }
    console.log("[welcome-schedules] espejo PostgreSQL sincronizado", JSON.stringify({ detected: schedules.length, synced }));
  } catch (error) {
    console.warn("[welcome-schedules] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  }
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
  console.log("[welcome-schedules] cancel solicitado", JSON.stringify({ scheduleId: id }));
  const items = load();
  const index = items.findIndex(item => item.id === id);
  if (index < 0) {
    console.warn("[welcome-schedules] error cancelando", JSON.stringify({ scheduleId: id, error: "Bienvenida programada no encontrada" }));
    throw new Error("Bienvenida programada no encontrada");
  }
  console.log("[welcome-schedules] schedule encontrado", JSON.stringify({ scheduleId: id, clientId: items[index].clientId, status: items[index].status || "" }));
  items[index] = {
    ...items[index],
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  save(items);
  const item = items[index];
  console.log("[welcome-schedules] schedule cancelado", JSON.stringify({ scheduleId: item.id, clientId: item.clientId, status: item.status }));
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
