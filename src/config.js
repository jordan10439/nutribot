// src/config.js
// Configuración editable del bot desde el panel — mensajes, botones, flujos
const fs   = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "../data/config.json");

const DEFAULTS = {
  mensajes: {
    bienvenida:      "¡Hola! 👋 Soy tu Coach Nutricional 🌱\n\n{resumen}\n\n¡Sigue así! 💚",
    meta_enviada:    "✨*¡Nueva meta!*✨\n\n{emoji} *{titulo}*\n\n{descripcion}",
    pedir_foto:      "¡Genial {nombre}! 👏\n\nEnvíame una *foto* como evidencia de tu meta completada 📸",
    pedir_estrellas: "📸 ¡Increíble {nombre}! 🤩\n\n¿Cómo te sientes después de completar la meta?\n\n1️⃣ - Mal\n2️⃣ - Regular\n3️⃣ - Bien\n4️⃣ - Muy bien\n5️⃣ - ¡Excelente!\n\nResponde del 1 al 5",
    pedir_dificultad:"Anotado! ✨\n\n¿Qué tan difícil fue cumplirla?\n\n1️⃣ - Muy fácil\n2️⃣ - Fácil\n3️⃣ - Normal\n4️⃣ - Difícil\n5️⃣ - Muy difícil\n\nResponde del 1 al 5",
    pedir_comentario: "💬 ¿Quieres dejar algún comentario? (opcional)\nResponde lo que quieras o escribe *omitir*",
    meta_completada: "🎉 *¡META COMPLETADA!* 🎉\n\n{ia_mensaje}\n\n➕ *+10 PUNTOS*\n{resumen}",
    esperar_listo:   "Cuando completes la meta, responde *LISTO* 🚀",
    foto_requerida:  "Envíame una foto como evidencia 📸",
    rango_invalido:  "Responde con un número del *1 al 5*",
    pareja_completo: "🎊 *¡Los dos completaron la meta!* ¡Equipo increíble! 💚",
    pareja_esperar:  "⏳ Esperando que tu pareja complete...",
    gracias_comentario: "✍️ ¡Gracias por tu comentario! Tu nutricionista lo podrá ver. 💚",
    sin_comentario:  "¡Perfecto! Hasta la próxima meta. ¡Sigue así! 💪",
  },
  plantilla_meta: "m_ensaje_inicial_nutrigo", // Nombre de la plantilla aprobada en Meta
  plantilla_activa: false, // Cambiar a true cuando Meta apruebe la plantilla
};

function load() {
  try {
    if (!fs.existsSync(FILE)) return DEFAULTS;
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    // Merge con defaults para no perder claves nuevas
    return {
      ...DEFAULTS,
      ...saved,
      mensajes: { ...DEFAULTS.mensajes, ...(saved.mensajes || {}) },
    };
  } catch { return DEFAULTS; }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function get() { return load(); }

function update(partial) {
  const current = load();
  const updated = {
    ...current,
    ...partial,
    mensajes: { ...current.mensajes, ...(partial.mensajes || {}) },
  };
  save(updated);
  return updated;
}

function getMensaje(key) {
  return load().mensajes[key] ?? DEFAULTS.mensajes[key] ?? "";
}

module.exports = { get, update, getMensaje, DEFAULTS };
