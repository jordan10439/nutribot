// src/bot.js
const db      = require("./db");
const state   = require("./state");
const { enviar } = require("./whatsapp");
const { respuestaIA } = require("./ai");
const points  = require("./points");
const history = require("./history");
const msg     = require("./messages");

const TEMPLATE_NAME = process.env.META_TEMPLATE_NAME || "m_ensaje_inicial_nutrigo";

function findClientByPhone(phone) {
  return db.getAll().find(c => c.phones.includes(phone));
}
function nombreDe(client, phone) {
  return client.nombres[client.phones.indexOf(phone)] ?? "Amig@";
}
function esIndividual(client) { return client.phones.length === 1; }
function estrellas(n) { return "⭐".repeat(n) + "☆".repeat(5 - n); }

// ── Enviar bienvenida con plantilla Meta ────────────────────────────────────
async function enviarBienvenida(clientId, phone) {
  const client = db.getById(clientId);
  if (!client) return;
  const nombre = nombreDe(client, phone);

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
          type: "template",
          template: {
            name: TEMPLATE_NAME,
            language: { code: "es" },
          },
        }),
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    console.log(`✅ Bienvenida enviada a +${phone}`);

    history.registrar(clientId, phone, nombre, {
      tipo: "bienvenida_enviada",
      meta: "Mensaje de bienvenida",
      metaEmoji: "👋",
      direccion: "saliente",
    });
  } catch (e) {
    console.error(`❌ Error bienvenida +${phone}:`, e.message);
    // Fallback a mensaje de texto si la plantilla falla
    await enviar(phone, msg.get("bienvenida"));
  }
}

// ── Enviar meta ───────────────────────────────────────────────────────────────
async function enviarMeta(clientId, meta) {
  const client = db.getById(clientId);
  if (!client) return;

  for (const phone of client.phones) {
    const nombre = nombreDe(client, phone);
    state.set(phone, { flow: state.FLOW.META_ENVIADA, clientId, meta });

    const texto =
      `🎯 *¡Nueva Meta!*\n\n` +
      `Hola ${nombre}! ${meta.emoji}\n\n` +
      `*${meta.titulo}*\n\n` +
      `📋 ${meta.descripcion}\n\n` +
      msg.get("pedir_listo");

    await enviar(phone, texto);

    history.registrar(clientId, phone, nombre, {
      tipo: "meta_enviada",
      meta: meta.titulo,
      metaEmoji: meta.emoji,
      direccion: "saliente",
    });
  }
  console.log(`📤 Meta "${meta.titulo}" enviada a ${client.nombres.join(" & ")}`);
}

// ── Procesar mensajes entrantes ───────────────────────────────────────────────
async function procesarMensaje(phone, texto, tieneMedia) {
  const client = findClientByPhone(phone);
  const s      = state.get(phone);
  const txt    = texto.trim().toLowerCase();

  // Registrar mensaje entrante
  if (client) {
    const nombre = nombreDe(client, phone);
    history.registrar(client.id, phone, nombre, {
      tipo: "mensaje_recibido",
      meta: s.meta?.titulo ?? "—",
      metaEmoji: s.meta?.emoji ?? "💬",
      comentario: texto,
      direccion: "entrante",
    });
  }

  if (!client) {
    await enviar(phone, msg.get("sin_registro"));
    return;
  }

  const nombre = nombreDe(client, phone);
  const solo   = esIndividual(client);

  // ── Esperando LISTO ──────────────────────────────────────────────────────
  if (s.flow === state.FLOW.META_ENVIADA) {
    if (["listo","si","sí","ok","dale","ya","empezar","done"].includes(txt)) {
      if (points.yaCompleto(client.id, phone)) {
        await enviar(phone, `¡Ya completaste esta meta! 🎉${solo ? "" : " Espera a tu compañer@. 💪"}`);
        return;
      }
      state.set(phone, { flow: state.FLOW.ESPERANDO_FOTO });
      await enviar(phone, `¡Genial ${nombre}! 👏\n\n${msg.get("pedir_foto")}`);
    } else {
      await enviar(phone, msg.get("pedir_listo"));
    }
    return;
  }

  // ── Esperando FOTO ───────────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_FOTO) {
    if (tieneMedia) {
      state.set(phone, { flow: state.FLOW.ESPERANDO_ESTRELLAS });
      await enviar(phone, msg.get("pedir_estrellas"));
    } else {
      await enviar(phone, `Envíame una foto como evidencia 📸`);
    }
    return;
  }

  // ── Esperando ESTRELLAS ──────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_ESTRELLAS) {
    const n = parseInt(txt);
    if (n >= 1 && n <= 5) {
      state.set(phone, { flow: state.FLOW.ESPERANDO_DIFICULTAD, estrellasN: n });
      await enviar(phone, msg.get("pedir_dificultad"));
    } else {
      await enviar(phone, `Responde con un número del *1 al 5* ⭐`);
    }
    return;
  }

  // ── Esperando DIFICULTAD ─────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_DIFICULTAD) {
    const n = parseInt(txt);
    if (n >= 1 && n <= 5) {
      const dificultades = ["Muy fácil","Fácil","Normal","Difícil","Muy difícil"];
      const dif = dificultades[n - 1];
      const resultado = points.sumar(client.id, phone, client.phones.length);
      state.set(phone, { flow: state.FLOW.ESPERANDO_COMENTARIO });

      const aiMsg = await respuestaIA(nombre,
        `${nombre} completó su meta "${s.meta?.titulo}". Se sintió ${estrellas(s.estrellasN ?? 3)} y fue ${dif}. Celébralo en 2 oraciones.`
      );

      const resumenPts = points.resumen(client.id);
      let msgFinal = msg.get("meta_completada")
        .replace("{ia}", aiMsg)
        .replace("{resumen}", resumenPts);

      if (resultado.subioNivel) {
        msgFinal += `\n\n🆙 *¡Subiste de nivel!* ${resultado.nivelNuevo.emoji} *${resultado.nivelNuevo.nombre}*`;
      }

      history.registrar(client.id, phone, nombre, {
        tipo: "completada",
        meta: s.meta?.titulo,
        metaEmoji: s.meta?.emoji,
        estrellas: s.estrellasN,
        dificultad: dif,
        puntos: resultado.puntos,
        direccion: "saliente",
      });

      if (!solo) {
        const partner = client.phones.find(p => p !== phone);
        if (resultado.ambos) {
          msgFinal += `\n\n🎊 *¡Los dos completaron la meta!* ¡Equipo increíble! 💚`;
          if (partner) await enviar(partner, `🎊 *¡${nombre} también completó la meta!*\n\n${resumenPts}`);
        } else {
          msgFinal += `\n\n⏳ Esperando que tu pareja complete...`;
          if (partner && state.get(partner).flow !== state.FLOW.DONE) {
            await enviar(partner, `💪 *¡${nombre} ya completó la meta!*\nResponde *LISTO* cuando termines 🚀`);
          }
        }
      }

      await enviar(phone, msgFinal);
      await enviar(phone, msg.get("pedir_comentario"));
    } else {
      await enviar(phone, `Responde con un número del *1 al 5*`);
    }
    return;
  }

  // ── Esperando COMENTARIO ─────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_COMENTARIO) {
    const comentario = ["omitir","skip","no","nada"].includes(txt) ? null : texto;
    if (comentario) {
      const historial = history.getHistorial(client.id);
      const ultimo = historial.find(h => h.phone === phone && h.tipo === "completada");
      if (ultimo) {
        ultimo.comentario = comentario;
        const fs2 = require("fs");
        const path2 = require("path");
        const FILE2 = path2.join(__dirname, "../data/history.json");
        const db2 = JSON.parse(fs2.readFileSync(FILE2, "utf8"));
        const idx = db2[client.id]?.findIndex(h => h.id === ultimo.id);
        if (idx >= 0) db2[client.id][idx] = ultimo;
        fs2.writeFileSync(FILE2, JSON.stringify(db2, null, 2));
      }
    }
    state.set(phone, { flow: state.FLOW.DONE });
    await enviar(phone, comentario
      ? `✍️ ¡Gracias por tu comentario! Tu nutricionista lo verá. 💚`
      : `¡Perfecto! Hasta la próxima meta. ¡Sigue así! 💪`
    );
    return;
  }

  // ── Sin flujo activo ─────────────────────────────────────────────────────
  await enviar(phone,
    `¡Hola ${nombre}! 👋 Soy NutriGO 🌱\n\n${points.resumen(client.id)}\n\n¡Sigue así! 💚`
  );
}

module.exports = { enviarMeta, enviarBienvenida, procesarMensaje };
