// src/whatsapp.js — Meta WhatsApp Cloud API
const conversations = require("./conversations");
const utilityTemplates = require("./utilityTemplates");

function formatWhatsAppError(data, status, context) {
  const err = data?.error || {};
  const parts = [
    `WhatsApp/Meta rechazó la solicitud (${context})`,
    `HTTP ${status}`,
    err.code ? `code=${err.code}` : "",
    err.type ? `type=${err.type}` : "",
    err.error_subcode ? `subcode=${err.error_subcode}` : "",
    err.fbtrace_id ? `fbtrace_id=${err.fbtrace_id}` : "",
    err.message ? `message="${err.message}"` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

function getMessageId(data) {
  return data?.messages?.[0]?.id || "";
}

function metaLogKind(payload, context) {
  if (payload?.type === "template" || /plantilla/i.test(context)) return "plantilla previa";
  return "contenido principal";
}

async function postWhatsApp(payload, context = payload.type || "mensaje", trace = {}) {
  const metaPayload = { messaging_product: "whatsapp", ...payload };
  const kind = metaLogKind(payload, context);
  const traceData = { context, kind, ...trace, to: payload.to, type: payload.type };
  if (kind === "plantilla previa") console.log("Payload plantilla previa enviado a Meta", JSON.stringify({ trace: traceData, payload: metaPayload }));
  else console.log("Payload contenido principal enviado a Meta", JSON.stringify({ trace: traceData, payload: metaPayload }));
  console.log(`Payload exacto enviado a Meta para ${context}`, JSON.stringify(metaPayload));
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.META_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.META_TOKEN}`,
      },
      body: JSON.stringify(metaPayload),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (kind === "plantilla previa") console.log("Respuesta plantilla previa Meta", JSON.stringify({ trace: traceData, status: res.status, data }));
  else console.log("Respuesta contenido principal Meta", JSON.stringify({ trace: traceData, status: res.status, data }));
  console.log(`Respuesta real de Meta para ${context}`, JSON.stringify(data));
  if (!res.ok || data.error) throw new Error(formatWhatsAppError(data, res.status, context));
  const messageId = getMessageId(data);
  if (!messageId) {
    console.error("No se recibió message ID de Meta, no marcar como enviado", JSON.stringify({ context, data }));
    throw new Error(`No se recibió message ID de Meta para ${context}, no marcar como enviado`);
  }
  if (kind === "contenido principal") console.log("Message ID contenido principal", JSON.stringify({ trace: traceData, messageId }));
  console.log(`Message ID de Meta para ${context}`, messageId);
  return { data, messageId };
}

async function enviar(phone, mensaje, nombre = "", options = {}) {
  try {
    const text = String(mensaje || "").trim();
    if (!text) throw new Error("Contenido principal vacío, no se envía a Meta");
    console.log("Contenido principal a enviar:", text);
    console.log("Número destino contenido principal:", phone);
    const result = await postWhatsApp({
      to: phone,
      type: "text",
      text: { body: text },
    }, options.context || "contenido principal", options.trace || {});
    conversations.registrar(phone, "enviado", mensaje, { nombre });
    console.log(`✅ Enviado a +${phone}`);
    return { ok: true, data: result.data, messageId: result.messageId };
  } catch (e) {
    console.error(`❌ Error +${phone}:`, e.message);
    if (options.throwOnError) throw e;
    return { ok: false, error: e.message };
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Archivo inválido");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function uploadMedia(dataUrl, filename) {
  const { mime, buffer } = parseDataUrl(dataUrl);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([buffer], { type: mime }), filename || "tip");
  const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.META_PHONE_ID}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.META_TOKEN}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  console.log("Respuesta de WhatsApp media", JSON.stringify(data));
  if (!res.ok || data.error || !data.id) throw new Error(formatWhatsAppError(data, res.status, "subida de media"));
  return data.id;
}

async function enviarTip(phone, tip, message, nombre = "", options = {}) {
  const text = message || tip.phrase || tip.desc || tip.title || "";
  if (tip.type === "phrase") {
    console.log("Enviando tip");
    console.log("Enviando tip tipo Frase");
    console.log(`Número destino +${phone}`);
    console.log("Función de WhatsApp utilizada", "enviar");
    const result = await enviar(phone, text, nombre, { throwOnError: true, context: "tip", trace: options.trace || {} });
    if (!result.ok) throw new Error(result.error);
    return { ok: true, textSent: true, mediaSent: false, primaryMessageId: result.messageId };
  }

  let textSent = false;
  let textMessageId = "";
  if (text) {
    const textResult = await enviar(phone, text, nombre, { throwOnError: true, context: "texto del tip", trace: options.trace || {} });
    if (!textResult.ok) throw new Error(textResult.error);
    textSent = true;
    textMessageId = textResult.messageId;
  }

  try {
    const mediaId = await uploadMedia(tip.data, tip.filename);
    let mediaResult;
    if (tip.type === "image") {
      mediaResult = await postWhatsApp({ to: phone, type: "image", image: { id: mediaId } }, "imagen del tip", options.trace || {});
    } else if (tip.type === "pdf") {
      mediaResult = await postWhatsApp({ to: phone, type: "document", document: { id: mediaId, filename: tip.filename || `${tip.title}.pdf` } }, "PDF del tip", options.trace || {});
    } else {
      throw new Error(`Tipo de tip no soportado: ${tip.type}`);
    }
    conversations.registrar(phone, "enviado", `[Tip] ${tip.title}`, { nombre });
    return { ok: true, textSent, mediaSent: true, primaryMessageId: mediaResult.messageId, textMessageId };
  } catch (e) {
    if (textSent) throw new Error(`Se envió el texto del tip, pero falló el archivo: ${e.message}`);
    throw e;
  }
}

async function enviarBotones(phone, headerText, buttons = [], options = {}) {
  try {
    // buttons: array of { id, title }
    const interactive = {
      type: "button",
      body: { text: headerText },
      action: { buttons: buttons.map(b => ({ type: "reply", reply: { id: b.id, title: b.title } })) }
    };

    const result = await postWhatsApp({ to: phone, type: "interactive", interactive }, options.context || "botones de meta", options.trace || {});
    conversations.registrar(phone, "enviado", `[Botones] ${headerText}`);
    console.log(`✅ Botones enviados a +${phone}`);
    return { ok: true, data: result.data, messageId: result.messageId };
  } catch (e) {
    console.error(`❌ Error botones +${phone}:`, e.message);
    if (options.throwOnError) throw e;
    return { ok: false, error: e.message };
  }
}

async function enviarPlantilla(phone, nombrePlantilla, variables = []) {
  try {
    const components = variables.length > 0 ? [{
      type: "body",
      parameters: variables.map(v => ({ type: "text", text: v })),
    }] : [];

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${process.env.META_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.META_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: nombrePlantilla,
            language: { code: "es" },
            components,
          },
        }),
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    conversations.registrar(phone, "enviado", `[Plantilla: ${nombrePlantilla}]`);
    console.log(`✅ Plantilla "${nombrePlantilla}" enviada a +${phone}`);
  } catch (e) {
    console.error(`❌ Error plantilla +${phone}:`, e.message);
  }
}

async function enviarPlantillaOficial(phone, templateName, languageCode, context, nombre = "", options = {}) {
  const result = await postWhatsApp({
    to: phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  }, context, options.trace || {});
  conversations.registrar(phone, "enviado", `[Plantilla: ${context}]`, { nombre });
  return { ok: true, data: result.data, messageId: result.messageId };
}

async function enviarPlantillaUtilidad(phone, template, nombre = "", options = {}) {
  const metaName = utilityTemplates.configuredName(template);
  const languageCode = utilityTemplates.configuredLanguage(template);
  console.log("Plantilla previa seleccionada", JSON.stringify({ phone, templateId: template.id, label: template.label }));
  console.log("Template enviado a Meta", JSON.stringify({ name: metaName, languageCode }));
  console.log("Enviando plantilla previa");
  const result = await enviarPlantillaOficial(phone, metaName, languageCode, `Plantilla previa: ${template.label}`, nombre, options);
  console.log("Plantilla previa enviada correctamente", JSON.stringify({ phone, templateId: template.id, metaName }));
  return result;
}

module.exports = { enviar, enviarPlantilla, enviarPlantillaOficial, enviarPlantillaUtilidad, enviarBotones, enviarTip };
