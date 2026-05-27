const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "../data/tips.json");
const DEFAULT_FOLDER = { id: "general", name: "Sin carpeta", type: "all" };

function load() {
  try {
    if (!fs.existsSync(FILE)) return { tips: [], folders: [DEFAULT_FOLDER], sends: [] };
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    data.tips = data.tips || [];
    data.sends = data.sends || [];
    data.folders = data.folders || [DEFAULT_FOLDER];
    if (!data.folders.some(f => f.id === "general")) data.folders.unshift(DEFAULT_FOLDER);
    return data;
  } catch (e) {
    console.error("[tips] Error leyendo data/tips.json:", e.message);
    return { tips: [], folders: [DEFAULT_FOLDER], sends: [] };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dedupeTips(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item?.requestId || item?.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeScheduledAt(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha programada inválida: ${value}`);
  return date.toISOString();
}

function tipFingerprint(payload) {
  return crypto.createHash("sha1").update(JSON.stringify({
    type: payload.type || "",
    title: String(payload.title || "").trim(),
    desc: String(payload.desc || ""),
    phrase: payload.type === "phrase" ? String(payload.phrase || "") : "",
    filename: payload.filename || "",
    data: payload.data || "",
    folderId: payload.folderId || "general",
  })).digest("hex");
}

function listTips() {
  const data = load();
  const unique = dedupeTips(data.tips);
  if (unique.length !== data.tips.length) {
    data.tips = unique;
    save(data);
  }
  return unique;
}

function listFolders() {
  return load().folders;
}

function createFolder(folder) {
  const data = load();
  const clean = {
    id: uid(),
    name: String(folder.name || "").trim(),
    type: folder.type || "all",
    createdAt: new Date().toISOString(),
  };
  if (!clean.name) throw new Error("Nombre de carpeta requerido");
  data.folders.push(clean);
  save(data);
  return clean;
}

function upsertTip(payload, id) {
  const data = load();
  const now = new Date().toISOString();
  const byRequest = !id && payload.requestId ? data.tips.find(t => t.requestId === payload.requestId) : null;
  if (byRequest) return byRequest;
  const existing = id ? data.tips.find(t => t.id === id) : null;
  const fingerprint = tipFingerprint({
    ...(existing || {}),
    ...payload,
    data: payload.data || existing?.data || "",
    filename: payload.filename || existing?.filename || "",
  });
  const byRecentDuplicate = !id ? data.tips.find(t => (
    t.fingerprint === fingerprint &&
    new Date(t.createdAt || 0).getTime() > Date.now() - 2 * 60 * 1000
  )) : null;
  if (byRecentDuplicate) return byRecentDuplicate;
  const tip = {
    ...(existing || {}),
    id: existing?.id || uid(),
    requestId: existing?.requestId || payload.requestId || "",
    type: payload.type,
    title: String(payload.title || "").trim(),
    desc: String(payload.desc || ""),
    phrase: payload.type === "phrase" ? String(payload.phrase || "") : undefined,
    filename: payload.filename || existing?.filename || "",
    data: payload.data || existing?.data || "",
    folderId: payload.folderId || "general",
    fingerprint,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!tip.title) throw new Error("Título requerido");
  if (tip.type === "phrase" && !tip.phrase) throw new Error("Frase requerida");
  if ((tip.type === "image" || tip.type === "pdf") && !tip.data) throw new Error("Archivo requerido");
  data.tips = existing ? data.tips.map(t => t.id === tip.id ? tip : t) : [tip, ...dedupeTips(data.tips)];
  save(data);
  return tip;
}

function deleteTip(id) {
  const data = load();
  data.tips = data.tips.filter(t => t.id !== id);
  save(data);
}

function listSends() {
  return load().sends.sort((a, b) => new Date(b.scheduledAt || b.createdAt) - new Date(a.scheduledAt || a.createdAt));
}

function pendingSends() {
  return load().sends.filter(s => ["programado", "pendiente"].includes(s.status));
}

function createSends(tip, recipients, message, scheduledAt, utilityTemplateId = "") {
  const data = load();
  const when = normalizeScheduledAt(scheduledAt);
  const status = new Date(when).getTime() > Date.now() ? "programado" : "pendiente";
  const sends = recipients.map(r => ({
    id: uid(),
    tipId: tip.id,
    tipTitle: tip.title,
    tipType: tip.type,
    folderId: tip.folderId || "general",
    clientId: r.clientId,
    phone: r.phone,
    patientName: r.name || "Paciente",
    message,
    utilityTemplateId,
    scheduledAt: when,
    status,
    error: "",
    createdAt: new Date().toISOString(),
    sentAt: null,
  }));
  data.sends.unshift(...sends);
  save(data);
  return sends;
}

function updateSend(id, patch) {
  const data = load();
  const send = data.sends.find(s => s.id === id);
  if (!send) return null;
  Object.assign(send, patch, { updatedAt: new Date().toISOString() });
  save(data);
  return send;
}

function updateScheduledSend(id, payload) {
  const data = load();
  const send = data.sends.find(s => s.id === id);
  if (!send) throw new Error("Envío de tip no encontrado");
  if (!["programado", "pendiente"].includes(send.status)) {
    throw new Error("Solo puedes editar tips pendientes o programados");
  }
  const scheduledAt = normalizeScheduledAt(payload.scheduledAt || send.scheduledAt);
  Object.assign(send, {
    message: typeof payload.message === "string" ? payload.message : send.message,
    utilityTemplateId: typeof payload.utilityTemplateId === "string" ? payload.utilityTemplateId : (send.utilityTemplateId || ""),
    scheduledAt,
    status: new Date(scheduledAt).getTime() > Date.now() ? "programado" : "pendiente",
    error: "",
    updatedAt: new Date().toISOString(),
  });
  save(data);
  return send;
}

function cancelScheduledSend(id) {
  const data = load();
  const send = data.sends.find(s => s.id === id);
  if (!send) throw new Error("Envío de tip no encontrado");
  if (!["programado", "pendiente"].includes(send.status)) {
    throw new Error("Solo puedes cancelar tips pendientes o programados");
  }
  Object.assign(send, {
    status: "cancelado",
    error: "",
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  save(data);
  return send;
}

function dueSends() {
  const now = Date.now();
  return pendingSends().filter(s => {
    const scheduledMs = new Date(s.scheduledAt).getTime();
    return !Number.isNaN(scheduledMs) && scheduledMs <= now;
  });
}

function getTip(id) {
  return load().tips.find(t => t.id === id);
}

function getSend(id) {
  return load().sends.find(s => s.id === id) || null;
}

function updateByMetaMessageId(messageId, patch) {
  const data = load();
  const send = data.sends.find(s => (
    s.metaMessageId === messageId ||
    s.textMessageId === messageId ||
    s.utilityTemplateMessageId === messageId
  ));
  if (!send) return null;
  Object.assign(send, patch, { updatedAt: new Date().toISOString() });
  save(data);
  return send;
}

function findByMetaMessageId(messageId) {
  return load().sends.find(s => (
    s.metaMessageId === messageId ||
    s.textMessageId === messageId ||
    s.utilityTemplateMessageId === messageId
  )) || null;
}

module.exports = {
  DEFAULT_FOLDER,
  cancelScheduledSend,
  createFolder,
  createSends,
  deleteTip,
  dueSends,
  findByMetaMessageId,
  getSend,
  getTip,
  listFolders,
  listSends,
  listTips,
  pendingSends,
  updateSend,
  updateByMetaMessageId,
  updateScheduledSend,
  upsertTip,
};
