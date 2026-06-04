const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/patientInfo.json');

function readPatientInfo() {
  if (!fs.existsSync(FILE)) return null;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateValue(value) {
  const text = String(value || '').slice(0, 10);
  if (!text) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function consultationsFor(info) {
  return Array.isArray(info?.consultations) ? info.consultations : [];
}

async function upsertPatientInfo(clientId, info) {
  const consultations = consultationsFor(info);
  const timestamps = consultations.flatMap(item => [timestampValue(item.createdAt), timestampValue(item.updatedAt)]).filter(Boolean);
  const createdAt = timestamps.length ? timestamps.sort()[0] : new Date().toISOString();
  const updatedAt = consultations.reduce((latest, item) => {
    const value = timestampValue(item.updatedAt) || timestampValue(item.createdAt);
    return value && value > latest ? value : latest;
  }, createdAt);

  await pool.query(`
    INSERT INTO patient_info (
      client_id,
      consultations,
      data,
      created_at,
      updated_at
    )
    VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)
    ON CONFLICT (client_id) DO UPDATE SET
      consultations = EXCLUDED.consultations,
      data = EXCLUDED.data,
      created_at = COALESCE(patient_info.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at
  `, [
    clientId,
    JSON.stringify(consultations),
    JSON.stringify(info || { consultations: [] }),
    createdAt,
    updatedAt,
  ]);
}

async function upsertPatientConsultation(clientId, consultation) {
  await pool.query(`
    INSERT INTO patient_consultations (
      consultation_id,
      client_id,
      consultation_number,
      consultation_date,
      plan_delivered_date,
      schedule_reminder,
      reminder_template_type,
      weight,
      complications,
      positives,
      declared_goals,
      notes,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
    ON CONFLICT (consultation_id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      consultation_number = EXCLUDED.consultation_number,
      consultation_date = EXCLUDED.consultation_date,
      plan_delivered_date = EXCLUDED.plan_delivered_date,
      schedule_reminder = EXCLUDED.schedule_reminder,
      reminder_template_type = EXCLUDED.reminder_template_type,
      weight = EXCLUDED.weight,
      complications = EXCLUDED.complications,
      positives = EXCLUDED.positives,
      declared_goals = EXCLUDED.declared_goals,
      notes = EXCLUDED.notes,
      created_at = COALESCE(patient_consultations.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    consultation.id,
    clientId,
    Number.isFinite(Number(consultation.number)) ? Number(consultation.number) : null,
    dateValue(consultation.consultationDate),
    dateValue(consultation.planDeliveredDate),
    consultation.scheduleReminder !== false,
    consultation.reminderTemplateType || null,
    consultation.weight || null,
    consultation.complications || null,
    consultation.positives || null,
    consultation.declaredGoals || null,
    consultation.notes || null,
    timestampValue(consultation.createdAt),
    timestampValue(consultation.updatedAt) || new Date().toISOString(),
    JSON.stringify(consultation),
  ]);
}

async function importPatientInfoFromJson() {
  const data = readPatientInfo();
  const warnings = [];
  let patientCount = 0;
  let importedPatients = 0;
  let consultationCount = 0;
  let importedConsultations = 0;

  if (!data) {
    console.log('ℹ️ data/patientInfo.json no existe; no hay información de pacientes para importar.');
    await pool.end();
    return;
  }

  try {
    for (const [clientId, info] of Object.entries(data)) {
      if (!clientId) {
        warnings.push({ issue: 'sin clientId' });
        continue;
      }
      patientCount += 1;
      const consultations = consultationsFor(info);
      await upsertPatientInfo(clientId, { ...(info || {}), consultations });
      importedPatients += 1;

      for (const consultation of consultations) {
        consultationCount += 1;
        if (!consultation?.id) {
          warnings.push({ clientId, issue: 'consulta sin id' });
          continue;
        }
        if (!consultation.consultationDate) warnings.push({ clientId, consultationId: consultation.id, issue: 'sin consultationDate' });
        if (!consultation.planDeliveredDate) warnings.push({ clientId, consultationId: consultation.id, issue: 'sin planDeliveredDate' });
        await upsertPatientConsultation(clientId, consultation);
        importedConsultations += 1;
      }
    }

    console.log('✅ Información de pacientes importada/actualizada correctamente');
    console.log(`Pacientes con información encontrados: ${patientCount}`);
    console.log(`Pacientes importados/actualizados: ${importedPatients}`);
    console.log(`Consultas encontradas: ${consultationCount}`);
    console.log(`Consultas importadas/actualizadas: ${importedConsultations}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de información incompleta.');
    }
  } catch (error) {
    console.error('❌ Error importando información de pacientes desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importPatientInfoFromJson();
