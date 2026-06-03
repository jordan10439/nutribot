const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS tip_folders (
  folder_id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS tip_library (
  tip_id TEXT PRIMARY KEY,
  request_id TEXT,
  type TEXT,
  title TEXT,
  description TEXT,
  phrase TEXT,
  filename TEXT,
  folder_id TEXT,
  fingerprint TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS tip_sends (
  send_id TEXT PRIMARY KEY,
  tip_id TEXT,
  client_id TEXT,
  phone TEXT,
  patient_name TEXT,
  recipient_role TEXT,
  message TEXT,
  utility_template_id TEXT,
  scheduled_at TIMESTAMP,
  status TEXT,
  error TEXT,
  sent_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  hidden BOOLEAN DEFAULT FALSE,
  delivery_status TEXT,
  utility_template_message_id TEXT,
  meta_message_id TEXT,
  text_message_id TEXT,
  pending_content_id TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  data JSONB NOT NULL
);
`;

async function migrateTipsSchema() {
  try {
    await pool.query(sql);
    console.log('✅ Esquema de tips adaptado correctamente');
  } catch (error) {
    console.error('❌ Error adaptando esquema de tips:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrateTipsSchema();
