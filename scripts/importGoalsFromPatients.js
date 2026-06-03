const crypto = require('crypto');
const db = require('../src/db');
const pool = db.pool || db;

function normalizeGoalId(clientId, goal, index, warnings) {
  const existingId = String(goal?.id || goal?.goalId || '').trim();
  if (existingId) return existingId;

  const seed = JSON.stringify({
    clientId,
    index,
    title: goal?.titulo || goal?.title || '',
    description: goal?.descripcion || goal?.description || '',
    createdAt: goal?.createdAt || goal?.fechaCreacion || '',
    scheduledAt: goal?.scheduledAt || goal?.specificDate || goal?.fecha || '',
  });
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
  const generated = `goal_${index + 1}_${hash}`;
  warnings.push({
    clientId,
    goalIndex: index,
    generatedGoalId: generated,
    issue: 'Meta sin id; se generó goal_id estable para PostgreSQL.',
  });
  return generated;
}

function goalTitle(goal) {
  return String(goal?.titulo || goal?.title || goal?.nombre || '').trim();
}

function goalDescription(goal) {
  return String(goal?.descripcion || goal?.description || goal?.detalle || '').trim();
}

function goalStatus(goal) {
  return String(goal?.status || goal?.estado || goal?.state || '').trim() || 'pendiente';
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function scheduledAtFor(goal) {
  if (goal?.scheduledAt) return parseTimestamp(goal.scheduledAt);
  const date = String(goal?.specificDate || goal?.fecha || '').slice(0, 10);
  const time = String(goal?.hora || '').slice(0, 5);
  if (!date || !time) return null;
  return parseTimestamp(`${date}T${time}:00`);
}

async function upsertGoal(clientId, goal, index, warnings) {
  const goalId = normalizeGoalId(clientId, goal, index, warnings);
  const title = goalTitle(goal);
  const description = goalDescription(goal);
  if (!title) {
    warnings.push({ clientId, goalId, goalIndex: index, issue: 'Meta sin título.' });
  }

  await pool.query(`
    INSERT INTO goals (
      client_id,
      goal_id,
      title,
      description,
      status,
      scheduled_at,
      sent_at,
      completed_at,
      data,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
    ON CONFLICT (client_id, goal_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      scheduled_at = EXCLUDED.scheduled_at,
      sent_at = EXCLUDED.sent_at,
      completed_at = EXCLUDED.completed_at,
      data = EXCLUDED.data,
      updated_at = NOW()
  `, [
    clientId,
    goalId,
    title || null,
    description || null,
    goalStatus(goal),
    scheduledAtFor(goal),
    parseTimestamp(goal?.sentAt || goal?.enviadaAt || goal?.lastSentAt),
    parseTimestamp(goal?.completedAt || goal?.completadaAt),
    JSON.stringify(goal || {}),
  ]);
}

async function importGoalsFromPatients() {
  const warnings = [];
  let patients = [];
  let goalsFound = 0;
  let goalsImported = 0;

  try {
    if (typeof db.initPatientsFromPostgres === 'function') {
      await db.initPatientsFromPostgres();
    }
    patients = db.getAll();

    for (const client of patients) {
      const clientId = client?.id;
      if (!clientId) {
        warnings.push({ patient: client?.displayName || client?.name || '(sin nombre)', issue: 'Paciente sin id; se omiten sus metas.' });
        continue;
      }
      const goals = Array.isArray(client.goals) ? client.goals : [];
      goalsFound += goals.length;
      for (let index = 0; index < goals.length; index += 1) {
        await upsertGoal(clientId, goals[index], index, warnings);
        goalsImported += 1;
      }
    }

    const count = await pool.query('SELECT COUNT(*)::int AS count FROM goals WHERE client_id IS NOT NULL AND goal_id IS NOT NULL');
    console.log('✅ Metas importadas/actualizadas correctamente');
    console.log(`Pacientes revisados: ${patients.length}`);
    console.log(`Metas encontradas en client.goals: ${goalsFound}`);
    console.log(`Metas importadas/actualizadas: ${goalsImported}`);
    console.log(`Metas con client_id y goal_id en PostgreSQL: ${count.rows[0].count}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de metas incompletas.');
    }
  } catch (error) {
    console.error('❌ Error importando metas desde pacientes:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importGoalsFromPatients();
