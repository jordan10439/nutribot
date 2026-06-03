const db = require('../src/db');
const pool = db.pool || db;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testGoalMirror() {
  let client = null;
  let originalGoals = null;
  const goalId = `test_goal_mirror_${Date.now()}`;

  try {
    if (typeof db.initPatientsFromPostgres === 'function') {
      await db.initPatientsFromPostgres();
    }

    client = db.getAll()[0];
    if (!client?.id) throw new Error('No hay pacientes disponibles para probar espejo de metas.');

    originalGoals = Array.isArray(client.goals) ? [...client.goals] : [];
    client.goals = [
      ...originalGoals,
      {
        id: goalId,
        titulo: 'Prueba espejo PostgreSQL',
        descripcion: 'Meta temporal creada por scripts/testGoalMirror.js',
        emoji: '🧪',
        hora: '11:00',
        dias: [],
        specificDate: '',
        createdAt: new Date().toISOString(),
      },
    ];

    console.log('[test-goals] llamando db.upsert con meta temporal', JSON.stringify({ clientId: client.id, goalId }));
    db.upsert(client);
    await sleep(2500);

    const result = await pool.query(
      'SELECT client_id, goal_id, title FROM goals WHERE client_id = $1 AND goal_id = $2',
      [client.id, goalId]
    );

    if (!result.rows.length) throw new Error('La meta temporal no apareció en PostgreSQL.');
    console.log('✅ Espejo de metas funcionando:', result.rows[0]);
  } catch (error) {
    console.error('❌ Error probando espejo de metas:', error.message);
    process.exitCode = 1;
  } finally {
    if (client && originalGoals) {
      client.goals = originalGoals;
      db.upsert(client);
      await sleep(1000);
      await pool.query('DELETE FROM goals WHERE client_id = $1 AND goal_id = $2', [client.id, goalId]).catch(() => {});
    }
    await pool.end();
  }
}

testGoalMirror();
