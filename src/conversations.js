// src/conversations.js
// Guarda todos los mensajes enviados y recibidos por paciente
const fs   = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "../data/conversations.json");

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
 * Registra un mensaje
 * @param {string} phone - número del paciente
 * @param {string} tipo - "enviado" | "recibido"
 * @param {string} texto - contenido del mensaje
 * @param {object} extra - datos adicionales
 */
function registrar(phone, tipo, texto, extra = {}) {
  const db = load();
  if (!db[phone]) db[phone] = [];
  db[phone].unshift({
    id: Date.now().toString(),
    tipo,
    texto,
    fecha: new Date().toISOString(),
    ...extra,
  });
  // Máximo 200 mensajes por paciente
  if (db[phone].length > 200) db[phone] = db[phone].slice(0, 200);
  save(db);
}

function getMensajes(phone) {
  return load()[phone] ?? [];
}

function getTodos() {
  const db = load();
  // Aplanar todos los mensajes con el teléfono
  let todos = [];
  for (const [phone, msgs] of Object.entries(db)) {
    todos = todos.concat(msgs.map(m => ({ ...m, phone })));
  }
  return todos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

module.exports = { registrar, getMensajes, getTodos };
