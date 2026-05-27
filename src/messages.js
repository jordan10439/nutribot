// src/messages.js
// Mensajes del bot editables desde el panel — se guardan en data/mensajes.json

const fs   = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "../data/mensajes.json");

const DEFAULTS = {
  bienvenida: "¡Hola, soy NutriGO! 👋🌱\n\nSoy tu herramienta de apoyo nutricional. Te enviaré recordatorios de tus metas para ayudarte a mantenerlas presentes, de forma simple y sin presiones. 💚",
  pedir_listo: "Cuando hayas completado la meta, responde *LISTO* 🚀",
  pedir_foto: "¡Genial! 👏\n\nEnvíame una *foto* como evidencia de tu meta completada 📸",
  pedir_estrellas: "📸 ¡Increíble! 🤩\n\n¿Cómo te sientes después de completar la meta?\n\n1️⃣ - Mal\n2️⃣ - Regular\n3️⃣ - Bien\n4️⃣ - Muy bien\n5️⃣ - ¡Excelente!\n\nResponde del 1 al 5",
  pedir_dificultad: "Anotado ✨\n\n¿Qué tan difícil fue cumplirla?\n\n1️⃣ - Muy fácil\n2️⃣ - Fácil\n3️⃣ - Normal\n4️⃣ - Difícil\n5️⃣ - Muy difícil\n\nResponde del 1 al 5",
  pedir_comentario: "💬 ¿Quieres dejar algún comentario? (opcional)\nEscribe lo que quieras o responde *omitir*",
  meta_completada: "🎉 *¡META COMPLETADA!* 🎉\n\n{ia}\n\n➕ *+10 PUNTOS*\n{resumen}",
  sin_registro: "¡Hola! 👋 Pídele a tu nutricionista que te registre en el programa. 🌱",
};

function load() {
  try {
    if (!fs.existsSync(FILE)) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch { return { ...DEFAULTS }; }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function get(key) {
  return load()[key] ?? DEFAULTS[key] ?? "";
}

function getAll() {
  return load();
}

function set(key, value) {
  const data = load();
  data[key] = value;
  save(data);
}

function reset(key) {
  const data = load();
  data[key] = DEFAULTS[key];
  save(data);
}

function resetAll() {
  save({ ...DEFAULTS });
}

const LABELS = {
  bienvenida:       "Texto legado de bienvenida (el registro usa plantilla Meta)",
  pedir_listo:      "Pedir confirmación de meta completada",
  pedir_foto:       "Pedir foto de evidencia",
  pedir_estrellas:  "Pedir calificación de bienestar (1-5)",
  pedir_dificultad: "Pedir nivel de dificultad (1-5)",
  pedir_comentario: "Pedir comentario opcional",
  meta_completada:  "Mensaje de meta completada (usa {ia} y {resumen})",
  sin_registro:     "Mensaje para paciente no registrado",
};

module.exports = { get, getAll, set, reset, resetAll, LABELS, DEFAULTS };
