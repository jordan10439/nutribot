const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS bot_messages (
  message_key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  value_type TEXT,
  label TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

ALTER TABLE bot_messages
  ADD COLUMN IF NOT EXISTS message_key TEXT,
  ADD COLUMN IF NOT EXISTS value JSONB,
  ADD COLUMN IF NOT EXISTS value_type TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS data JSONB;

UPDATE bot_messages
SET
  value = COALESCE(value, 'null'::jsonb),
  data = COALESCE(data, '{}'::jsonb)
WHERE value IS NULL OR data IS NULL;

ALTER TABLE bot_messages
  ALTER COLUMN value SET NOT NULL,
  ALTER COLUMN data SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bot_messages_message_key_idx
ON bot_messages (message_key);

CREATE INDEX IF NOT EXISTS bot_messages_value_type_idx
ON bot_messages (value_type);
`;

async function migrateMessagesSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de bot_messages adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de bot_messages:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateMessagesSchema();
