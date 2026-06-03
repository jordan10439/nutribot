const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS consultation_reminders (
  reminder_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  phone TEXT,
  recipient_name TEXT,
  patient_name TEXT,
  consultation_id TEXT,
  consultation_number INTEGER,
  template_type TEXT,
  template_name TEXT,
  language_code TEXT,
  status TEXT,
  error TEXT,
  pauta_delivered_at DATE,
  follow_up_ends_at DATE,
  scheduled_date DATE,
  scheduled_time TEXT,
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  meta_message_id TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS consultation_reminders_client_consultation_phone_idx
ON consultation_reminders (client_id, consultation_id, phone);

CREATE INDEX IF NOT EXISTS consultation_reminders_status_scheduled_idx
ON consultation_reminders (status, scheduled_at);
`;

async function migrateConsultationRemindersSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de consultation_reminders adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de consultation_reminders:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateConsultationRemindersSchema();
