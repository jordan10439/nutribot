const fs = require("fs");
const path = require("path");
const db = require("./db");

const FILE = path.join(__dirname, "../data/patientInfo.json");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const HAS_DATABASE_URL = Boolean(DATABASE_URL);
const pool = db.pool || db;

function load() {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    console.error("[patientInfo] Error leyendo data/patientInfo.json:", e.message);
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  console.log("[patient-info] save llamado", JSON.stringify({ patients: data && typeof data === "object" ? Object.keys(data).length : 0 }));
  syncPatientInfoMirrorToPostgres(data).catch(error => {
    console.warn("[patient-info] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  });
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateValue(value) {
  const text = String(value || "").slice(0, 10);
  if (!text) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function consultationsFor(info) {
  return Array.isArray(info?.consultations) ? info.consultations : [];
}

async function syncPatientInfoClientToPostgres(clientId, info) {
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
    JSON.stringify({ ...(info || {}), consultations }),
    createdAt,
    updatedAt,
  ]);
  console.log("[patient-info] paciente sincronizado", JSON.stringify({ clientId, consultations: consultations.length }));
}

async function syncPatientConsultationToPostgres(clientId, consultation) {
  if (!consultation?.id) return false;
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
  console.log("[patient-info] consulta sincronizada", JSON.stringify({ clientId, consultationId: consultation.id }));
  return true;
}

async function deleteStaleConsultationsForClient(clientId, consultationIds) {
  if (!consultationIds.length) {
    await pool.query("DELETE FROM patient_consultations WHERE client_id = $1", [clientId]);
    return;
  }
  await pool.query("DELETE FROM patient_consultations WHERE client_id = $1 AND consultation_id <> ALL($2::text[])", [clientId, consultationIds]);
}

async function syncPatientInfoMirrorToPostgres(data) {
  if (!HAS_DATABASE_URL) {
    console.warn("[patient-info] DATABASE_URL no está configurada. No se sincronizará espejo PostgreSQL.");
    return;
  }
  const infoByClient = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const entries = Object.entries(infoByClient);
  const consultationCount = entries.reduce((total, [, info]) => total + consultationsFor(info).length, 0);
  console.log("[patient-info] espejo solicitado");
  console.log("[patient-info] pacientes detectados", entries.length);
  console.log("[patient-info] consultas detectadas", consultationCount);
  try {
    let syncedPatients = 0;
    let syncedConsultations = 0;
    for (const [clientId, info] of entries) {
      if (!clientId) continue;
      const consultations = consultationsFor(info);
      await syncPatientInfoClientToPostgres(clientId, { ...(info || {}), consultations });
      syncedPatients += 1;
      const consultationIds = [];
      for (const consultation of consultations) {
        if (!consultation?.id) continue;
        consultationIds.push(consultation.id);
        if (await syncPatientConsultationToPostgres(clientId, consultation)) syncedConsultations += 1;
      }
      await deleteStaleConsultationsForClient(clientId, consultationIds);
    }
    console.log("[patient-info] espejo PostgreSQL sincronizado", JSON.stringify({ patients: syncedPatients, consultations: syncedConsultations }));
  } catch (error) {
    console.warn("[patient-info] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalizeConsultation(input = {}, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || uid(),
    number: existing.number || Number(input.number) || 1,
    consultationDate: String(input.consultationDate || existing.consultationDate || "").slice(0, 10),
    planDeliveredDate: String(input.planDeliveredDate || existing.planDeliveredDate || "").slice(0, 10),
    scheduleReminder: typeof input.scheduleReminder === "undefined" ? existing.scheduleReminder !== false : input.scheduleReminder !== false,
    reminderTemplateType: ["with_button", "without_button"].includes(input.reminderTemplateType) ? input.reminderTemplateType : (existing.reminderTemplateType || "without_button"),
    weight: String(input.weight || existing.weight || "").trim(),
    complications: String(input.complications || existing.complications || "").trim(),
    positives: String(input.positives || existing.positives || "").trim(),
    declaredGoals: String(input.declaredGoals || existing.declaredGoals || "").trim(),
    notes: String(input.notes || existing.notes || "").trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

function getInfo(clientId) {
  const data = load();
  const info = data[clientId] || { consultations: [] };
  const consultations = [...(info.consultations || [])].sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0));
  return { consultations };
}

function addConsultation(clientId, input) {
  const data = load();
  const current = data[clientId] || { consultations: [] };
  const nextNumber = (current.consultations || []).reduce((max, item) => Math.max(max, Number(item.number) || 0), 0) + 1;
  const consultation = normalizeConsultation({ ...input, number: nextNumber });
  current.consultations = [consultation, ...(current.consultations || [])];
  data[clientId] = current;
  save(data);
  return consultation;
}

function updateConsultation(clientId, consultationId, input) {
  const data = load();
  const current = data[clientId] || { consultations: [] };
  const index = (current.consultations || []).findIndex(item => item.id === consultationId);
  if (index < 0) return null;
  const updated = normalizeConsultation(input, current.consultations[index]);
  current.consultations[index] = updated;
  data[clientId] = current;
  save(data);
  return updated;
}

function deleteConsultation(clientId, consultationId) {
  const data = load();
  const current = data[clientId] || { consultations: [] };
  const index = (current.consultations || []).findIndex(item => item.id === consultationId);
  if (index < 0) return null;
  const [deleted] = current.consultations.splice(index, 1);
  data[clientId] = current;
  save(data);
  return deleted;
}

module.exports = { getInfo, addConsultation, updateConsultation, deleteConsultation };
