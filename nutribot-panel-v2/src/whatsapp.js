// src/whatsapp.js — Meta WhatsApp Cloud API
async function enviar(phone, mensaje) {
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
    console.log(`✅ Enviado a +${phone}`);
  } catch (e) {
    console.error(`❌ Error +${phone}:`, e.message);
  }
}
module.exports = { enviar };
