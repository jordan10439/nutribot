const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS patient_info (
  client_id TEXT PRIMARY KEY,
  consultations JSONB,
  data JSONB NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_consultations (
  consultation_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  consultation_number INTEGER,
  consultation_date DATE,
  plan_delivered_date DATE,
  schedule_reminder BOOLEAN,
  reminder_template_type TEXT,
  weight TEXT,
  complications TEXT,
  positives TEXT,
  declared_goals TEXT,
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

ALTER TABLE patient_info
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS consultations JSONB,
  ADD COLUMN IF NOT EXISTS data JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

ALTER TABLE patient_consultations
  ADD COLUMN IF NOT EXISTS consultation_id TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS consultation_number INTEGER,
  ADD COLUMN IF NOT EXISTS consultation_date DATE,
  ADD COLUMN IF NOT EXISTS plan_delivered_date DATE,
  ADD COLUMN IF NOT EXISTS schedule_reminder BOOLEAN,
  ADD COLUMN IF NOT EXISTS reminder_template_type TEXT,
  ADD COLUMN IF NOT EXISTS weight TEXT,
  ADD COLUMN IF NOT EXISTS complications TEXT,
  ADD COLUMN IF NOT EXISTS positives TEXT,
  ADD COLUMN IF NOT EXISTS declared_goals TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS data JSONB;

UPDATE patient_info
SET data = COALESCE(data, '{}'::jsonb)
WHERE data IS NULL;

UPDATE patient_consultations
SET data = COALESCE(data, '{}'::jsonb)
WHERE data IS NULL;

ALTER TABLE patient_info
  ALTER COLUMN data SET NOT NULL;

ALTER TABLE patient_consultations
  ALTER COLUMN data SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS patient_info_client_id_idx
ON patient_info (client_id);

CREATE UNIQUE INDEX IF NOT EXISTS patient_consultations_consultation_id_idx
ON patient_consultations (consultation_id);

CREATE INDEX IF NOT EXISTS patient_consultations_client_idx
ON patient_consultations (client_id);

CREATE INDEX IF NOT EXISTS patient_consultations_plan_delivered_idx
ON patient_consultations (plan_delivered_date);
`;

async function migratePatientInfoSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de patientInfo adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de patientInfo:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migratePatientInfoSchema();
