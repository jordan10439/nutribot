const fs = require("fs");
const path = require("path");
const db = require("./db");
const history = require("./history");
const { enviarPlantillaOficial } = require("./whatsapp");

const FILE = path.join(__dirname, "../data/consultationReminders.json");
const DEFAULT_TZ = "America/Santiago";
let interval = null;

function cleanEnvValue(value) {
  let clean = String(value || "").trim();
  const first = clean[0];
  const last = clean[clean.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) clean = clean.slice(1, -1).trim();
  return clean;
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[consultationReminders] Error leyendo data/consultationReminders.json:", e.message);
    return [];
  }
}

function save(items) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}

function templateDefinitions() {
  return [
    {
      id: "without_button",
      label: "Sin botón",
      metaTemplateName: cleanEnvValue(process.env.META_CONSULTA_REMINDER_WITHOUT_BUTTON_NAME),
      metaLanguageCode: cleanEnvValue(process.env.META_CONSULTA_REMINDER_WITHOUT_BUTTON_LANGUAGE),
      hasButton: false,
      envName: "META_CONSULTA_REMINDER_WITHOUT_BUTTON_NAME",
      envLanguage: "META_CONSULTA_REMINDER_WITHOUT_BUTTON_LANGUAGE",
    },
    {
      id: "with_button",
      label: "Con botón",
      metaTemplateName: cleanEnvValue(process.env.META_CONSULTA_REMINDER_WITH_BUTTON_NAME),
      metaLanguageCode: cleanEnvValue(process.env.META_CONSULTA_REMINDER_WITH_BUTTON_LANGUAGE),
      hasButton: true,
      envName: "META_CONSULTA_REMINDER_WITH_BUTTON_NAME",
      envLanguage: "META_CONSULTA_REMINDER_WITH_BUTTON_LANGUAGE",
    },
  ].map(template => {
    const missing = [];
    if (!template.metaTemplateName) missing.push(template.envName);
    if (!template.metaLanguageCode) missing.push(template.envLanguage);
    return {
      ...template,
      configured: missing.length === 0,
      error: missing.length ? `Falta configurar ${missing.join(" y ")}` : "",
    };
  });
}

function getTemplate(type = "without_button") {
  const template = templateDefinitions().find(item => item.id === type) || templateDefinitions()[0];
  if (!template.configured) throw new Error(template.error);
  return template;
}

function addMonthsClamped(date, months) {
  const source = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function ymd(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function calculateSchedule(planDeliveredDate) {
  const raw = String(planDeliveredDate || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const delivered = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const followUpEnds = addMonthsClamped(delivered, 1);
  const scheduled = new Date(followUpEnds.getTime() + 86400000);
  return {
    pautaDeliveredAt: raw,
    followUpEndsAt: ymd(followUpEnds),
    scheduledDate: ymd(scheduled),
    scheduledTime: "11:00",
    scheduledAt: `${ymd(scheduled)}T11:00:00`,
  };
}

function chileDateTimeKey(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`;
}

function isPastLocal(scheduledAt) {
  return String(scheduledAt || "") < chileDateTimeKey(new Date());
}

function recipientName(client, phone) {
  const index = (client.phones || []).indexOf(phone);
  return client.nombres?.[index] || client.nombres?.[0] || "Paciente";
}

function enriched(item) {
  const client = db.getById(item.clientId);
  return {
    ...item,
    patientName: item.patientName || (client?.nombres || []).join(" & ") || "Paciente",
    recipientName: item.recipientName || recipientName(client || {}, item.phone),
    clientType: (client?.phones || []).length > 1 ? "Pareja" : "Individual",
  };
}

function list(filters = {}) {
  return load()
    .filter(item => !filters.clientId || item.clientId === filters.clientId)
    .map(enriched)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

function ensureForConsultation(client, consultation) {
  if (!consultation?.planDeliveredDate) return { reminders: [], warnings: [] };
  const schedule = calculateSchedule(consultation.planDeliveredDate);
  if (!schedule) return { reminders: [], warnings: ["Fecha de entrega de pauta inválida."] };
  if (isPastLocal(schedule.scheduledAt)) {
    return { reminders: [], warnings: ["La fecha de recordatorio ya pasó. Selecciona una nueva fecha."] };
  }
  const phones = [...new Set((client.phones || []).filter(Boolean))];
  if (!phones.length) return { reminders: [], warnings: ["El paciente no tiene teléfono registrado."] };

  const items = load();
  const now = new Date().toISOString();
  const reminders = [];
  const warnings = [];
  const template = templateDefinitions().find(item => item.id === "without_button");

  for (const phone of phones) {
    const existingIndex = items.findIndex(item => item.clientId === client.id && item.consultationId === consultation.id && item.phone === phone);
    const existing = existingIndex >= 0 ? items[existingIndex] : null;
    if (existing && existing.status !== "scheduled") {
      reminders.push(existing);
      continue;
    }
    const base = {
      id: existing?.id || uid(),
      clientId: client.id,
      phone,
      recipientName: recipientName(client, phone),
      patientName: (client.nombres || []).join(" & "),
      consultationId: consultation.id,
      consultationNumber: consultation.number,
      templateType: existing?.templateType || "without_button",
      templateName: template?.metaTemplateName || "",
      languageCode: template?.metaLanguageCode || "",
      status: "scheduled",
      error: "",
      sentAt: existing?.sentAt || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      ...schedule,
    };
    if (existingIndex >= 0) items[existingIndex] = { ...existing, ...base };
    else items.push(base);
    reminders.push(base);
    history.registrar(client.id, phone, base.recipientName, {
      tipo: "recordatorio_consulta_programado",
      meta: "Recordatorio de fin de seguimiento programado.",
      metaEmoji: "📅",
      direccion: "sistema",
      comentario: `Programado para ${base.scheduledAt}`,
      consultationId: consultation.id,
      reminderId: base.id,
    });
  }

  save(items);
  return { reminders, warnings };
}

function update(id, patch = {}) {
  const items = load();
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = items[index];
  if (current.status === "sent") throw new Error("No se puede editar un recordatorio ya enviado.");
  const templateType = patch.templateType || current.templateType || "without_button";
  const template = getTemplate(templateType);
  const scheduledDate = String(patch.scheduledDate || current.scheduledDate || "").slice(0, 10);
  const scheduledTime = String(patch.scheduledTime || current.scheduledTime || "11:00").slice(0, 5);
  const scheduledAt = `${scheduledDate}T${scheduledTime}:00`;
  const nextStatus = patch.status || (current.status === "error" ? "scheduled" : current.status || "scheduled");
  if (String(nextStatus) === "scheduled" && isPastLocal(scheduledAt)) {
    throw new Error("La fecha de recordatorio ya pasó. Selecciona una nueva fecha.");
  }
  const updated = {
    ...current,
    scheduledDate,
    scheduledTime,
    scheduledAt,
    templateType,
    templateName: template.metaTemplateName,
    languageCode: template.metaLanguageCode,
    status: nextStatus,
    error: "",
    updatedAt: new Date().toISOString(),
  };
  items[index] = updated;
  save(items);
  return enriched(updated);
}

function cancel(id) {
  const items = load();
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  if (items[index].status === "sent") return enriched(items[index]);
  items[index] = { ...items[index], status: "cancelled", updatedAt: new Date().toISOString() };
  save(items);
  return enriched(items[index]);
}

async function sendReminder(item) {
  const template = getTemplate(item.templateType || "without_button");
  console.log("Enviando recordatorio de fin de seguimiento", JSON.stringify({
    id: item.id,
    clientId: item.clientId,
    phone: item.phone,
    templateType: item.templateType,
    templateName: template.metaTemplateName,
    languageCode: template.metaLanguageCode,
  }));
  const result = await enviarPlantillaOficial(item.phone, template.metaTemplateName, template.metaLanguageCode, `Recordatorio consulta: ${template.label}`, item.recipientName || "");
  return { template, result };
}

async function processDueReminders() {
  const items = load();
  const nowKey = chileDateTimeKey(new Date());
  const due = items.filter(item => item.status === "scheduled" && String(item.scheduledAt || "") <= nowKey);
  console.log("Revisando recordatorios de consulta");
  console.log("Cantidad de recordatorios pendientes", items.filter(item => item.status === "scheduled").length);
  console.log("Cantidad de recordatorios listos para enviar", due.length);
  let changed = false;
  for (const item of due) {
    const index = items.findIndex(entry => entry.id === item.id);
    if (index < 0 || items[index].status !== "scheduled") continue;
    try {
      const { template, result } = await sendReminder(enriched(items[index]));
      items[index] = {
        ...items[index],
        status: "sent",
        sentAt: new Date().toISOString(),
        templateName: template.metaTemplateName,
        languageCode: template.metaLanguageCode,
        metaMessageId: result.messageId,
        error: "",
        updatedAt: new Date().toISOString(),
      };
      history.registrar(items[index].clientId, items[index].phone, items[index].recipientName, {
        tipo: "recordatorio_consulta_enviado",
        meta: "Recordatorio de fin de seguimiento enviado.",
        metaEmoji: "📅",
        direccion: "saliente",
        templateName: template.metaTemplateName,
        templateLanguage: template.metaLanguageCode,
        reminderId: items[index].id,
        metaMessageId: result.messageId,
      });
      changed = true;
    } catch (e) {
      console.error("Error al enviar recordatorio de fin de seguimiento", e.message);
      items[index] = { ...items[index], status: "error", error: e.message, updatedAt: new Date().toISOString() };
      history.registrar(items[index].clientId, items[index].phone, items[index].recipientName, {
        tipo: "recordatorio_consulta_error",
        meta: "Error al enviar recordatorio de fin de seguimiento.",
        metaEmoji: "⚠️",
        direccion: "sistema",
        comentario: e.message,
        reminderId: items[index].id,
      });
      changed = true;
    }
  }
  if (changed) save(items);
}

function startScheduler() {
  if (interval) clearInterval(interval);
  processDueReminders().catch(e => console.error("Error revisando recordatorios de consulta:", e.message));
  interval = setInterval(() => processDueReminders().catch(e => console.error("Error revisando recordatorios de consulta:", e.message)), 60 * 1000);
}

module.exports = { calculateSchedule, cancel, ensureForConsultation, list, processDueReminders, startScheduler, templateDefinitions, update };
