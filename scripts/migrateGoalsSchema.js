const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  status TEXT,
  scheduled_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS goal_id TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE goals
SET
  client_id = COALESCE(client_id, CASE WHEN patient_id IS NOT NULL THEN 'legacy_patient_' || patient_id::text ELSE 'legacy_row_' || id::text END),
  goal_id = COALESCE(goal_id, 'legacy_goal_' || id::text),
  data = COALESCE(data, '{}'::jsonb),
  updated_at = COALESCE(updated_at, NOW());

ALTER TABLE goals
  ALTER COLUMN client_id SET NOT NULL,
  ALTER COLUMN goal_id SET NOT NULL,
  ALTER COLUMN data SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'goals_client_goal_unique'
      AND conrelid = 'goals'::regclass
  ) THEN
    ALTER TABLE goals
      ADD CONSTRAINT goals_client_goal_unique UNIQUE (client_id, goal_id);
  END IF;
END $$;
`;

async function migrateGoalsSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de goals adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de goals:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateGoalsSchema();
