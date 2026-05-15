// src/bot.js
const db      = require("./db");
const state   = require("./state");
const { enviar } = require("./whatsapp");
const { respuestaIA } = require("./ai");
const points  = require("./points");
const history = require("./history");

function findClientByPhone(phone) {
  return db.getAll().find(c => c.phones.includes(phone));
}
function nombreDe(client, phone) {
  return client.nombres[client.phones.indexOf(phone)] ?? "Amig@";
}
function esIndividual(client) { return client.phones.length === 1; }
function estrellas(n) { return "⭐".repeat(n) + "☆".repeat(5 - n); }

// ── Enviar meta ───────────────────────────────────────────────────────────────
async function enviarMeta(clientId, meta) {
  const client = db.getById(clientId);
  if (!client) return;
  const solo = esIndividual(client);

  for (const phone of client.phones) {
    const nombre = nombreDe(client, phone);
    state.set(phone, { flow: state.FLOW.META_ENVIADA, clientId, meta });

    // Registrar en historial que se envió la meta
    history.registrar(clientId, phone, nombre, {
      tipo: "meta_enviada",
      meta: meta.titulo,
      metaEmoji: meta.emoji,
    });

    await enviar(phone,
      `🎯 *¡Nueva Meta!*\n\n` +
      `Hola ${nombre}! ${meta.emoji}\n\n` +
      `*${meta.titulo}*\n\n` +
      `📋 ${meta.descripcion}\n\n` +
      `Cuando la completes, responde *LISTO* 🚀`
    );
  }
  console.log(`📤 Meta "${meta.titulo}" enviada a ${client.nombres.join(" & ")}`);
}

// ── Procesar mensajes ─────────────────────────────────────────────────────────
async function procesarMensaje(phone, texto, tieneMedia) {
  const client = findClientByPhone(phone);
  const s      = state.get(phone);
  const txt    = texto.trim().toLowerCase();

  if (!client) {
    await enviar(phone, `¡Hola! 👋 Pídele a tu nutricionista que te registre en el programa. 🌱`);
    return;
  }

  const nombre = nombreDe(client, phone);
  const solo   = esIndividual(client);

  // ── Esperando LISTO ──────────────────────────────────────────────────────
  if (s.flow === state.FLOW.META_ENVIADA) {
    if (["listo","si","sí","ok","dale","ya","empezar"].includes(txt)) {
      if (points.yaCompleto(client.id, phone)) {
        await enviar(phone, `¡Ya completaste esta meta! 🎉${solo ? "" : " Espera a tu compañer@. 💪"}`);
        return;
      }
      state.set(phone, { flow: state.FLOW.ESPERANDO_FOTO });
      await enviar(phone,
        `¡Genial ${nombre}! 👏\n\n` +
        `Envíame una *foto* como evidencia de tu meta completada 📸`
      );
    } else {
      await enviar(phone, `Cuando completes la meta, responde *LISTO* 🚀`);
    }
    return;
  }

  // ── Esperando FOTO ───────────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_FOTO) {
    if (tieneMedia) {
      state.set(phone, { flow: state.FLOW.ESPERANDO_ESTRELLAS });
      await enviar(phone,
        `📸 ¡Increíble ${nombre}! 🤩\n\n` +
        `¿Cómo te sientes después de completar la meta?\n\n` +
        `1️⃣ - Mal\n2️⃣ - Regular\n3️⃣ - Bien\n4️⃣ - Muy bien\n5️⃣ - ¡Excelente!\n\n` +
        `Responde del 1 al 5`
      );
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
      await enviar(phone,
        `${estrellas(n)} Anotado! ✨\n\n` +
        `¿Qué tan difícil fue cumplirla?\n\n` +
        `1️⃣ - Muy fácil\n2️⃣ - Fácil\n3️⃣ - Normal\n4️⃣ - Difícil\n5️⃣ - Muy difícil\n\n` +
        `Responde del 1 al 5`
      );
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
      state.set(phone, { flow: state.FLOW.DONE });

      // Registrar en historial
      history.registrar(client.id, phone, nombre, {
        tipo: "completada",
        meta: s.meta?.titulo,
        metaEmoji: s.meta?.emoji,
        estrellas: s.estrellasN,
        dificultad: dif,
        puntos: resultado.puntos,
        comentario: null,
      });

      const aiMsg = await respuestaIA(nombre,
        `${nombre} completó su meta "${s.meta?.titulo}". ` +
        `Se sintió ${estrellas(s.estrellasN ?? 3)} y fue ${dif}. ` +
        `Celébralo en 2 oraciones.`
      );

      let msg =
        `🎉 *¡META COMPLETADA!* 🎉\n\n` +
        `${aiMsg}\n\n➕ *+10 PUNTOS*\n${points.resumen(client.id)}`;

      if (resultado.subioNivel) {
        msg += `\n\n🆙 *¡Subiste de nivel!* ${resultado.nivelNuevo.emoji} *${resultado.nivelNuevo.nombre}*`;
      }

      if (!solo) {
        const partner = client.phones.find(p => p !== phone);
        if (resultado.ambos) {
          msg += `\n\n🎊 *¡Los dos completaron la meta!* ¡Equipo increíble! 💚`;
          if (partner) await enviar(partner, `🎊 *¡${nombre} también completó la meta!*\n\n${points.resumen(client.id)}`);
        } else {
          msg += `\n\n⏳ Esperando que tu pareja complete...`;
          if (partner && state.get(partner).flow !== state.FLOW.DONE) {
            await enviar(partner, `💪 *¡${nombre} ya completó la meta!*\nResponde *LISTO* cuando termines 🚀`);
          }
        }
      }

      // Pedir comentario opcional
      msg += `\n\n💬 ¿Quieres dejar algún comentario sobre esta meta? (opcional)\nResponde lo que quieras o escribe *omitir*`;
      state.set(phone, { flow: state.FLOW.ESPERANDO_COMENTARIO });
      await enviar(phone, msg);
    } else {
      await enviar(phone, `Responde con un número del *1 al 5*`);
    }
    return;
  }

  // ── Esperando COMENTARIO (opcional) ─────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_COMENTARIO) {
    const comentario = ["omitir","skip","no","nada"].includes(txt) ? null : texto;
    
    // Actualizar el último registro con el comentario
    const historial = history.getHistorial(client.id);
    const ultimo = historial.find(h => h.phone === phone && h.tipo === "completada");
    if (ultimo && comentario) {
      ultimo.comentario = comentario;
      // Re-guardar
      const fs = require("fs");
      const path = require("path");
      const FILE = path.join(__dirname, "../data/history.json");
      const db2 = JSON.parse(fs.readFileSync(FILE, "utf8"));
      const idx = db2[client.id]?.findIndex(h => h.id === ultimo.id);
      if (idx >= 0) db2[client.id][idx] = ultimo;
      fs.writeFileSync(FILE, JSON.stringify(db2, null, 2));
    }

    state.set(phone, { flow: state.FLOW.DONE });
    await enviar(phone,
      comentario
        ? `✍️ ¡Gracias por tu comentario! Tu nutricionista lo podrá ver. 💚`
        : `¡Perfecto! Hasta la próxima meta. ¡Sigue así! 💪`
    );
    return;
  }

  // ── Sin flujo activo ─────────────────────────────────────────────────────
  await enviar(phone,
    `¡Hola ${nombre}! 👋 Soy tu Coach Nutricional 🌱\n\n` +
    `${points.resumen(client.id)}\n\n¡Sigue así! 💚`
  );
}

module.exports = { enviarMeta, procesarMensaje };
