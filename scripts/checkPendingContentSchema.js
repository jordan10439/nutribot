const db = require('../src/db');
const pool = db.pool || db;

async function checkPendingContentSchema() {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'pending_content'
      ORDER BY ordinal_position
    `);

    if (!result.rows.length) {
      console.log('La tabla pending_content no existe o no tiene columnas visibles.');
      return;
    }

    console.log('Columnas actuales de pending_content:');
    for (const row of result.rows) {
      console.log(`- ${row.column_name} (${row.data_type})`);
    }
  } catch (error) {
    console.error('❌ Error revisando esquema de pending_content:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

checkPendingContentSchema();
