// src/history.js
// Guarda el historial completo de conversaciones por cliente

const fs   = require("fs");
const path = require("path");
const db = require("./db");
const FILE = path.join(__dirname, "../data/history.json");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const HAS_DATABASE_URL = Boolean(DATABASE_URL);
const pool = db.pool || db;

function load() {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch { return {}; }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  console.log("[history] save llamado", JSON.stringify({ clients: data && typeof data === "object" ? Object.keys(data).length : 0 }));
  syncHistoryMirrorToPostgres(data).catch(error => {
    console.warn("[history] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  });
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractHistoryEventFields(clientId, event) {
  const occurredAt = timestampValue(event.fecha || event.createdAt || event.updatedAt);
  return {
    eventId: event.id,
    clientId,
    phone: event.phone || null,
    nombre: event.nombre || null,
    eventType: event.tipo || null,
    direction: event.direccion || null,
    goalId: event.goalId || event.metaId || event.payload?.goalId || null,
    sendId: event.sendId || event.payload?.sendId || null,
    pendingContentId: event.pendingContentId || event.payload?.pendingContentId || null,
    metaMessageId: event.metaMessageId || event.messageId || null,
    interactionMessageId: event.interactionMessageId || null,
    title: event.meta || event.title || event.tipTitle || null,
    emoji: event.metaEmoji || event.emoji || null,
    comment: event.comentario || event.comment || event.error || null,
    deliveryStatus: event.deliveryStatus || null,
    deliveryStage: event.deliveryStage || null,
    requiresReview: !!(event.requiresReview || event.requiereRevision),
    media: event.media || null,
    occurredAt,
    createdAt: timestampValue(event.createdAt) || occurredAt,
    updatedAt: timestampValue(event.updatedAt) || occurredAt || new Date().toISOString(),
    data: event,
  };
}

async function syncHistoryEventToPostgres(clientId, event) {
  if (!event?.id || !clientId) return false;
  const fields = extractHistoryEventFields(clientId, event);
  await pool.query(`
    INSERT INTO history_events (
      event_id,
      client_id,
      phone,
      nombre,
      event_type,
      direction,
      goal_id,
      send_id,
      pending_content_id,
      meta_message_id,
      interaction_message_id,
      title,
      emoji,
      comment,
      delivery_status,
      delivery_stage,
      requires_review,
      media,
      occurred_at,
      created_at,
      updated_at,
      data
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18::jsonb, $19, $20, $21, $22::jsonb
    )
    ON CONFLICT (event_id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      phone = EXCLUDED.phone,
      nombre = EXCLUDED.nombre,
      event_type = EXCLUDED.event_type,
      direction = EXCLUDED.direction,
      goal_id = EXCLUDED.goal_id,
      send_id = EXCLUDED.send_id,
      pending_content_id = EXCLUDED.pending_content_id,
      meta_message_id = EXCLUDED.meta_message_id,
      interaction_message_id = EXCLUDED.interaction_message_id,
      title = EXCLUDED.title,
      emoji = EXCLUDED.emoji,
      comment = EXCLUDED.comment,
      delivery_status = EXCLUDED.delivery_status,
      delivery_stage = EXCLUDED.delivery_stage,
      requires_review = EXCLUDED.requires_review,
      media = EXCLUDED.media,
      occurred_at = EXCLUDED.occurred_at,
      created_at = COALESCE(history_events.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    fields.eventId,
    fields.clientId,
    fields.phone,
    fields.nombre,
    fields.eventType,
    fields.direction,
    fields.goalId,
    fields.sendId,
    fields.pendingContentId,
    fields.metaMessageId,
    fields.interactionMessageId,
    fields.title,
    fields.emoji,
    fields.comment,
    fields.deliveryStatus,
    fields.deliveryStage,
    fields.requiresReview,
    JSON.stringify(fields.media),
    fields.occurredAt,
    fields.createdAt,
    fields.updatedAt,
    JSON.stringify(fields.data),
  ]);
  console.log("[history] evento sincronizado", JSON.stringify({ clientId, eventId: event.id, eventType: event.tipo || "" }));
  return true;
}

async function syncHistoryMirrorToPostgres(data) {
  if (!HAS_DATABASE_URL) {
    console.warn("[history] DATABASE_URL no está configurada. No se sincronizará espejo PostgreSQL.");
    return;
  }
  const historyByClient = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const entries = Object.entries(historyByClient);
  const eventsCount = entries.reduce((total, [, events]) => total + (Array.isArray(events) ? events.length : 0), 0);
  console.log("[history] espejo solicitado");
  console.log("[history] clientes detectados", entries.length);
  console.log("[history] eventos detectados", eventsCount);
  try {
    let synced = 0;
    for (const [clientId, events] of entries) {
      if (!clientId || !Array.isArray(events)) continue;
      for (const event of events) {
        if (await syncHistoryEventToPostgres(clientId, event)) synced += 1;
      }
    }
    console.log("[history] espejo PostgreSQL sincronizado", JSON.stringify({ clients: entries.length, events: synced }));
  } catch (error) {
    console.warn("[history] error espejo PostgreSQL", JSON.stringify({ error: error.message }));
  }
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

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function isCoupleClient(client) {
  const type = String(client?.type || client?.tipo || "").toLowerCase();
  const uniquePhones = new Set((client?.phones || []).map(normalizePhone).filter(Boolean));
  return (type === "couple" || type === "pareja") && uniquePhones.size > 1;
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
  const allowedTypes = new Set(["meta_enviada", "meta_error", "plantilla_previa_error", "contenido_pendiente_interaccion", "no_completada", "seguimiento_meta", "completada", "mensaje_recibido"]);
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
      const sendTypes = ["meta_enviada", "meta_error", "plantilla_previa_error", "contenido_pendiente_interaccion"];
      const isCoupleGoal = isCoupleClient(client);
      const memberPhones = isCoupleGoal ? (client.phones || []).map(normalizePhone).filter(Boolean) : [];
      function currentEventsForPhone(phone) {
        const normalized = normalizePhone(phone);
        const memberEvents = events.filter(entry => normalizePhone(entry.phone) === normalized);
        const sendEvent = memberEvents.find(entry => sendTypes.includes(entry.tipo));
        const cycleStartedAt = sendEvent ? new Date(sendEvent.fecha).getTime() : 0;
        return cycleStartedAt
          ? memberEvents.filter(entry => new Date(entry.fecha).getTime() >= cycleStartedAt)
          : memberEvents;
      }
      function memberData(phone, index) {
        const normalized = normalizePhone(phone);
        const memberEvents = currentEventsForPhone(phone);
        const completed = memberEvents.find(entry => entry.tipo === "completada");
        const followup = memberEvents.find(entry => entry.tipo === "seguimiento_meta");
        const declined = memberEvents.find(entry => entry.tipo === "no_completada");
        const pendingInteraction = memberEvents.find(entry => entry.tipo === "contenido_pendiente_interaccion");
        const sent = memberEvents.find(entry => entry.tipo === "meta_enviada");
        const lastResponse = memberEvents.find(entry => ["seguimiento_meta", "completada", "no_completada", "mensaje_recibido"].includes(entry.tipo));
        const photoEvent = memberEvents.find(entry => entry.media?.id);
        const difficulty = followup?.dificultad || completed?.dificultad || "";
        let status = "pendiente";
        if (completed) status = "completada";
        else if (followup) status = "en_seguimiento";
        else if (declined) status = "no_completada";
        else if (sent) status = "enviada";
        else if (pendingInteraction) status = "pendiente_interaccion";
        return {
          phone: normalized,
          name: client.nombres?.[index] || client.nombres?.[0] || "Paciente",
          status,
          statusLabel: status === "pendiente_interaccion" ? "Pendiente de tocar botón" : statusLabel[status] || "Pendiente",
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
          lastResponseAt: lastResponse?.fecha || "",
          points: completed ? Number(completed.puntos) || 10 : 0,
          requiresReview: !!(followup?.requiereRevision || completed?.requiereRevision || followup?.estadoEmocional === "negativo" || completed?.estadoEmocional === "negativo" || difficulty === "Difícil" || photoEvent),
          events: memberEvents,
        };
      }
      const members = isCoupleGoal ? (client.phones || []).map(memberData) : [];
      if (isCoupleGoal) {
        console.log("Construyendo dashboard metas pareja", goal.id, client.id);
        members.forEach(member => console.log("Respuesta de integrante", member.phone, member.name, JSON.stringify({
          status: member.status,
          emotion: member.emotionalResponse,
          difficulty: member.difficulty,
          comment: member.comment,
          photo: !!member.photo?.id,
          lastResponseAt: member.lastResponseAt,
        })));
        console.log("Member responses finales", JSON.stringify(members.map(member => ({
          phone: member.phone,
          name: member.name,
          status: member.status,
          difficulty: member.difficulty,
          hasPhoto: !!member.photo?.id,
        }))));
      }
      const currentEvents = memberPhones.length
        ? members.flatMap(member => member.events).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
        : events;
      const sendEvent = currentEvents.find(entry => sendTypes.includes(entry.tipo));
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
      const requiresReview = !!(followup?.requiereRevision || completed?.requiereRevision || reviewReasons.length || members.some(member => member.requiresReview));
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
        memberCompletionSummary: isCoupleGoal ? `${members.filter(member => member.status === "completada").length}/${members.length} integrantes completaron esta meta` : "",
        members,
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
