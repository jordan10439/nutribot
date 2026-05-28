// index.js
require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const path       = require("path");
const db         = require("./src/db");
const history    = require("./src/history");
const messages   = require("./src/messages");
const tips       = require("./src/tips");
const utilityTemplates = require("./src/utilityTemplates");
const { enviarTip, enviarPlantillaUtilidad } = require("./src/whatsapp");
const { procesarMensaje, enviarMeta, enviarBienvenida } = require("./src/bot");
const { recargarTodos } = require("./src/scheduler");
const { explainMetaError } = require("./src/metaErrors");

const app  = express();
const PORT = process.env.PORT || 3000;
const PASS = process.env.ADMIN_PASSWORD || "nutribot2024";
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "nutribot2024";

app.use(bodyParser.urlencoded({ extended: false, limit: "25mb" }));
app.use(bodyParser.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (token !== PASS) return res.status(401).json({ error: "No autorizado" });
  next();
}

// ── Auth ───────────────────────────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  if (req.body.password === PASS) res.json({ ok: true });
  else res.status(401).json({ error: "Contraseña incorrecta" });
});

// ── Clientes ───────────────────────────────────────────────────────────────────
app.get("/api/clients", auth, (req, res) => res.json(db.getAll()));

app.post("/api/clients", auth, async (req, res) => {
  const { nombres, phones, timezone, goals } = req.body;
  if (!nombres?.length || !phones?.length) return res.status(400).json({ error: "Faltan datos" });
  const client = { id: db.newId(nombres[0]), nombres, phones, timezone: timezone || "America/Santiago", goals: goals || [] };
  db.upsert(client);
  recargarTodos();
  // Enviar bienvenida solo si el cliente lo solicita (body.sendWelcome === true)
  if (req.body.sendWelcome) {
    try {
      for (const phone of phones) {
        await enviarBienvenida(client.id, phone);
      }
    } catch (e) {
      return res.status(502).json({ error: e.message, client, welcomeSent: false });
    }
  }
  res.json({ ok: true, client, welcomeSent: !!req.body.sendWelcome });
});

app.delete("/api/clients/:id", auth, (req, res) => {
  db.remove(req.params.id);
  recargarTodos();
  res.json({ ok: true });
});

// ── Metas ──────────────────────────────────────────────────────────────────────
app.post("/api/clients/:id/goals", auth, (req, res) => {
  const client = db.getById(req.params.id);
  if (!client) return res.status(404).json({ error: "No encontrado" });
  // Accept additional per-goal settings: requiereFoto, repetirSiNo, repetirFreq
  const { titulo, descripcion, emoji, hora, dias, specificDate, requiereFoto, repetirSiNo, repetirFreq, utilityTemplateId } = req.body;
  const goal = {
    id: Date.now().toString(),
    titulo,
    descripcion: descripcion || titulo,
    emoji: emoji || "🎯",
    hora: hora || "09:00",
    dias: specificDate ? [] : (dias || [1,2,3,4,5]),
    specificDate: specificDate || "",
    requiereFoto: !!requiereFoto,
    repetirSiNo: !!repetirSiNo,
    repetirFreq: repetirFreq || { unit: "hours", value: 24 },
    utilityTemplateId: utilityTemplates.validateId(utilityTemplateId),
  };
  client.goals = client.goals || [];
  client.goals.push(goal);
  db.upsert(client);
  recargarTodos();
  res.json({ ok: true, goal });
});

// Editar meta existente
app.put("/api/clients/:id/goals/:goalId", auth, (req, res) => {
  const client = db.getById(req.params.id);
  if (!client) return res.status(404).json({ error: "No encontrado" });
  const goal = client.goals?.find(g => g.id === req.params.goalId);
  if (!goal) return res.status(404).json({ error: "Meta no encontrada" });
  const { titulo, descripcion, emoji, hora, dias, specificDate, requiereFoto, repetirSiNo, repetirFreq, utilityTemplateId } = req.body;
  if (titulo) goal.titulo = titulo;
  if (descripcion) goal.descripcion = descripcion;
  if (emoji) goal.emoji = emoji;
  if (hora) goal.hora = hora;
  if (dias) goal.dias = dias;
  if (typeof specificDate !== "undefined") goal.specificDate = specificDate || "";
  if (typeof requiereFoto !== 'undefined') goal.requiereFoto = !!requiereFoto;
  if (typeof repetirSiNo !== 'undefined') goal.repetirSiNo = !!repetirSiNo;
  if (repetirFreq) goal.repetirFreq = repetirFreq;
  if (typeof utilityTemplateId !== "undefined") goal.utilityTemplateId = utilityTemplates.validateId(utilityTemplateId);
  db.upsert(client);
  recargarTodos();
  res.json({ ok: true, goal });
});

app.delete("/api/clients/:id/goals/:goalId", auth, (req, res) => {
  const client = db.getById(req.params.id);
  if (!client) return res.status(404).json({ error: "No encontrado" });
  client.goals = (client.goals || []).filter(g => g.id !== req.params.goalId);
  db.upsert(client);
  recargarTodos();
  res.json({ ok: true });
});

app.post("/api/clients/:id/send", auth, async (req, res) => {
  try {
    const client = db.getById(req.params.id);
    if (!client) return res.status(404).json({ error: "No encontrado" });
    const goalId = req.body.goalId;
    const meta = goalId ? client.goals?.find(g => g.id === goalId) : client.goals?.[0];
    if (!meta) return res.status(400).json({ error: "Sin metas" });
    const options = Object.prototype.hasOwnProperty.call(req.body, "utilityTemplateId")
      ? { utilityTemplateId: utilityTemplates.validateId(req.body.utilityTemplateId) }
      : {};
    const result = await enviarMeta(client.id, meta, options);
    res.json({ ok: result?.ok !== false, partial: !!result?.partial, results: result?.results || [] });
  } catch (e) {
    console.error("Error al enviar meta", e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/clients/:id/welcome", auth, async (req, res) => {
  try {
    const client = db.getById(req.params.id);
    if (!client) return res.status(404).json({ error: "No encontrado" });
    for (const phone of client.phones) await enviarBienvenida(client.id, phone);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Historial ──────────────────────────────────────────────────────────────────
app.get("/api/clients/:id/history", auth, (req, res) => res.json(history.getHistorial(req.params.id)));
app.get("/api/clients/:id/resumen", auth, (req, res) => res.json(history.getResumen(req.params.id)));
app.get("/api/goals/dashboard", auth, (req, res) => res.json(history.getGoalsDashboard(db.getAll())));
app.get("/api/history/all", auth, (req, res) => {
  const clients = db.getAll();
  let todo = [];
  for (const c of clients) {
    const h = history.getHistorial(c.id);
    todo = todo.concat(h.map(e => ({ ...e, clientNombre: c.nombres?.join(" & ") })));
  }
  todo.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  res.json(todo);
});

// Proxy para descargar medios desde WhatsApp Graph API (requiere token env META_TOKEN)
app.get("/api/media/:id", auth, async (req, res) => {
  const id = req.params.id;
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${id}`, { headers: { Authorization: `Bearer ${process.env.META_TOKEN}` } });
    const meta = await metaRes.json();
    const url = meta.url || meta.preview_url || meta.image?.url;
    if (!url) return res.status(404).json({ error: "Media URL not found" });
    const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${process.env.META_TOKEN}` } });
    if (!fileRes.ok) return res.status(502).json({ error: "Error fetching media" });
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    res.set('Content-Type', contentType);
    const buffer = await fileRes.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('Error proxy media:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Mensajes configurables ─────────────────────────────────────────────────────
app.get("/api/messages", auth, (req, res) => res.json(messages.getAll()));
app.put("/api/messages/:key", auth, (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: "Falta value" });
  messages.set(req.params.key, value);
  res.json({ ok: true });
});
app.post("/api/messages/:key/reset", auth, (req, res) => {
  messages.reset(req.params.key);
  res.json({ ok: true });
});
app.get("/api/messages/labels", auth, (req, res) => res.json(messages.LABELS));
app.get("/api/utility-templates", auth, (req, res) => res.json(utilityTemplates.list()));

// ── Tips programables ─────────────────────────────────────────────────────────
function nombreCliente(client, phone) {
  const idx = (client.phones || []).indexOf(phone);
  return client.nombres?.[idx] || client.nombres?.[0] || "Paciente";
}

function recipientsFromClientIds(clientIds = [], includePairs = {}) {
  const recipients = [];
  for (const clientId of clientIds) {
    const client = db.getById(clientId);
    if (!client) continue;
    const phones = includePairs[clientId] ? (client.phones || []) : [client.phones?.[0]].filter(Boolean);
    for (const phone of phones) {
      const index = (client.phones || []).indexOf(phone);
      recipients.push({ clientId, phone, name: nombreCliente(client, phone), role: index > 0 ? "pareja" : "paciente principal" });
    }
  }
  return recipients;
}

function recipientsFromTipBody(body = {}) {
  const clientIds = body.clientId ? [body.clientId] : (body.clientIds || []);
  const recipients = recipientsFromClientIds(clientIds, body.includePairs || {});
  const directPhones = body.phone ? [body.phone] : (body.phones || []);

  for (const phone of directPhones.filter(Boolean)) {
    const client = db.getAll().find(c => (c.phones || []).includes(phone));
    recipients.push({
      clientId: client?.id || "directo",
      phone,
      name: body.patientName || (client ? nombreCliente(client, phone) : "Paciente"),
      role: "paciente principal",
    });
  }

  const seen = new Set();
  const finalRecipients = recipients.filter(r => {
    const key = r.phone;
    if (!r.phone || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log("Destinatarios finales del envío", JSON.stringify(finalRecipients.map(r => ({ clientId: r.clientId, phone: r.phone, name: r.name, role: r.role }))));
  console.log("Cantidad de destinatarios", finalRecipients.length);
  return finalRecipients;
}

async function createAndReviewTipSends(tip, body = {}) {
  const recipients = recipientsFromTipBody(body);
  if (!recipients.length) throw new Error("Selecciona al menos un paciente válido");
  const sends = tips.createSends(
    tip,
    recipients,
    body.message || "",
    body.scheduledAt,
    utilityTemplates.validateId(body.utilityTemplateId)
  );
  await revisarTipsProgramados();
  const reviewed = sends.map(send => tips.getSend(send.id) || send);
  console.log("Resumen final de envío a pareja", JSON.stringify({
    tipId: tip.id,
    total: reviewed.length,
    ok: reviewed.filter(send => send.status === "enviado").length,
    error: reviewed.filter(send => send.status === "error").length,
    pending: reviewed.filter(send => ["programado", "pendiente"].includes(send.status)).length,
    results: reviewed.map(send => ({
      nombre: send.patientName,
      phone: send.phone,
      clientId: send.clientId,
      role: send.recipientRole,
      plantillaPrevia: send.utilityTemplateId ? (send.utilityTemplateMessageId ? "enviada" : send.status === "error" ? "error o no confirmada" : "pendiente") : "no seleccionada",
      contenidoPrincipal: send.status === "enviado" ? "enviado" : send.status === "error" ? "error" : "pendiente",
      messageId: send.metaMessageId || "",
      error: send.error || "",
    })),
  }));
  return reviewed;
}

async function sendTipRecord(send, position = null, total = null) {
  console.log("Tip encontrado para enviar", JSON.stringify({ id: send.id, tipId: send.tipId, phone: send.phone, patientName: send.patientName }));
  const tip = tips.getTip(send.tipId);
  if (!tip) {
    const reason = "Tip no encontrado";
    console.error("Error real al enviar tip", reason);
    tips.updateSend(send.id, { status: "error", error: reason });
    return;
  }
  let utilityTemplateSent = false;
  let utilityTemplateMessageId = "";
  let contentStarted = false;
  let mainMessageId = "";
  const trace = { clientId: send.clientId, role: send.recipientRole, nombre: send.patientName, phone: send.phone, tipId: send.tipId, tipTitle: send.tipTitle, sendId: send.id, destinatarioIndex: position, totalDestinatarios: total };
  try {
    tips.updateSend(send.id, { status: "enviando", error: "" });
    if (position !== null) console.log(`Procesando destinatario ${position}`, JSON.stringify({ total, id: send.id, phone: send.phone, patientName: send.patientName, role: send.recipientRole, tipTitle: send.tipTitle }));
    console.log("Destinatario actual del loop", JSON.stringify(trace));
    console.log("Nombre destinatario", send.patientName);
    console.log("Phone destinatario", send.phone);
    console.log("ClientId destinatario", send.clientId);
    console.log("Role destinatario", send.recipientRole);
    console.log(send.recipientRole === "pareja" ? "Enviando a pareja" : "Enviando a paciente principal", JSON.stringify({ id: send.id, phone: send.phone, patientName: send.patientName, tipTitle: send.tipTitle }));
    console.log("Tip listo para enviar", JSON.stringify({ id: send.id, tipo: tip.type }));
    console.log("Fecha programada", send.scheduledAt);
    console.log("Fecha actual", new Date().toISOString());
    console.log(`Número destino +${send.phone}`);
    const utilityTemplate = utilityTemplates.get(send.utilityTemplateId);
    if (utilityTemplate) {
      console.log(`Enviando plantilla previa a ${send.patientName}/${send.phone}`, JSON.stringify({ role: send.recipientRole, utilityTemplateId: send.utilityTemplateId, utilityTemplateLabel: utilityTemplate.label }));
      const templateResult = await enviarPlantillaUtilidad(send.phone, utilityTemplate, send.patientName, { trace });
      utilityTemplateSent = true;
      utilityTemplateMessageId = templateResult.messageId;
      console.log("Resultado plantilla previa destinatario", JSON.stringify({ id: send.id, phone: send.phone, patientName: send.patientName, role: send.recipientRole, ok: true, messageId: templateResult.messageId }));
      tips.updateSend(send.id, { utilityTemplateMessageId: templateResult.messageId });
      history.registrar(send.clientId, send.phone, send.patientName, {
        tipo: "plantilla_previa_enviada",
        meta: utilityTemplate.label,
        metaEmoji: "📨",
        direccion: "saliente",
        utilityTemplateId: send.utilityTemplateId,
        utilityTemplateLabel: utilityTemplate.label,
        metaMessageId: templateResult.messageId,
        deliveryStatus: "accepted",
      });
    }
    console.log("Continuando con envío de contenido principal");
    console.log(`Enviando contenido principal a ${send.patientName}/${send.phone}`, JSON.stringify({ role: send.recipientRole, tipo: "tip", tipTitle: send.tipTitle }));
    console.log("Enviando tip", JSON.stringify({ id: send.id, phone: send.phone, tipId: send.tipId, tipo: tip.type }));
    console.log("Función de WhatsApp utilizada", "enviarTip -> enviar");
    console.log(`Enviando tip a ${send.patientName} (+${send.phone})`);
    contentStarted = true;
    const result = await enviarTip(send.phone, tip, send.message, send.patientName, { trace });
    mainMessageId = result.primaryMessageId;
    console.log("Resultado contenido principal destinatario", JSON.stringify({ id: send.id, phone: send.phone, patientName: send.patientName, role: send.recipientRole, ok: true, metaMessageId: result.primaryMessageId, textMessageId: result.textMessageId || "" }));
    console.log("Confirmación interna de envío de tip", JSON.stringify(result));
    tips.updateSend(send.id, {
      status: "enviado",
      sentAt: new Date().toISOString(),
      error: "",
      metaMessageId: result.primaryMessageId,
      textMessageId: result.textMessageId || "",
      deliveryStatus: "accepted",
    });
    history.registrar(send.clientId, send.phone, send.patientName, {
      tipo: "tip_enviado",
      meta: send.tipTitle,
      metaEmoji: tip.type === "image" ? "🖼️" : tip.type === "pdf" ? "📄" : "💬",
      comentario: send.message,
      direccion: "saliente",
      tipType: tip.type,
      utilityTemplateId: send.utilityTemplateId || "",
      utilityTemplateLabel: utilityTemplate?.label || "",
      metaMessageId: result.primaryMessageId,
      deliveryStatus: "accepted",
    });
    console.log("Tip enviado correctamente", JSON.stringify({ id: send.id, phone: send.phone, metaMessageId: result.primaryMessageId }));
    console.log(send.recipientRole === "pareja" ? "Resultado envío pareja" : "Resultado envío paciente principal", JSON.stringify({ id: send.id, phone: send.phone, ok: true }));
    console.log("Resultado final individual", JSON.stringify({ nombre: send.patientName, phone: send.phone, clientId: send.clientId, role: send.recipientRole, plantillaPrevia: utilityTemplate ? "enviada" : "no seleccionada", contenidoPrincipal: "enviado", messageId: result.primaryMessageId, templateMessageId: utilityTemplateMessageId }));
  } catch (e) {
    const utilityTemplate = utilityTemplates.get(send.utilityTemplateId);
    const realError = explainMetaError(e.message);
    const templateFailed = utilityTemplate && !utilityTemplateSent && !contentStarted;
    const detail = templateFailed
      ? `Error al enviar plantilla previa: ${realError}`
      : utilityTemplateSent
        ? `Plantilla previa enviada correctamente, pero falló el envío del tip: ${realError}`
        : `Error al enviar tip: ${realError}`;
    if (templateFailed) {
      console.error("Resultado plantilla previa destinatario", JSON.stringify({ id: send.id, phone: send.phone, patientName: send.patientName, role: send.recipientRole, ok: false, error: detail }));
    } else {
      console.error("Resultado contenido principal destinatario", JSON.stringify({ id: send.id, phone: send.phone, patientName: send.patientName, role: send.recipientRole, ok: false, error: detail, plantillaPreviaEnviada: utilityTemplateSent }));
    }
    console.error("Error individual de destinatario", JSON.stringify({ id: send.id, phone: send.phone, patientName: send.patientName, role: send.recipientRole, error: detail }));
    console.error(templateFailed ? "Error al enviar plantilla previa" : "Error al enviar contenido principal", JSON.stringify({ id: send.id, phone: send.phone, error: detail }));
    tips.updateSend(send.id, { status: "error", error: detail });
    history.registrar(send.clientId, send.phone, send.patientName, {
      tipo: templateFailed ? "plantilla_previa_error" : "tip_error",
      meta: templateFailed ? utilityTemplate.label : send.tipTitle,
      metaEmoji: templateFailed ? "📨" : (tip.type === "image" ? "🖼️" : tip.type === "pdf" ? "📄" : "💬"),
      comentario: detail,
      direccion: "saliente",
      utilityTemplateId: send.utilityTemplateId || "",
      utilityTemplateLabel: utilityTemplate?.label || "",
    });
    console.log("Resultado final individual", JSON.stringify({ nombre: send.patientName, phone: send.phone, clientId: send.clientId, role: send.recipientRole, plantillaPrevia: utilityTemplate ? (utilityTemplateSent ? "enviada" : "error") : "no seleccionada", contenidoPrincipal: contentStarted ? "error" : "no intentado", messageId: mainMessageId, templateMessageId: utilityTemplateMessageId, error: detail }));
    console.log("Continuando con siguiente destinatario", JSON.stringify({ id: send.id, phone: send.phone, tipTitle: send.tipTitle }));
  }
}

let checkingTips = false;
async function revisarTipsProgramados() {
  if (checkingTips) return;
  checkingTips = true;
  console.log("Revisando tips programados");
  try {
    const pending = tips.pendingSends();
    const now = new Date();
    console.log("Cantidad de tips pendientes", pending.length);
    for (const send of pending) {
      const scheduled = new Date(send.scheduledAt);
      const scheduledMs = scheduled.getTime();
      console.log("Fecha programada", JSON.stringify({ id: send.id, status: send.status, scheduledAt: send.scheduledAt }));
      console.log("Fecha actual", now.toISOString());
      if (Number.isNaN(scheduledMs)) {
        const reason = `Fecha programada inválida: ${send.scheduledAt}`;
        console.error("Error real al enviar tip", JSON.stringify({ id: send.id, error: reason }));
        tips.updateSend(send.id, { status: "error", error: reason });
      }
    }
    const due = tips.dueSends();
    console.log("Cantidad de tips listos para enviar", due.length);
    for (const [index, send] of due.entries()) await sendTipRecord(send, index + 1, due.length);
  } catch (e) {
    console.error("Error revisando tips programados", e.message);
  } finally {
    checkingTips = false;
  }
}

app.get("/api/tips", auth, (req, res) => res.json(tips.listTips()));
app.post("/api/tips", auth, (req, res) => {
  try { res.json({ ok: true, tip: tips.upsertTip(req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/tips/:id", auth, (req, res) => {
  try { res.json({ ok: true, tip: tips.upsertTip(req.body, req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/tips/:id", auth, (req, res) => {
  tips.deleteTip(req.params.id);
  res.json({ ok: true });
});
app.get("/api/tip-folders", auth, (req, res) => res.json(tips.listFolders()));
app.post("/api/tip-folders", auth, (req, res) => {
  try { res.json({ ok: true, folder: tips.createFolder(req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/tip-sends", auth, (req, res) => res.json(tips.listSends()));
app.post("/api/tips/send", auth, async (req, res) => {
  try {
    const tip = tips.getTip(req.body.tipId || req.body.id);
    if (!tip) return res.status(404).json({ error: "Tip no encontrado" });
    console.log("Ruta POST /api/tips/send", JSON.stringify({ tipId: tip.id, tipType: tip.type }));
    const sends = await createAndReviewTipSends(tip, req.body);
    res.json({ ok: true, sends });
  } catch (e) {
    console.error("Error real al enviar tip", e.message);
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/tips/:id/send", auth, async (req, res) => {
  try {
    const tip = tips.getTip(req.params.id);
    if (!tip) return res.status(404).json({ error: "Tip no encontrado" });
    const sends = await createAndReviewTipSends(tip, req.body);
    res.json({ ok: true, sends });
  } catch (e) {
    console.error("Error real al enviar tip", e.message);
    res.status(400).json({ error: e.message });
  }
});
app.put("/api/tip-sends/:id", auth, async (req, res) => {
  try {
    const send = tips.updateScheduledSend(req.params.id, {
      ...(req.body || {}),
      utilityTemplateId: utilityTemplates.validateId(req.body.utilityTemplateId),
    });
    console.log("Tip programado actualizado", JSON.stringify({ id: send.id, scheduledAt: send.scheduledAt }));
    await revisarTipsProgramados();
    res.json({ ok: true, send });
  } catch (e) {
    console.error("Error al actualizar tip programado", e.message);
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/tip-sends/:id/cancel", auth, (req, res) => {
  try {
    const send = tips.cancelScheduledSend(req.params.id);
    console.log("Tip programado cancelado", JSON.stringify({ id: send.id }));
    res.json({ ok: true, send });
  } catch (e) {
    console.error("Error al cancelar tip programado", e.message);
    res.status(400).json({ error: e.message });
  }
});

// ── Webhook Meta ───────────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else res.status(403).send("Forbidden");
});

app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");
  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        for (const status of change.value?.statuses || []) {
          const errorText = (status.errors || []).map(error => error.title || error.message || JSON.stringify(error)).join(" | ");
          console.log("Estado de entrega Meta", JSON.stringify({ id: status.id, status: status.status, recipientId: status.recipient_id, errors: status.errors || [] }));
          if (status.status === "failed") {
            const knownTip = tips.findByMetaMessageId(status.id);
            const isTipTemplate = knownTip?.utilityTemplateMessageId === status.id;
            const detail = `${isTipTemplate ? "Meta reportó fallo de entrega de la plantilla previa" : "Meta reportó fallo de entrega del contenido principal"}: ${explainMetaError(errorText || "sin detalle")}`;
            tips.updateByMetaMessageId(status.id, { status: "error", deliveryStatus: "failed", error: detail });
            const updatedHistory = history.updateByMetaMessageId(status.id, { deliveryStatus: "failed", comentario: detail });
            if (updatedHistory) {
              const failedType = updatedHistory.tipo === "plantilla_previa_enviada"
                ? "plantilla_previa_error"
                : updatedHistory.tipo === "meta_enviada" ? "meta_error" : "tip_error";
              history.updateByMetaMessageId(status.id, { tipo: failedType });
            }
            console.error(isTipTemplate ? "Error al enviar plantilla previa" : "Error al enviar contenido principal", JSON.stringify({ messageId: status.id, error: detail }));
          } else {
            tips.updateByMetaMessageId(status.id, { deliveryStatus: status.status });
            history.updateByMetaMessageId(status.id, { deliveryStatus: status.status });
          }
        }
        const messages2 = change.value?.messages;
        if (!messages2?.length) continue;
        for (const m of messages2) {
          // Pass the full message object to the bot for centralized parsing
          console.log(`📩 Raw message from ${m.from}: type=${m.type}`);
          procesarMensaje(m).catch(console.error);
        }
      }
    }
  } catch (e) { console.error("Error webhook:", e.message); }
});

app.get("/health", (_, res) => res.json({ status: "ok", clientes: db.getAll().length, uptime: Math.floor(process.uptime()) }));
app.get("/privacy", (_, res) => res.sendFile(path.join(__dirname, "public/privacy.html")));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.listen(PORT, () => {
  console.log(`\n🌱 NutriGO Panel v3 — puerto ${PORT}`);
  recargarTodos();
  revisarTipsProgramados();
  setInterval(revisarTipsProgramados, 60 * 1000);
});
