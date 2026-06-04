const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/welcomeSchedules.json');

function readWelcomeSchedules() {
  if (!fs.existsSync(FILE)) return null;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return Array.isArray(data) ? data : [];
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function upsertWelcomeSchedule(item) {
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
}

async function importWelcomeSchedulesFromJson() {
  const items = readWelcomeSchedules();
  const warnings = [];
  let imported = 0;

  if (!items) {
    console.log('ℹ️ data/welcomeSchedules.json no existe; no hay bienvenidas programadas para importar.');
    await pool.end();
    return;
  }

  try {
    for (const item of items) {
      if (!item?.id) {
        warnings.push({ clientId: item?.clientId || '', issue: 'sin id' });
        continue;
      }
      if (!item.clientId) {
        warnings.push({ id: item.id, issue: 'sin clientId' });
        continue;
      }
      if (!item.scheduledAt) warnings.push({ id: item.id, issue: 'sin scheduledAt' });
      if (!item.status) warnings.push({ id: item.id, issue: 'sin status' });
      await upsertWelcomeSchedule(item);
      imported += 1;
    }

    console.log('✅ Bienvenidas programadas importadas/actualizadas correctamente');
    console.log(`Bienvenidas encontradas: ${items.length}`);
    console.log(`Bienvenidas importadas/actualizadas: ${imported}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de bienvenidas incompletas.');
    }
  } catch (error) {
    console.error('❌ Error importando bienvenidas programadas desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importWelcomeSchedulesFromJson();
