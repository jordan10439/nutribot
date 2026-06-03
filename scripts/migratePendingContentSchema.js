const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS pending_content (
  pending_id TEXT PRIMARY KEY,
  client_id TEXT,
  phone TEXT NOT NULL,
  original_phone TEXT,
  patient_name TEXT,
  type TEXT NOT NULL,
  status TEXT,
  trigger_template_id TEXT,
  trigger_template_name TEXT,
  trigger_button_labels JSONB,
  template_message_id TEXT,
  payload JSONB,
  result JSONB,
  error TEXT,
  last_error TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  dedupe_key TEXT,
  data JSONB NOT NULL
);

ALTER TABLE pending_content
  ADD COLUMN IF NOT EXISTS pending_id TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS original_phone TEXT,
  ADD COLUMN IF NOT EXISTS patient_name TEXT,
  ADD COLUMN IF NOT EXISTS trigger_template_id TEXT,
  ADD COLUMN IF NOT EXISTS trigger_template_name TEXT,
  ADD COLUMN IF NOT EXISTS trigger_button_labels JSONB,
  ADD COLUMN IF NOT EXISTS template_message_id TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS result JSONB,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS data JSONB;

UPDATE pending_content
SET
  pending_id = COALESCE(pending_id, 'legacy_pending_' || md5(ctid::text)),
  data = COALESCE(data, '{}'::jsonb)
WHERE pending_id IS NULL OR data IS NULL;

ALTER TABLE pending_content
  ALTER COLUMN pending_id SET NOT NULL,
  ALTER COLUMN data SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pending_content_pending_id_idx
ON pending_content (pending_id);

CREATE INDEX IF NOT EXISTS pending_content_phone_status_idx
ON pending_content (phone, status);

CREATE INDEX IF NOT EXISTS pending_content_client_status_idx
ON pending_content (client_id, status);

CREATE INDEX IF NOT EXISTS pending_content_template_message_idx
ON pending_content (template_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS pending_content_active_dedupe_idx
ON pending_content (dedupe_key)
WHERE status = 'waiting_patient_interaction';
`;

async function migratePendingContentSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de pending_content adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de pending_content:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migratePendingContentSchema();
