const db = require('../src/db');
const pool = db.pool || db;

const sql = `
ALTER TABLE patients
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE patients
  DROP CONSTRAINT IF EXISTS patients_phone_key;

DROP INDEX IF EXISTS patients_phone_key;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS client_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS internal_name TEXT,
  ADD COLUMN IF NOT EXISTS context_key TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS nombres JSONB,
  ADD COLUMN IF NOT EXISTS phones JSONB,
  ADD COLUMN IF NOT EXISTS members JSONB,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS welcome JSONB,
  ADD COLUMN IF NOT EXISTS goals JSONB,
  ADD COLUMN IF NOT EXISTS data JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
`;

async function migratePatientsSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de patients adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de patients:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migratePatientsSchema();
