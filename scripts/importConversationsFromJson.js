const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/conversaciones.json');

function readConversations() {
  if (!fs.existsSync(FILE)) return null;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
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

async function upsertConversationMessage(fields) {
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
}

async function importConversationsFromJson() {
  const data = readConversations();
  const warnings = [];
  let phonesReviewed = 0;
  let messagesFound = 0;
  let imported = 0;

  if (!data) {
    console.log('ℹ️ data/conversaciones.json no existe; no hay conversaciones para importar.');
    await pool.end();
    return;
  }

  try {
    for (const [phone, messages] of Object.entries(data)) {
      const normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) {
        warnings.push({ phone, issue: 'sin phone' });
        continue;
      }
      phonesReviewed += 1;
      const list = Array.isArray(messages) ? messages : [];
      for (const message of list) {
        messagesFound += 1;
        if (!message?.id) {
          warnings.push({ phone: normalizedPhone, issue: 'mensaje sin id' });
          continue;
        }
        const fields = extractConversationMessageFields(normalizedPhone, message);
        if (!fields.occurredAt) warnings.push({ phone: normalizedPhone, messageId: message.id, issue: 'mensaje sin fecha' });
        await upsertConversationMessage(fields);
        imported += 1;
      }
    }

    console.log('✅ Conversaciones importadas/actualizadas correctamente');
    console.log(`Teléfonos revisados: ${phonesReviewed}`);
    console.log(`Mensajes encontrados: ${messagesFound}`);
    console.log(`Mensajes importados/actualizados: ${imported}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de conversaciones incompletas.');
    }
  } catch (error) {
    console.error('❌ Error importando conversaciones desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importConversationsFromJson();
