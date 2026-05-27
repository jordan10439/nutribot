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

function datePartsInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function nextScheduledLocal(goal, timezone, now = new Date()) {
  if (!goal?.hora) return "";
  const [hour, minute] = String(goal.hora).split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
  const tz = timezone || "America/Santiago";
  const today = datePartsInTimezone(now, tz);
  const weekdays = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const allowedDays = goal.dias?.length ? goal.dias.map(Number) : [1, 2, 3, 4, 5];
  const specificDate = goal.specificDate ? String(goal.specificDate).slice(0, 10) : "";

  for (let offset = 0; offset <= 14; offset++) {
    const candidate = datePartsInTimezone(new Date(now.getTime() + offset * 86400000), tz);
    const dateKey = `${candidate.year}-${candidate.month}-${candidate.day}`;
    if (specificDate && dateKey !== specificDate) continue;
    if (!specificDate && !allowedDays.includes(weekdays[candidate.weekday])) continue;
    const nowMinutes = Number(today.hour) * 60 + Number(today.minute);
    const scheduledMinutes = hour * 60 + minute;
    if (offset === 0 && scheduledMinutes <= nowMinutes) continue;
    return `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  }
  return "";
}

function getGoalsDashboard(clients, sourceHistory) {
  const allHistory = sourceHistory || load();
  const allowedTypes = new Set(["meta_enviada", "meta_error", "plantilla_previa_error", "no_completada", "seguimiento_meta", "completada", "mensaje_recibido"]);
  const statusLabel = {
    pendiente: "Pendiente",
    enviada: "Enviada",
    programada: "Programada",
    completada: "Completada",
    no_completada: "No completada",
    en_seguimiento: "En seguimiento",
    error: "Error",
  };

  const goals = [];
  const summaries = [];

  for (const client of clients) {
    const clientHistory = allHistory[client.id] || [];
    const clientGoals = client.goals || [];

    for (const goal of clientGoals) {
      const events = clientHistory
        .filter(entry => allowedTypes.has(entry.tipo) && (
          entry.goalId ? entry.goalId === goal.id : entry.meta === goal.titulo
        ))
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      const sendEvent = events.find(entry => ["meta_enviada", "meta_error", "plantilla_previa_error"].includes(entry.tipo));
      const cycleStartedAt = sendEvent ? new Date(sendEvent.fecha).getTime() : 0;
      const currentEvents = cycleStartedAt
        ? events.filter(entry => new Date(entry.fecha).getTime() >= cycleStartedAt)
        : events;
      const completed = currentEvents.find(entry => entry.tipo === "completada");
      const followup = currentEvents.find(entry => entry.tipo === "seguimiento_meta");
      const declined = currentEvents.find(entry => entry.tipo === "no_completada");
      const failed = currentEvents.find(entry => ["meta_error", "plantilla_previa_error"].includes(entry.tipo));
      const lastResponse = currentEvents.find(entry => ["seguimiento_meta", "completada", "no_completada", "mensaje_recibido"].includes(entry.tipo));
      const photoEvent = currentEvents.find(entry => entry.media?.id);
      const difficulty = followup?.dificultad || completed?.dificultad || "";
      const scheduledAt = nextScheduledLocal(goal, client.timezone);
      const photoReviewPending = !!photoEvent;
      const reviewReasons = [
        (followup?.estadoEmocional === "negativo" || completed?.estadoEmocional === "negativo") ? "Respuesta emocional negativa" : "",
        difficulty === "Difícil" ? "Dificultad alta" : "",
        photoReviewPending ? "Foto pendiente de revisar" : "",
      ].filter(Boolean);
      const requiresReview = !!(followup?.requiereRevision || completed?.requiereRevision || reviewReasons.length);
      let status = scheduledAt ? "programada" : "pendiente";
      if (failed && !completed) status = "error";
      else if (completed) status = "completada";
      else if (followup) status = "en_seguimiento";
      else if (declined) status = "no_completada";
      else if (sendEvent) status = "enviada";

      goals.push({
        key: `${client.id}:${goal.id}`,
        clientId: client.id,
        patientName: (client.nombres || []).join(" & "),
        goalId: goal.id,
        title: goal.titulo,
        description: goal.descripcion || "",
        emoji: goal.emoji || "🎯",
        requiresPhoto: !!goal.requiereFoto,
        sentAt: sendEvent?.fecha || "",
        scheduledAt: status === "programada" ? scheduledAt : "",
        deliveryStatus: sendEvent?.deliveryStatus || "",
        deliveryError: failed?.comentario || "",
        status,
        statusLabel: statusLabel[status],
        emotionalResponse: followup?.respuestaEmocional || "",
        emotionalState: followup?.estadoEmocional || completed?.estadoEmocional || "",
        emotionalReaction: followup?.reaccionEmocional || "",
        difficultyResponse: followup?.respuestaDificultad || "",
        difficulty,
        difficultyReaction: followup?.reaccionDificultad || "",
        comment: completed?.comentario || "",
        photo: photoEvent?.media || null,
        photoAt: photoEvent?.fecha || "",
        photoComment: photoEvent?.comentario || "",
        photoReviewPending,
        requiresReview,
        reviewReasons,
        lastResponseAt: lastResponse?.fecha || "",
        points: completed ? Number(completed.puntos) || 10 : 0,
        events,
      });
    }

    const patientGoals = goals.filter(goal => goal.clientId === client.id);
    const completedCount = patientGoals.filter(goal => goal.status === "completada").length;
    const reviewCount = patientGoals.filter(goal => goal.requiresReview).length;
    const difficultCount = patientGoals.filter(goal => goal.difficulty === "Difícil").length;
    const total = patientGoals.length;
    const pending = Math.max(total - completedCount, 0);
    const generalStatus = reviewCount
      ? "Requiere revisión"
      : total > 0 && completedCount === total
        ? "Completado"
        : total > 0 && completedCount >= Math.ceil(total / 2)
          ? "Buen avance"
          : "En progreso";
    summaries.push({
      clientId: client.id,
      patientName: (client.nombres || []).join(" & "),
      total,
      completed: completedCount,
      points: completedCount * 10,
      possiblePoints: total * 10,
      pending,
      difficult: difficultCount,
      requiresReview: reviewCount,
      generalStatus,
    });
  }

  return { goals, summaries };
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

module.exports = { registrar, getHistorial, getResumen, getGoalsDashboard, updateByMetaMessageId, updateById };
