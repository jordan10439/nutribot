const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/patientInfo.json");

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

module.exports = { getInfo, addConsultation, updateConsultation };
