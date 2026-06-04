const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS welcome_schedules (
  schedule_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  template_type TEXT,
  scheduled_at TIMESTAMP,
  status TEXT,
  error TEXT,
  sent_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

ALTER TABLE welcome_schedules
  ADD COLUMN IF NOT EXISTS schedule_id TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS template_type TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS data JSONB;

UPDATE welcome_schedules
SET data = COALESCE(data, '{}'::jsonb)
WHERE data IS NULL;

ALTER TABLE welcome_schedules
  ALTER COLUMN data SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS welcome_schedules_schedule_id_idx
ON welcome_schedules (schedule_id);

CREATE INDEX IF NOT EXISTS welcome_schedules_client_idx
ON welcome_schedules (client_id);

CREATE INDEX IF NOT EXISTS welcome_schedules_status_scheduled_idx
ON welcome_schedules (status, scheduled_at);
`;

async function migrateWelcomeSchedulesSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de welcome_schedules adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de welcome_schedules:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateWelcomeSchedulesSchema();
