const fs = require("fs");
const path = require("path");

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

function listTips() {
  return load().tips;
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
  const existing = id ? data.tips.find(t => t.id === id) : null;
  const tip = {
    ...(existing || {}),
    id: existing?.id || uid(),
    type: payload.type,
    title: String(payload.title || "").trim(),
    desc: String(payload.desc || ""),
    phrase: payload.type === "phrase" ? String(payload.phrase || "") : undefined,
    filename: payload.filename || existing?.filename || "",
    data: payload.data || existing?.data || "",
    folderId: payload.folderId || "general",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!tip.title) throw new Error("Título requerido");
  if (tip.type === "phrase" && !tip.phrase) throw new Error("Frase requerida");
  if ((tip.type === "image" || tip.type === "pdf") && !tip.data) throw new Error("Archivo requerido");
  data.tips = existing ? data.tips.map(t => t.id === tip.id ? tip : t) : [tip, ...data.tips];
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

function createSends(tip, recipients, message, scheduledAt) {
  const data = load();
  const when = scheduledAt || new Date().toISOString();
  const status = new Date(when).getTime() > Date.now() + 60000 ? "programado" : "pendiente";
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

function dueSends() {
  const now = Date.now();
  return load().sends.filter(s => ["programado", "pendiente"].includes(s.status) && new Date(s.scheduledAt).getTime() <= now);
}

function getTip(id) {
  return load().tips.find(t => t.id === id);
}

module.exports = {
  DEFAULT_FOLDER,
  createFolder,
  createSends,
  deleteTip,
  dueSends,
  getTip,
  listFolders,
  listSends,
  listTips,
  updateSend,
  upsertTip,
};
