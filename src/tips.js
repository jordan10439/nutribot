const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const FILE = path.join(__dirname, "../data/tips.json");
const DEFAULT_FOLDER = { id: "general", name: "Sin carpeta", type: "all" };
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const HAS_DATABASE_URL = Boolean(DATABASE_URL);
const pool = db.pool || db;

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
  syncTipsMirrorToPostgres(data).catch(error => {
    console.warn("[tips] ⚠️ Error en sincronización espejo con PostgreSQL:", error.message);
  });
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function syncTipFolderToPostgres(folder) {
  if (!folder?.id) return false;
  await pool.query(`
    INSERT INTO tip_folders (
      folder_id,
      name,
      type,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    ON CONFLICT (folder_id) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      created_at = COALESCE(tip_folders.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    folder.id,
    folder.name || null,
    folder.type || null,
    parseTimestamp(folder.createdAt),
    parseTimestamp(folder.updatedAt) || parseTimestamp(folder.createdAt) || new Date().toISOString(),
    JSON.stringify(folder),
  ]);
  return true;
}

async function syncTipLibraryToPostgres(tip) {
  if (!tip?.id) return false;
  await pool.query(`
    INSERT INTO tip_library (
      tip_id,
      request_id,
      type,
      title,
      description,
      phrase,
      filename,
      folder_id,
      fingerprint,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
    ON CONFLICT (tip_id) DO UPDATE SET
      request_id = EXCLUDED.request_id,
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      phrase = EXCLUDED.phrase,
      filename = EXCLUDED.filename,
      folder_id = EXCLUDED.folder_id,
      fingerprint = EXCLUDED.fingerprint,
      created_at = COALESCE(tip_library.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    tip.id,
    tip.requestId || null,
    tip.type || null,
    tip.title || null,
    tip.desc || null,
    tip.phrase || null,
    tip.filename || null,
    tip.folderId || null,
    tip.fingerprint || null,
    parseTimestamp(tip.createdAt),
    parseTimestamp(tip.updatedAt) || parseTimestamp(tip.createdAt) || new Date().toISOString(),
    JSON.stringify(tip),
  ]);
  return true;
}

async function syncTipSendToPostgres(send) {
  if (!send?.id) return false;
  await pool.query(`
    INSERT INTO tip_sends (
      send_id,
      tip_id,
      client_id,
      phone,
      patient_name,
      recipient_role,
      message,
      utility_template_id,
      scheduled_at,
      status,
      error,
      sent_at,
      cancelled_at,
      reviewed_at,
      hidden,
      delivery_status,
      utility_template_message_id,
      meta_message_id,
      text_message_id,
      pending_content_id,
      created_at,
      updated_at,
      data
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22, $23::jsonb
    )
    ON CONFLICT (send_id) DO UPDATE SET
      tip_id = EXCLUDED.tip_id,
      client_id = EXCLUDED.client_id,
      phone = EXCLUDED.phone,
      patient_name = EXCLUDED.patient_name,
      recipient_role = EXCLUDED.recipient_role,
      message = EXCLUDED.message,
      utility_template_id = EXCLUDED.utility_template_id,
      scheduled_at = EXCLUDED.scheduled_at,
      status = EXCLUDED.status,
      error = EXCLUDED.error,
      sent_at = EXCLUDED.sent_at,
      cancelled_at = EXCLUDED.cancelled_at,
      reviewed_at = EXCLUDED.reviewed_at,
      hidden = EXCLUDED.hidden,
      delivery_status = EXCLUDED.delivery_status,
      utility_template_message_id = EXCLUDED.utility_template_message_id,
      meta_message_id = EXCLUDED.meta_message_id,
      text_message_id = EXCLUDED.text_message_id,
      pending_content_id = EXCLUDED.pending_content_id,
      created_at = COALESCE(tip_sends.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    send.id,
    send.tipId || null,
    send.clientId || null,
    send.phone || null,
    send.patientName || null,
    send.recipientRole || null,
    send.message || null,
    send.utilityTemplateId || null,
    parseTimestamp(send.scheduledAt),
    send.status || null,
    send.error || null,
    parseTimestamp(send.sentAt),
    parseTimestamp(send.cancelledAt),
    parseTimestamp(send.reviewedAt),
    !!send.hidden,
    send.deliveryStatus || null,
    send.utilityTemplateMessageId || null,
    send.metaMessageId || null,
    send.textMessageId || null,
    send.pendingContentId || null,
    parseTimestamp(send.createdAt),
    parseTimestamp(send.updatedAt) || parseTimestamp(send.createdAt) || new Date().toISOString(),
    JSON.stringify(send),
  ]);
  return true;
}

async function syncTipsMirrorToPostgres(data) {
  if (!HAS_DATABASE_URL) return;
  const folders = Array.isArray(data?.folders) ? data.folders : [];
  const tips = Array.isArray(data?.tips) ? data.tips : [];
  const sends = Array.isArray(data?.sends) ? data.sends : [];
  try {
    let foldersCount = 0;
    let tipsCount = 0;
    let sendsCount = 0;
    for (const folder of folders) {
      if (await syncTipFolderToPostgres(folder)) foldersCount += 1;
    }
    for (const tip of tips) {
      if (await syncTipLibraryToPostgres(tip)) tipsCount += 1;
    }
    for (const send of sends) {
      if (await syncTipSendToPostgres(send)) sendsCount += 1;
    }
    console.log("[tips] ✅ Espejo PostgreSQL sincronizado", JSON.stringify({
      folders: foldersCount,
      tips: tipsCount,
      sends: sendsCount,
    }));
  } catch (error) {
    console.warn("[tips] ⚠️ Falló espejo PostgreSQL", JSON.stringify({ error: error.message }));
  }
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
  const phraseText = payload.type === "phrase" ? String(payload.desc || payload.phrase || "") : "";
  return crypto.createHash("sha1").update(JSON.stringify({
    type: payload.type || "",
    title: String(payload.title || "").trim(),
    desc: payload.type === "phrase" ? phraseText : String(payload.desc || ""),
    phrase: phraseText,
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
  const phraseText = payload.type === "phrase" ? String(payload.desc || payload.phrase || "") : undefined;
  const tip = {
    ...(existing || {}),
    id: existing?.id || uid(),
    requestId: existing?.requestId || payload.requestId || "",
    type: payload.type,
    title: String(payload.title || "").trim(),
    desc: payload.type === "phrase" ? phraseText : String(payload.desc || ""),
    phrase: phraseText,
    filename: payload.filename || existing?.filename || "",
    data: payload.data || existing?.data || "",
    folderId: payload.folderId || "general",
    fingerprint,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!tip.title) throw new Error("Título requerido");
  if (tip.type === "phrase" && !tip.desc) throw new Error("Contenido del tip requerido");
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
    recipientRole: r.role || "paciente principal",
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

function reviewErrorSend(id) {
  const send = updateSend(id, { reviewedAt: new Date().toISOString(), hidden: true });
  if (!send) throw new Error("Envío de tip no encontrado");
  if (send.status !== "error") throw new Error("Solo puedes marcar como revisados los tips con error");
  return send;
}

function cleanTestErrors() {
  const data = load();
  const testPattern = /Invalid OAuth access token|Cannot parse access token|OAuthException|code=190/i;
  let count = 0;
  data.sends = (data.sends || []).map(send => {
    if (send.status === "error" && testPattern.test(String(send.error || "")) && !send.hidden) {
      count += 1;
      return { ...send, reviewedAt: new Date().toISOString(), hidden: true, updatedAt: new Date().toISOString() };
    }
    return send;
  });
  save(data);
  return count;
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
  reviewErrorSend,
  cleanTestErrors,
  updateSend,
  updateByMetaMessageId,
  updateScheduledSend,
  upsertTip,
};
