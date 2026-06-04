const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS conversation_messages (
  message_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  client_id TEXT,
  message_type TEXT,
  direction TEXT,
  text TEXT,
  nombre TEXT,
  media JSONB,
  occurred_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS message_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS message_type TEXT,
  ADD COLUMN IF NOT EXISTS direction TEXT,
  ADD COLUMN IF NOT EXISTS text TEXT,
  ADD COLUMN IF NOT EXISTS nombre TEXT,
  ADD COLUMN IF NOT EXISTS media JSONB,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS data JSONB;

UPDATE conversation_messages
SET data = COALESCE(data, '{}'::jsonb)
WHERE data IS NULL;

ALTER TABLE conversation_messages
  ALTER COLUMN data SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_message_id_idx
ON conversation_messages (message_id);

CREATE INDEX IF NOT EXISTS conversation_messages_phone_occurred_idx
ON conversation_messages (phone, occurred_at);

CREATE INDEX IF NOT EXISTS conversation_messages_client_occurred_idx
ON conversation_messages (client_id, occurred_at);

CREATE INDEX IF NOT EXISTS conversation_messages_type_occurred_idx
ON conversation_messages (message_type, occurred_at);
`;

async function migrateConversationsSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de conversation_messages adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de conversation_messages:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateConversationsSchema();
