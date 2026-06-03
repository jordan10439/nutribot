const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/pendingContent.json');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function readPendingContent() {
  if (!fs.existsSync(FILE)) return null;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return Array.isArray(data) ? data : [];
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildPendingDedupeKey(item) {
  const phone = normalizePhone(item?.phone);
  if (!phone || !item?.type) return null;
  if (item.type === 'tip') {
    const sendId = item.payload?.sendId || '';
    return sendId ? `tip:${sendId}:${phone}` : null;
  }
  const clientId = item.clientId || '';
  const goalId = item.payload?.goalId || '';
  return clientId && goalId ? `goal:${clientId}:${phone}:${goalId}` : null;
}

async function upsertPendingItem(item) {
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
      data,
      content
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10::jsonb, $11, $12::jsonb, $13::jsonb,
      $14, $15, $16, $17, $18, $19, $20::jsonb,
      $21::jsonb
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
      data = EXCLUDED.data,
      content = EXCLUDED.content
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
    JSON.stringify(item),
  ]);
}

async function importPendingContentFromJson() {
  const items = readPendingContent();
  const warnings = [];
  let imported = 0;

  if (!items) {
    console.log('ℹ️ data/pendingContent.json no existe; no hay contenido pendiente para importar.');
    await pool.end();
    return;
  }

  try {
    for (const item of items) {
      if (!item?.id) {
        warnings.push({ type: item?.type || '', phone: item?.phone || '', issue: 'sin id' });
        continue;
      }
      if (!item.phone) {
        warnings.push({ id: item.id, issue: 'sin phone' });
        continue;
      }
      if (!item.type) {
        warnings.push({ id: item.id, issue: 'sin type' });
        continue;
      }
      if (!item.status) warnings.push({ id: item.id, issue: 'sin status' });
      if (!item.clientId) warnings.push({ id: item.id, issue: 'sin clientId' });
      await upsertPendingItem(item);
      imported += 1;
    }

    console.log('✅ Contenido pendiente importado/actualizado correctamente');
    console.log(`Pendientes encontrados: ${items.length}`);
    console.log(`Pendientes importados/actualizados: ${imported}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de contenido pendiente incompleto.');
    }
  } catch (error) {
    console.error('❌ Error importando contenido pendiente desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importPendingContentFromJson();
