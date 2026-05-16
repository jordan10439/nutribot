// src/bot.js
const db      = require("./db");
const state   = require("./state");
const { enviar, enviarBotones } = require("./whatsapp");
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
    // Después de la bienvenida, enviar la primera meta si existe
    if (client.goals && client.goals.length > 0) {
      await enviarMeta(clientId, client.goals[0]);
    }
  } catch (e) {
    console.error(`❌ Error bienvenida +${phone}:`, e.message);
    // Fallback a mensaje de texto si la plantilla falla
    await enviar(phone, msg.get("bienvenida"));
    if (client.goals && client.goals.length > 0) {
      await enviarMeta(clientId, client.goals[0]);
    }
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

    // Enviar la pregunta con botones Sí / No
    const botones = [
      { id: `meta_si`, title: "Sí" },
      { id: `meta_no`, title: "No" }
    ];
    await enviar(phone, texto);
    await enviarBotones(phone, msg.get("pedir_listo"), botones);

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
async function getIncomingText(m) {
  // Extract text from various WhatsApp message shapes
  const type = m.type;
  let text = "";
  if (type === 'text') text = m.text?.body || "";
  else if (type === 'button') text = m.button?.text || m.button?.payload || "";
  else if (type === 'interactive') {
    if (m.interactive?.type === 'button_reply') text = m.interactive.button_reply?.id || m.interactive.button_reply?.title || "";
    else if (m.interactive?.type === 'list_reply') text = m.interactive.list_reply?.id || m.interactive.list_reply?.title || "";
  }
  // sometimes media messages include captions
  if (!text && (m.caption?.body)) text = m.caption.body;
  const tieneMedia = ['image','video','document'].includes(type) || !!(m.image||m.video||m.document);
  return { raw: text || '', norm: (text || '').toString().trim().toLowerCase(), type, tieneMedia };
}

async function procesarMensaje(m) {
  const phone = m.from;
  const client = findClientByPhone(phone);
  const incoming = await getIncomingText(m);
  const txt = incoming.norm;
  const tipoMsg = incoming.type;

  // Registrar mensaje entrante
  const s = state.get(phone);
  if (client) {
    const nombre = nombreDe(client, phone);
    const entry = {
      tipo: "mensaje_recibido",
      meta: s.meta?.titulo ?? "—",
      metaEmoji: s.meta?.emoji ?? "💬",
      comentario: incoming.raw,
      direccion: "entrante",
    };
    // Si el mensaje contiene media, adjuntar metadata para mostrar en dashboard
    if (m.image || m.video || m.document) {
      entry.media = m.image || m.video || m.document;
    }
    history.registrar(client.id, phone, nombre, entry);
  }

  if (!client) {
    console.log('[bot] No client for', phone);
    await enviar(phone, msg.get("sin_registro"));
    return;
  }

  const nombre = nombreDe(client, phone);
  const solo   = esIndividual(client);
  console.log('[bot] Incoming:', { phone, tipoMsg, raw: incoming.raw, txt, state: s.flow });

  // ── Esperando LISTO ──────────────────────────────────────────────────────
  if (s.flow === state.FLOW.META_ENVIADA) {
    // Accept button replies (meta_si / meta_no) or free-text yes/no
    if (incoming.raw === 'meta_si' || /^(si|sí|s|yes|y)$/i.test(incoming.raw)) {
      // User answered YES
      if (points.yaCompleto(client.id, phone)) {
        await enviar(phone, `¡Ya completaste esta meta! 🎉${solo ? "" : " Espera a tu compañer@. 💪"}`);
        return;
      }
      // If meta requires photo, ask for photo
      if (s.meta?.requiereFoto) {
        state.set(phone, { flow: state.FLOW.ESPERANDO_FOTO });
        await enviar(phone, msg.get("pedir_foto"));
      } else {
        // skip directly to estrellas
        state.set(phone, { flow: state.FLOW.ESPERANDO_ESTRELLAS, estrellasN: null });
        const be = msg.get("botones_estrellas") || ["Mal","Normal","Muy bien"];
        const botonesEst = be.map((t, i) => ({ id: `estrellas_${i}`, title: t }));
        await enviarBotones(phone, msg.get("pedir_estrellas"), botonesEst);
      }
    } else if (incoming.raw === 'meta_no' || /^(no|n|nah|not)$/i.test(incoming.raw)) {
      // User answered NO
      const meta = s.meta;
      // register as no_completada
      history.registrar(client.id, phone, nombre, {
        tipo: "no_completada",
        meta: meta?.titulo,
        metaEmoji: meta?.emoji,
        direccion: "entrante",
      });
      // If repetition enabled, schedule one-off reminder
      if (meta?.repetirSiNo && meta.repetirFreq && meta.repetirFreq.value > 0) {
        const unit = meta.repetirFreq.unit || 'hours';
        const value = Number(meta.repetirFreq.value) || 24;
        const ms = unit === 'days' ? value * 24 * 3600 * 1000 : value * 3600 * 1000;
        // Persist next reminder timestamp on the goal
        const clientObj = db.getById(client.id);
        const g = clientObj.goals.find(x => x.id === meta.id);
        if (g) {
          g.nextReminder = Date.now() + ms;
          db.upsert(clientObj);
        }
        setTimeout(async () => {
          console.log('[bot] Recordatorio por NO para meta', meta.titulo, '-> reenviando');
          await enviarMeta(client.id, meta);
        }, ms);
        await enviar(phone, `Entendido. Te volveré a recordar en ${value} ${unit}.`);
      } else {
        await enviar(phone, `Entendido. No volveré a insistir por ahora. 💚`);
      }
    } else {
      // Re-send buttons
      await enviarBotones(phone, msg.get("pedir_listo"), [{ id: 'meta_si', title: 'Sí' }, { id: 'meta_no', title: 'No' }]);
    }
    return;
  }

  // ── Esperando FOTO ───────────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_FOTO) {
    if (incoming.tieneMedia) {
      state.set(phone, { flow: state.FLOW.ESPERANDO_ESTRELLAS });
      const be = msg.get("botones_estrellas") || ["Mal","Normal","Muy bien"];
      const botonesEst = be.map((t, i) => ({ id: `estrellas_${i}`, title: t }));
      await enviarBotones(phone, msg.get("pedir_estrellas"), botonesEst);
    } else {
      await enviar(phone, `Envíame una foto como evidencia 📸`);
    }
    return;
  }

  // ── Esperando ESTRELLAS ──────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_ESTRELLAS) {
    // Map three-button responses to a 1-5 scale for compatibility with points
    let n = null;
    const be = msg.get("botones_estrellas") || ["Mal","Normal","Muy bien"];
    const beNorm = be.map(x=>x.toString().trim().toLowerCase());

    // Check id pattern estrellas_<i>
    if (incoming.raw && /^estrellas_\d+$/.test(incoming.raw)) {
      const idx = parseInt(incoming.raw.split("_")[1],10);
      const map = [1,3,5];
      if (!isNaN(idx)) n = map[idx] ?? null;
    }
    // Check title matches any configured button title
    if (n === null && beNorm.includes(txt)) {
      const idx = beNorm.indexOf(txt);
      const map = [1,3,5];
      n = map[idx] ?? null;
    }
    // fallback common words
    if (n === null) {
      if (/(^|\W)(mal|malo)(\W|$)/.test(txt)) n = 1;
      else if (/(^|\W)(normal)(\W|$)/.test(txt)) n = 3;
      else if (/(^|\W)(muy\s*bien|excelente|muybien)(\W|$)/.test(txt)) n = 5;
    }

    if (n) {
      state.set(phone, { flow: state.FLOW.ESPERANDO_DIFICULTAD, estrellasN: n });
      console.log('[bot] Estrellas aceptadas:', n, 'state -> ESPERANDO_DIFICULTAD');
      const bd = msg.get("botones_dificultad") || ["Fácil","Normal","Difícil"];
      const botones = bd.map((t, i) => ({ id: `dificultad_${i}`, title: t }));
      await enviarBotones(phone, msg.get("pedir_dificultad"), botones);
    } else {
      console.log('[bot] Estrellas NO reconocidas:', incoming.raw);
      await enviar(phone, `Por favor selecciona cómo te sientes usando los botones.`);
      const botonesEst = be.map((t,i) => ({ id: `estrellas_${i}`, title: t }));
      await enviarBotones(phone, msg.get("pedir_estrellas"), botonesEst);
    }
    return;
  }

  // ── Esperando DIFICULTAD ─────────────────────────────────────────────────
  if (s.flow === state.FLOW.ESPERANDO_DIFICULTAD) {
    // Accept replies from buttons (ids or titles) or simple text
    let dif = null;
    const bd = msg.get("botones_dificultad") || ["Fácil","Normal","Difícil"];
    const bdNorm = bd.map(x=>x.toString().trim().toLowerCase());
    if (incoming.raw && /^dificultad_\d+$/.test(incoming.raw)) {
      const idx = parseInt(incoming.raw.split("_")[1],10);
      if (!isNaN(idx) && bd[idx]) dif = bd[idx];
    }
    if (!dif && bdNorm.includes(txt)) {
      dif = bd[bdNorm.indexOf(txt)];
    }
    if (!dif) {
      if (/(^|\W)(1|facil|fácil)(\W|$)/.test(txt)) dif = "Fácil";
      else if (/(^|\W)(2|normal)(\W|$)/.test(txt)) dif = "Normal";
      else if (/(^|\W)(3|dificil|difícil)(\W|$)/.test(txt)) dif = "Difícil";
    }

    if (dif) {
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
      await enviar(phone, `Por favor selecciona una opción usando los botones.`);
      const botones = [
        { id: "dificultad_facil", title: "Fácil" },
        { id: "dificultad_normal", title: "Normal" },
        { id: "dificultad_dificil", title: "Difícil" },
      ];
      await enviarBotones(phone, msg.get("pedir_dificultad"), botones);
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
