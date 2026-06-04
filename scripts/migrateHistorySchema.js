const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS history_events (
  event_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  phone TEXT,
  nombre TEXT,
  event_type TEXT,
  direction TEXT,
  goal_id TEXT,
  send_id TEXT,
  pending_content_id TEXT,
  meta_message_id TEXT,
  interaction_message_id TEXT,
  title TEXT,
  emoji TEXT,
  comment TEXT,
  delivery_status TEXT,
  delivery_stage TEXT,
  requires_review BOOLEAN,
  media JSONB,
  occurred_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

ALTER TABLE history_events
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS nombre TEXT,
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS direction TEXT,
  ADD COLUMN IF NOT EXISTS goal_id TEXT,
  ADD COLUMN IF NOT EXISTS send_id TEXT,
  ADD COLUMN IF NOT EXISTS pending_content_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_message_id TEXT,
  ADD COLUMN IF NOT EXISTS interaction_message_id TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS emoji TEXT,
  ADD COLUMN IF NOT EXISTS comment TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS delivery_stage TEXT,
  ADD COLUMN IF NOT EXISTS requires_review BOOLEAN,
  ADD COLUMN IF NOT EXISTS media JSONB,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS data JSONB;

UPDATE history_events
SET data = COALESCE(data, '{}'::jsonb)
WHERE data IS NULL;

ALTER TABLE history_events
  ALTER COLUMN data SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS history_events_event_id_idx
ON history_events (event_id);

CREATE INDEX IF NOT EXISTS history_events_client_occurred_idx
ON history_events (client_id, occurred_at);

CREATE INDEX IF NOT EXISTS history_events_phone_occurred_idx
ON history_events (phone, occurred_at);

CREATE INDEX IF NOT EXISTS history_events_type_occurred_idx
ON history_events (event_type, occurred_at);

CREATE INDEX IF NOT EXISTS history_events_goal_idx
ON history_events (goal_id);

CREATE INDEX IF NOT EXISTS history_events_meta_message_idx
ON history_events (meta_message_id);

CREATE INDEX IF NOT EXISTS history_events_interaction_message_idx
ON history_events (interaction_message_id);

CREATE INDEX IF NOT EXISTS history_events_pending_content_idx
ON history_events (pending_content_id);
`;

async function migrateHistorySchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de history_events adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de history_events:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateHistorySchema();
