const db = require('../src/db');
const pool = db.pool || db;

const sql = `
CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tips (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  scheduled_at TIMESTAMP,
  status TEXT DEFAULT 'programado',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_history (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  message_type TEXT,
  content TEXT,
  status TEXT,
  error TEXT,
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_content (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  type TEXT NOT NULL,
  content JSONB NOT NULL,
  status TEXT DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT NOW()
);
`;

async function initDb() {
  try {
    await pool.query(sql);
    console.log('✅ Tablas creadas correctamente');
  } catch (error) {
    console.error('❌ Error creando tablas:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

initDb();
