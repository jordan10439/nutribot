// src/history.js
// Guarda el historial completo de conversaciones por cliente

const fs   = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "../data/history.json");

function load() {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch { return {}; }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/**
 * Registra una entrada en el historial de un cliente
 * @param {string} clientId 
 * @param {string} phone - teléfono del paciente
 * @param {string} nombre - nombre del paciente
 * @param {object} entry - datos de la conversación
 */
function registrar(clientId, phone, nombre, entry) {
  const db = load();
  if (!db[clientId]) db[clientId] = [];
  const savedEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    phone,
    nombre,
    fecha: new Date().toISOString(),
    ...entry,
  };
  db[clientId].unshift(savedEntry);
  // Mantener solo los últimos 100 registros por cliente
  if (db[clientId].length > 100) db[clientId] = db[clientId].slice(0, 100);
  save(db);
  return savedEntry;
}

function getHistorial(clientId) {
  return load()[clientId] ?? [];
}

function getResumen(clientId) {
  const h = load()[clientId] ?? [];
  const completadas  = h.filter(e => e.tipo === "completada").length;
  const noCompletadas = h.filter(e => e.tipo === "no_completada").length;
  const promEstrellas = h.filter(e => e.estrellas).reduce((acc, e, _, arr) => acc + e.estrellas / arr.length, 0);
  return { completadas, noCompletadas, total: h.length, promEstrellas: promEstrellas.toFixed(1) };
}

function updateByMetaMessageId(messageId, patch) {
  const db = load();
  let updated = null;
  for (const entries of Object.values(db)) {
    const entry = entries.find(item => item.metaMessageId === messageId || item.interactionMessageId === messageId);
    if (entry) {
      Object.assign(entry, patch);
      updated = entry;
      break;
    }
  }
  if (updated) save(db);
  return updated;
}

function updateById(clientId, id, patch) {
  const db = load();
  const entry = db[clientId]?.find(item => item.id === id);
  if (!entry) return null;
  Object.assign(entry, patch);
  save(db);
  return entry;
}

module.exports = { registrar, getHistorial, getResumen, updateByMetaMessageId, updateById };
