// src/whatsapp.js — Meta WhatsApp Cloud API
const conversations = require("./conversations");

async function enviar(phone, mensaje, nombre = "") {
  try {
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
          type: "text",
          text: { body: mensaje },
        }),
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    // Guardar en conversaciones
    conversations.registrar(phone, "enviado", mensaje, { nombre });
    console.log(`✅ Enviado a +${phone}`);
  } catch (e) {
    console.error(`❌ Error +${phone}:`, e.message);
  }
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

module.exports = { enviar, enviarPlantilla, enviarBotones };
