// src/whatsapp.js — Meta WhatsApp Cloud API
const conversations = require("./conversations");

async function postWhatsApp(payload) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.META_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.META_TOKEN}`,
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    }
  );
  const data = await res.json().catch(() => ({}));
  console.log("Respuesta de WhatsApp", JSON.stringify(data));
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

async function enviar(phone, mensaje, nombre = "") {
  try {
    await postWhatsApp({ to: phone, type: "text", text: { body: mensaje } });
    // Guardar en conversaciones
    conversations.registrar(phone, "enviado", mensaje, { nombre });
    console.log(`✅ Enviado a +${phone}`);
  } catch (e) {
    console.error(`❌ Error +${phone}:`, e.message);
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
  if (!res.ok || data.error || !data.id) throw new Error(data.error?.message || `Error subiendo media HTTP ${res.status}`);
  return data.id;
}

async function enviarTip(phone, tip, message, nombre = "") {
  if (tip.type === "phrase") {
    await postWhatsApp({ to: phone, type: "text", text: { body: message || tip.phrase } });
  } else {
    const mediaId = await uploadMedia(tip.data, tip.filename);
    const caption = message || tip.desc || tip.title || "";
    if (tip.type === "image") {
      await postWhatsApp({ to: phone, type: "image", image: { id: mediaId, caption } });
    } else if (tip.type === "pdf") {
      await postWhatsApp({ to: phone, type: "document", document: { id: mediaId, caption, filename: tip.filename || `${tip.title}.pdf` } });
    } else {
      throw new Error(`Tipo de tip no soportado: ${tip.type}`);
    }
  }
  conversations.registrar(phone, "enviado", `[Tip] ${tip.title}`, { nombre });
}

async function enviarBotones(phone, headerText, buttons = []) {
  try {
    // buttons: array of { id, title }
    const interactive = {
      type: "button",
      body: { text: headerText },
      action: { buttons: buttons.map(b => ({ type: "reply", reply: { id: b.id, title: b.title } })) }
    };

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
          type: "interactive",
          interactive,
        }),
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    conversations.registrar(phone, "enviado", `[Botones] ${headerText}`);
    console.log(`✅ Botones enviados a +${phone}`);
  } catch (e) {
    console.error(`❌ Error botones +${phone}:`, e.message);
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

module.exports = { enviar, enviarPlantilla, enviarBotones, enviarTip };
