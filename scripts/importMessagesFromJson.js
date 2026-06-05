const fs = require('fs');
const path = require('path');
const messages = require('../src/messages');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/mensajes.json');

function readMessages() {
  if (!fs.existsSync(FILE)) return messages.DEFAULTS ? { ...messages.DEFAULTS } : null;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function getMessageValueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

async function upsertMessage(key, value) {
  const valueType = getMessageValueType(value);
  const label = messages.LABELS?.[key] || '';
  const data = { key, value, label, valueType };
  await pool.query(`
    INSERT INTO bot_messages (
      message_key,
      value,
      value_type,
      label,
      is_default,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2::jsonb, $3, $4, false, $5, $5, $6::jsonb)
    ON CONFLICT (message_key) DO UPDATE SET
      value = EXCLUDED.value,
      value_type = EXCLUDED.value_type,
      label = EXCLUDED.label,
      is_default = EXCLUDED.is_default,
      created_at = COALESCE(bot_messages.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    key,
    JSON.stringify(value),
    valueType,
    label,
    new Date().toISOString(),
    JSON.stringify(data),
  ]);
}

async function importMessagesFromJson() {
  const data = readMessages();
  const warnings = [];
  let found = 0;
  let imported = 0;

  if (!data) {
    console.log('ℹ️ data/mensajes.json no existe y no hay defaults expuestos; no hay mensajes para importar.');
    await pool.end();
    return;
  }

  try {
    for (const [key, value] of Object.entries(data)) {
      found += 1;
      if (!key) {
        warnings.push({ issue: 'clave vacía' });
        continue;
      }
      const valueType = getMessageValueType(value);
      if (!['string', 'array', 'number', 'boolean', 'object', 'null'].includes(valueType)) {
        warnings.push({ key, issue: `valor inválido (${valueType})` });
        continue;
      }
      await upsertMessage(key, value);
      imported += 1;
    }

    console.log('✅ Mensajes importados/actualizados correctamente');
    console.log(`Mensajes encontrados: ${found}`);
    console.log(`Mensajes importados/actualizados: ${imported}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de mensajes incompletos.');
    }
  } catch (error) {
    console.error('❌ Error importando mensajes desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importMessagesFromJson();
