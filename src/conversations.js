// src/conversations.js
// Guarda todos los mensajes enviados y recibidos por paciente
const fs   = require("fs");
const path = require("path");
const db = require("./db");
const FILE = path.join(__dirname, "../data/conversaciones.json");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const HAS_DATABASE_URL = Boolean(DATABASE_URL);
const pool = db.pool || db;

function load() {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch { return {}; }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  console.log("[conversations] save llamado", JSON.stringify({ phones: data && typeof data === "object" ? Object.keys(data).length : 0 }));
  syncConversationsMirrorToPostgres(data).catch(error => {
    console.warn("[conversations] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  });
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractConversationMessageFields(phone, message) {
  const occurredAt = timestampValue(message.fecha || message.createdAt || message.updatedAt);
  return {
    messageId: message.id,
    phone: normalizePhone(phone),
    clientId: message.clientId || message.client_id || null,
    messageType: message.tipo || message.type || null,
    direction: message.direccion || message.direction || message.tipo || null,
    text: message.texto || message.text || null,
    nombre: message.nombre || message.name || null,
    media: message.media || null,
    occurredAt,
    createdAt: timestampValue(message.createdAt) || occurredAt,
    updatedAt: timestampValue(message.updatedAt) || occurredAt || new Date().toISOString(),
    data: message,
  };
}

async function syncConversationMessageToPostgres(phone, message) {
  if (!message?.id || !phone) return false;
  const fields = extractConversationMessageFields(phone, message);
  if (!fields.phone) return false;
  await pool.query(`
    INSERT INTO conversation_messages (
      message_id,
      phone,
      client_id,
      message_type,
      direction,
      text,
      nombre,
      media,
      occurred_at,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb)
    ON CONFLICT (message_id) DO UPDATE SET
      phone = EXCLUDED.phone,
      client_id = EXCLUDED.client_id,
      message_type = EXCLUDED.message_type,
      direction = EXCLUDED.direction,
      text = EXCLUDED.text,
      nombre = EXCLUDED.nombre,
      media = EXCLUDED.media,
      occurred_at = EXCLUDED.occurred_at,
      created_at = COALESCE(conversation_messages.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    fields.messageId,
    fields.phone,
    fields.clientId,
    fields.messageType,
    fields.direction,
    fields.text,
    fields.nombre,
    JSON.stringify(fields.media),
    fields.occurredAt,
    fields.createdAt,
    fields.updatedAt,
    JSON.stringify(fields.data),
  ]);
  console.log("[conversations] mensaje sincronizado", JSON.stringify({ phone: fields.phone, messageId: fields.messageId, type: fields.messageType || "" }));
  return true;
}

async function syncConversationsMirrorToPostgres(data) {
  if (!HAS_DATABASE_URL) {
    console.warn("[conversations] DATABASE_URL no está configurada. No se sincronizará espejo PostgreSQL.");
    return;
  }
  const conversationsByPhone = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const entries = Object.entries(conversationsByPhone);
  const messagesCount = entries.reduce((total, [, messages]) => total + (Array.isArray(messages) ? messages.length : 0), 0);
  console.log("[conversations] espejo solicitado");
  console.log("[conversations] telefonos detectados", entries.length);
  console.log("[conversations] mensajes detectados", messagesCount);
  try {
    let synced = 0;
    for (const [phone, messages] of entries) {
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        if (await syncConversationMessageToPostgres(phone, message)) synced += 1;
      }
    }
    console.log("[conversations] espejo PostgreSQL sincronizado", JSON.stringify({ phones: entries.length, messages: synced }));
  } catch (error) {
    console.warn("[conversations] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  }
}

/**
 * Registra un mensaje
 * @param {string} phone - número del paciente
 * @param {string} tipo - "enviado" | "recibido"
 * @param {string} texto - contenido del mensaje
 * @param {object} extra - datos adicionales
 */
function registrar(phone, tipo, texto, extra = {}) {
  const db = load();
  if (!db[phone]) db[phone] = [];
  db[phone].unshift({
    id: Date.now().toString(),
    tipo,
    texto,
    fecha: new Date().toISOString(),
    ...extra,
  });
  // Máximo 200 mensajes por paciente
  if (db[phone].length > 200) db[phone] = db[phone].slice(0, 200);
  save(db);
}

function getMensajes(phone) {
  return load()[phone] ?? [];
}

function getTodos() {
  const db = load();
  // Aplanar todos los mensajes con el teléfono
  let todos = [];
  for (const [phone, msgs] of Object.entries(db)) {
    todos = todos.concat(msgs.map(m => ({ ...m, phone })));
  }
  return todos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

module.exports = { registrar, getMensajes, getTodos };
