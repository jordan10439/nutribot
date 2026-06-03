const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/consultationReminders.json');

function readReminders() {
  if (!fs.existsSync(FILE)) return null;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return Array.isArray(data) ? data : [];
}

function dateValue(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function timestampValue(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    return raw.replace('T', ' ');
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function upsertReminder(item) {
  await pool.query(`
    INSERT INTO consultation_reminders (
      reminder_id,
      client_id,
      phone,
      recipient_name,
      patient_name,
      consultation_id,
      consultation_number,
      template_type,
      template_name,
      language_code,
      status,
      error,
      pauta_delivered_at,
      follow_up_ends_at,
      scheduled_date,
      scheduled_time,
      scheduled_at,
      sent_at,
      meta_message_id,
      created_at,
      updated_at,
      data
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22::jsonb
    )
    ON CONFLICT (reminder_id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      phone = EXCLUDED.phone,
      recipient_name = EXCLUDED.recipient_name,
      patient_name = EXCLUDED.patient_name,
      consultation_id = EXCLUDED.consultation_id,
      consultation_number = EXCLUDED.consultation_number,
      template_type = EXCLUDED.template_type,
      template_name = EXCLUDED.template_name,
      language_code = EXCLUDED.language_code,
      status = EXCLUDED.status,
      error = EXCLUDED.error,
      pauta_delivered_at = EXCLUDED.pauta_delivered_at,
      follow_up_ends_at = EXCLUDED.follow_up_ends_at,
      scheduled_date = EXCLUDED.scheduled_date,
      scheduled_time = EXCLUDED.scheduled_time,
      scheduled_at = EXCLUDED.scheduled_at,
      sent_at = EXCLUDED.sent_at,
      meta_message_id = EXCLUDED.meta_message_id,
      created_at = COALESCE(consultation_reminders.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    item.id,
    item.clientId,
    item.phone || null,
    item.recipientName || null,
    item.patientName || null,
    item.consultationId || null,
    Number.isFinite(Number(item.consultationNumber)) ? Number(item.consultationNumber) : null,
    item.templateType || null,
    item.templateName || null,
    item.languageCode || null,
    item.status || null,
    item.error || null,
    dateValue(item.pautaDeliveredAt),
    dateValue(item.followUpEndsAt),
    dateValue(item.scheduledDate),
    item.scheduledTime || null,
    timestampValue(item.scheduledAt),
    timestampValue(item.sentAt),
    item.metaMessageId || null,
    timestampValue(item.createdAt),
    timestampValue(item.updatedAt) || timestampValue(item.createdAt) || new Date().toISOString(),
    JSON.stringify(item),
  ]);
}

async function importConsultationRemindersFromJson() {
  const reminders = readReminders();
  const warnings = [];
  let imported = 0;

  if (!reminders) {
    console.log('ℹ️ data/consultationReminders.json no existe; no hay recordatorios para importar.');
    await pool.end();
    return;
  }

  try {
    for (const item of reminders) {
      if (!item?.id) {
        warnings.push({ type: 'reminder', consultationId: item?.consultationId || '', issue: 'sin id' });
        continue;
      }
      if (!item.clientId) {
        warnings.push({ id: item.id, issue: 'sin clientId' });
        continue;
      }
      if (!item.phone) warnings.push({ id: item.id, clientId: item.clientId, issue: 'sin phone' });
      if (!item.consultationId) warnings.push({ id: item.id, clientId: item.clientId, issue: 'sin consultationId' });
      await upsertReminder(item);
      imported += 1;
    }

    console.log('✅ Recordatorios de consulta importados/actualizados correctamente');
    console.log(`Recordatorios encontrados: ${reminders.length}`);
    console.log(`Recordatorios importados/actualizados: ${imported}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de recordatorios incompletos.');
    }
  } catch (error) {
    console.error('❌ Error importando recordatorios de consulta desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importConsultationRemindersFromJson();
