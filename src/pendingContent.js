const fs = require("fs");
const path = require("path");
const db = require("./db");

const FILE = path.join(__dirname, "../data/pendingContent.json");
const WAITING_STATUS = "waiting_patient_interaction";
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const HAS_DATABASE_URL = Boolean(DATABASE_URL);
const pool = db.pool || db;

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
  console.log("[pending-content] save llamado", JSON.stringify({ count: Array.isArray(items) ? items.length : 0 }));
  syncPendingContentMirrorToPostgres(items).catch(error => {
    console.warn("[pending-content] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  });
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildPendingDedupeKey(item) {
  const phone = normalizePhone(item?.phone);
  if (!phone || !item?.type) return null;
  if (item.type === "tip") {
    const sendId = item.payload?.sendId || "";
    return sendId ? `tip:${sendId}:${phone}` : null;
  }
  const clientId = item.clientId || "";
  const goalId = item.payload?.goalId || "";
  return clientId && goalId ? `goal:${clientId}:${phone}:${goalId}` : null;
}

async function syncPendingItemToPostgres(item) {
  if (!item?.id || !item?.phone || !item?.type) return false;
  await pool.query(`
    INSERT INTO pending_content (
      pending_id,
      client_id,
      phone,
      original_phone,
      patient_name,
      type,
      status,
      trigger_template_id,
      trigger_template_name,
      trigger_button_labels,
      template_message_id,
      payload,
      result,
      error,
      last_error,
      sent_at,
      created_at,
      updated_at,
      dedupe_key,
      data
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10::jsonb, $11, $12::jsonb, $13::jsonb,
      $14, $15, $16, $17, $18, $19, $20::jsonb
    )
    ON CONFLICT (pending_id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      phone = EXCLUDED.phone,
      original_phone = EXCLUDED.original_phone,
      patient_name = EXCLUDED.patient_name,
      type = EXCLUDED.type,
      status = EXCLUDED.status,
      trigger_template_id = EXCLUDED.trigger_template_id,
      trigger_template_name = EXCLUDED.trigger_template_name,
      trigger_button_labels = EXCLUDED.trigger_button_labels,
      template_message_id = EXCLUDED.template_message_id,
      payload = EXCLUDED.payload,
      result = EXCLUDED.result,
      error = EXCLUDED.error,
      last_error = EXCLUDED.last_error,
      sent_at = EXCLUDED.sent_at,
      created_at = COALESCE(pending_content.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      dedupe_key = EXCLUDED.dedupe_key,
      data = EXCLUDED.data
  `, [
    item.id,
    item.clientId || null,
    normalizePhone(item.phone),
    item.originalPhone || null,
    item.patientName || null,
    item.type,
    item.status || null,
    item.triggerTemplateId || null,
    item.triggerTemplateName || null,
    JSON.stringify(item.triggerButtonLabels || []),
    item.templateMessageId || null,
    JSON.stringify(item.payload || {}),
    JSON.stringify(item.result || null),
    item.error || null,
    item.lastError || null,
    timestampValue(item.sentAt),
    timestampValue(item.createdAt),
    timestampValue(item.updatedAt) || timestampValue(item.createdAt) || new Date().toISOString(),
    buildPendingDedupeKey(item),
    JSON.stringify(item),
  ]);
  console.log("[pending-content] pendiente sincronizado", JSON.stringify({ pendingId: item.id, clientId: item.clientId || "", phone: normalizePhone(item.phone), type: item.type, status: item.status || "" }));
  return true;
}

async function syncPendingContentMirrorToPostgres(items) {
  if (!HAS_DATABASE_URL) {
    console.warn("[pending-content] DATABASE_URL no está configurada. No se sincronizará espejo PostgreSQL.");
    return;
  }
  const pendingItems = Array.isArray(items) ? items : [];
  console.log("[pending-content] espejo solicitado");
  console.log("[pending-content] pendientes detectados", pendingItems.length);
  try {
    let synced = 0;
    for (const item of pendingItems) {
      if (await syncPendingItemToPostgres(item)) synced += 1;
    }
    console.log("[pending-content] espejo PostgreSQL sincronizado", JSON.stringify({ detected: pendingItems.length, synced }));
  } catch (error) {
    console.warn("[pending-content] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  }
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
