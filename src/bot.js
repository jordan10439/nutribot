// src/bot.js
const db      = require("./db");
const state   = require("./state");
const { enviar, enviarBotones, enviarPlantillaOficial, enviarPlantillaUtilidad } = require("./whatsapp");
const { respuestaIA } = require("./ai");
const points  = require("./points");
const history = require("./history");
const msg     = require("./messages");
const utilityTemplates = require("./utilityTemplates");

const WELCOME_TEMPLATE_NAME = process.env.META_WELCOME_TEMPLATE_NAME || process.env.META_TEMPLATE_NAME || "";
const WELCOME_TEMPLATE_LANGUAGE = process.env.META_WELCOME_TEMPLATE_LANGUAGE || "";

function configuredWelcomeValue(value, variable, field) {
  const clean = String(value || "").trim();
  const placeholder = /placeholder|ejemplo|example|cambiar|configurar|nombre[_ -]?real/i.test(clean);
  if (!clean || placeholder) {
    throw new Error(`Falta configurar ${field} de la plantilla de bienvenida aprobada en Meta (${variable})`);
  }
  return clean;
}

function findClientByPhone(phone) {
  return db.getAll().find(c => c.phones.includes(phone));
}
function nombreDe(client, phone) {
  return client.nombres[client.phones.indexOf(phone)] ?? "Amig@";
}
function esIndividual(client) { return client.phones.length === 1; }
function estrellas(n) { return "⭐".repeat(n) + "☆".repeat(5 - n); }

function calcularProgresoMeta(client, phone, currentMeta) {
  const totalMetas = Math.max((client.goals || []).length, 1);
  const metasCompletadas = new Set(
    history.getHistorial(client.id)
      .filter(entry => entry.tipo === "completada" && entry.phone === phone)
      .map(entry => entry.goalId || entry.meta)
      .filter(Boolean)
  );
  const currentKey = currentMeta?.id || currentMeta?.titulo;
  if (currentKey) metasCompletadas.add(currentKey);
  const completadas = Math.min(metasCompletadas.size, totalMetas);
  return {
    totalMetas,
    completadas,
    puntosAcumulados: completadas * 10,
    puntosPosibles: totalMetas * 10,
  };
}

function resumenProgresoPaciente(progreso) {
  return [
    "⭐ *Puntos de esta meta: 10/10*",
    `✅ *Metas completadas: ${progreso.completadas}/${progreso.totalMetas}*`,
    `🏆 *Puntaje acumulado: ${progreso.puntosAcumulados}/${progreso.puntosPosibles} puntos*`,
    "",
    "Cada meta completada suma 10 puntos. Sigue avanzando paso a paso 🌱",
  ].join("\n");
}

const REACCION_EMOCIONAL = {
  positivo: "¡Qué bueno leer eso! ✨ Me alegra que esta meta haya dejado una sensación positiva. Cada avance cuenta 🌱",
  neutro: "Gracias por contármelo ✨ A veces los cambios se sienten de a poco, y eso también está bien 🌱",
  negativo: "Gracias por contármelo 💚 A veces una meta puede sentirse más difícil de lo esperado, y eso también es parte del proceso. Lo importante es reconocer cómo fue y seguir avanzando de a poco 🌱",
};

const REACCION_DIFICULTAD = {
  "Fácil": "¡Qué bueno! ✨ Me alegra que esta meta haya sido fácil de realizar. Seguimos avanzando paso a paso 🌱",
  "Normal": "Perfecto, gracias por contármelo ✨ Que haya sido manejable también es un buen avance 🌱",
  "Difícil": "Gracias por responder 💚 Quedó registrado. No pasa nada si esta vez costó más, cada proceso tiene días más fáciles y otros más difíciles 🌱",
};

function normalizarTexto(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function detectarEstadoEmocional(incoming, buttons) {
  const raw = incoming.raw || "";
  const normalized = normalizarTexto(raw);
  let respuesta = raw;
  let estado = null;
  let n = null;
  const buttonMatch = raw.match(/^estrellas_(\d+)$/);

  if (buttonMatch) {
    const idx = Number(buttonMatch[1]);
    respuesta = buttons[idx] || raw;
    if (buttons.length >= 5) {
      estado = idx <= 1 ? "negativo" : idx === 2 ? "neutro" : "positivo";
      n = idx + 1;
    } else {
      estado = idx === 0 ? "negativo" : idx === 1 ? "neutro" : "positivo";
      n = [1, 3, 5][idx] || null;
    }
  } else {
    const buttonIndex = buttons.map(normalizarTexto).indexOf(normalized);
    if (buttonIndex >= 0) {
      return detectarEstadoEmocional({ raw: `estrellas_${buttonIndex}` }, buttons);
    }
    if (/(^|\W)(mal|cansancio|frustracion|tristeza|me costo|no pude|dificil|complicad[oa])(\W|$)/.test(normalized) || /^(1|2)$/.test(normalized)) {
      estado = "negativo";
      n = 1;
    } else if (/(^|\W)(normal|mas o menos|igual|regular)(\W|$)/.test(normalized) || normalized === "3") {
      estado = "neutro";
      n = 3;
    } else if (/(^|\W)(bien|feliz|con animo|motivad[oa]|orgullos[oa]|content[oa]|excelente)(\W|$)/.test(normalized) || /^(4|5)$/.test(normalized)) {
      estado = "positivo";
      n = 5;
    }
  }

  return estado ? { estado, n, respuesta, reaccion: REACCION_EMOCIONAL[estado] } : null;
}

function detectarDificultad(incoming, buttons) {
  const raw = incoming.raw || "";
  const normalized = normalizarTexto(raw);
  let respuesta = raw;
  let dificultad = null;
  const indexMatch = raw.match(/^dificultad_(\d+)$/);

  if (indexMatch) {
    const idx = Number(indexMatch[1]);
    respuesta = buttons[idx] || raw;
    dificultad = buttons.length >= 5
      ? (idx <= 1 ? "Fácil" : idx === 2 ? "Normal" : "Difícil")
      : (["Fácil", "Normal", "Difícil"][idx] || null);
  } else if (/^dificultad_(facil|normal|dificil)$/.test(normalized)) {
    dificultad = normalized.endsWith("facil") ? "Fácil" : normalized.endsWith("normal") ? "Normal" : "Difícil";
    respuesta = dificultad;
  } else {
    const buttonIndex = buttons.map(normalizarTexto).indexOf(normalized);
    if (buttonIndex >= 0) {
      return detectarDificultad({ raw: `dificultad_${buttonIndex}` }, buttons);
    }
    if (/(^|\W)(muy facil|facil)(\W|$)/.test(normalized) || normalized === "1") dificultad = "Fácil";
    else if (/(^|\W)(normal)(\W|$)/.test(normalized) || /^(2|3)$/.test(normalized)) dificultad = "Normal";
    else if (/(^|\W)(muy dificil|dificil|complicad[oa])(\W|$)/.test(normalized) || /^(4|5)$/.test(normalized)) dificultad = "Difícil";
  }

  return dificultad ? { dificultad, respuesta, reaccion: REACCION_DIFICULTAD[dificultad] } : null;
}

// ── Enviar bienvenida con plantilla Meta ────────────────────────────────────
async function enviarBienvenida(clientId, phone) {
  const client = db.getById(clientId);
  if (!client) return;
  const nombre = nombreDe(client, phone);

  try {
    const templateName = configuredWelcomeValue(WELCOME_TEMPLATE_NAME, "META_WELCOME_TEMPLATE_NAME", "el nombre técnico real");
    const languageCode = configuredWelcomeValue(WELCOME_TEMPLATE_LANGUAGE, "META_WELCOME_TEMPLATE_LANGUAGE", "el idioma");
    console.log("Plantilla de bienvenida seleccionada", JSON.stringify({ name: templateName, languageCode, phone }));
    console.log("Template enviado a Meta", JSON.stringify({ name: templateName, languageCode }));
    await enviarPlantillaOficial(phone, templateName, languageCode, "Bienvenida", nombre);
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
    console.error(`Error real al enviar bienvenida a +${phone}:`, e.message);
    throw e;
  }
}

// ── Enviar meta ───────────────────────────────────────────────────────────────
async function enviarMeta(clientId, meta, options = {}) {
  const client = db.getById(clientId);
  if (!client) return;
  const utilityTemplateId = Object.prototype.hasOwnProperty.call(options, "utilityTemplateId")
    ? utilityTemplates.validateId(options.utilityTemplateId)
    : utilityTemplates.validateId(meta.utilityTemplateId);
  const utilityTemplate = utilityTemplates.get(utilityTemplateId);

  for (const phone of client.phones) {
    const nombre = nombreDe(client, phone);
    let utilityTemplateSent = false;
    let contentStarted = false;
    let mainMessageId = "";

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
    try {
      if (utilityTemplate) {
        const templateResult = await enviarPlantillaUtilidad(phone, utilityTemplate, nombre);
        utilityTemplateSent = true;
        history.registrar(clientId, phone, nombre, {
          tipo: "plantilla_previa_enviada",
          meta: utilityTemplate.label,
          metaEmoji: "📨",
          direccion: "saliente",
          utilityTemplateId,
          utilityTemplateLabel: utilityTemplate.label,
          metaMessageId: templateResult.messageId,
          deliveryStatus: "accepted",
        });
      }
      console.log("Continuando con envío de contenido principal");
      console.log("Enviando meta", JSON.stringify({ clientId, phone, goalId: meta.id, titulo: meta.titulo }));
      contentStarted = true;
      const textResult = await enviar(phone, texto, nombre, { throwOnError: true, context: "meta" });
      mainMessageId = textResult.messageId;
      const buttonResult = await enviarBotones(phone, msg.get("pedir_listo"), botones, { throwOnError: true, context: "botones de meta" });
      state.set(phone, { flow: state.FLOW.META_ENVIADA, clientId, meta });
      history.registrar(clientId, phone, nombre, {
        tipo: "meta_enviada",
        meta: meta.titulo,
        goalId: meta.id,
        metaEmoji: meta.emoji,
        direccion: "saliente",
        utilityTemplateId,
        utilityTemplateLabel: utilityTemplate?.label || "",
        metaMessageId: textResult.messageId,
        interactionMessageId: buttonResult.messageId,
        deliveryStatus: "accepted",
      });
      console.log("Meta enviada correctamente", JSON.stringify({ clientId, phone, goalId: meta.id, metaMessageId: textResult.messageId, interactionMessageId: buttonResult.messageId }));
    } catch (e) {
      const templateFailed = utilityTemplate && !utilityTemplateSent && !contentStarted;
      const detail = templateFailed
        ? `Error al enviar plantilla previa: ${e.message}`
        : utilityTemplateSent
          ? `Plantilla previa enviada correctamente, pero falló el envío de la meta: ${e.message}`
          : `Error al enviar meta: ${e.message}`;
      console.error(templateFailed ? "Error al enviar plantilla previa" : "Error al enviar contenido principal", detail);
      history.registrar(clientId, phone, nombre, {
        tipo: templateFailed ? "plantilla_previa_error" : "meta_error",
        meta: templateFailed ? utilityTemplate.label : meta.titulo,
        goalId: meta.id,
        metaEmoji: templateFailed ? "📨" : meta.emoji,
        comentario: detail,
        direccion: "saliente",
        utilityTemplateId,
        utilityTemplateLabel: utilityTemplate?.label || "",
        metaMessageId: mainMessageId,
      });
      throw new Error(detail);
    }
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
  // Los mensajes de media pueden traer un comentario en caption.
  if (!text) text = m.image?.caption || m.video?.caption || m.document?.caption || m.caption?.body || "";
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
      goalId: s.meta?.id || "",
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
        goalId: meta?.id || "",
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
    const be = msg.get("botones_estrellas") || ["Mal","Normal","Muy bien"];
    const emocional = detectarEstadoEmocional(incoming, be);

    if (emocional) {
      const requiereRevision = emocional.estado === "negativo";
      console.log("Respuesta emocional recibida", JSON.stringify({ phone, meta: s.meta?.titulo, respuesta: emocional.respuesta }));
      console.log("Estado emocional detectado", emocional.estado);
      console.log("Enviando reacción emocional", JSON.stringify({ phone, reaccion: emocional.reaccion }));
      await enviar(phone, emocional.reaccion, nombre, { throwOnError: true, context: "reacción emocional" });
      const seguimiento = history.registrar(client.id, phone, nombre, {
        tipo: "seguimiento_meta",
        meta: s.meta?.titulo,
        goalId: s.meta?.id || "",
        metaEmoji: s.meta?.emoji,
        respuestaEmocional: emocional.respuesta,
        estadoEmocional: emocional.estado,
        reaccionEmocional: emocional.reaccion,
        requiereRevision,
        seguimientoEstado: "pendiente_dificultad",
        direccion: "saliente",
      });
      if (requiereRevision) console.log("Meta marcada para revisión posterior", JSON.stringify({ phone, meta: s.meta?.titulo, motivo: "respuesta emocional negativa" }));
      state.set(phone, {
        flow: state.FLOW.ESPERANDO_DIFICULTAD,
        estrellasN: emocional.n,
        estadoEmocional: emocional.estado,
        seguimientoHistoryId: seguimiento.id,
        requiereRevision,
      });
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
    const bd = msg.get("botones_dificultad") || ["Fácil","Normal","Difícil"];
    const dificultad = detectarDificultad(incoming, bd);

    if (dificultad) {
      const requiereRevision = !!s.requiereRevision || dificultad.dificultad === "Difícil";
      console.log("Respuesta de dificultad recibida", JSON.stringify({ phone, meta: s.meta?.titulo, respuesta: dificultad.respuesta }));
      console.log("Dificultad detectada", dificultad.dificultad);
      console.log("Enviando reacción según dificultad", JSON.stringify({ phone, reaccion: dificultad.reaccion }));
      await enviar(phone, dificultad.reaccion, nombre, { throwOnError: true, context: "reacción según dificultad" });
      if (s.seguimientoHistoryId) {
        history.updateById(client.id, s.seguimientoHistoryId, {
          respuestaDificultad: dificultad.respuesta,
          dificultad: dificultad.dificultad,
          reaccionDificultad: dificultad.reaccion,
          requiereRevision,
          seguimientoEstado: "completo",
          completadoAt: new Date().toISOString(),
        });
      } else {
        history.registrar(client.id, phone, nombre, {
          tipo: "seguimiento_meta",
          meta: s.meta?.titulo,
          goalId: s.meta?.id || "",
          metaEmoji: s.meta?.emoji,
          respuestaDificultad: dificultad.respuesta,
          dificultad: dificultad.dificultad,
          reaccionDificultad: dificultad.reaccion,
          requiereRevision,
          seguimientoEstado: "completo",
          direccion: "saliente",
        });
      }
      if (requiereRevision) console.log("Meta marcada para revisión posterior", JSON.stringify({ phone, meta: s.meta?.titulo, motivo: dificultad.dificultad === "Difícil" ? "dificultad alta" : "respuesta emocional negativa" }));
      const resultado = points.sumar(client.id, phone, client.phones.length);
      state.set(phone, { flow: state.FLOW.ESPERANDO_COMENTARIO });

      const aiMsg = await respuestaIA(nombre,
        `${nombre} completó su meta "${s.meta?.titulo}". Se sintió ${estrellas(s.estrellasN ?? 3)} y fue ${dificultad.dificultad}. Celébralo en 2 oraciones.`
      );

      const progreso = calcularProgresoMeta(client, phone, s.meta);
      const resumenPts = resumenProgresoPaciente(progreso);
      let msgFinal = msg.get("meta_completada")
        .replace("{ia}", aiMsg)
        .replace("{resumen}", resumenPts);

      history.registrar(client.id, phone, nombre, {
        tipo: "completada",
        meta: s.meta?.titulo,
        goalId: s.meta?.id || "",
        metaEmoji: s.meta?.emoji,
        estrellas: s.estrellasN,
        dificultad: dificultad.dificultad,
        estadoEmocional: s.estadoEmocional,
        requiereRevision,
        puntos: 10,
        puntosAcumulados: progreso.puntosAcumulados,
        puntosPosibles: progreso.puntosPosibles,
        metasCompletadas: progreso.completadas,
        totalMetas: progreso.totalMetas,
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
    const comentario = ["omitir","skip","no","nada"].includes(txt) ? null : incoming.raw;
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
  const progreso = calcularProgresoMeta(client, phone);
  await enviar(phone,
    `¡Hola ${nombre}! 👋 Soy NutriGO 🌱\n\n✅ *Metas completadas: ${progreso.completadas}/${progreso.totalMetas}*\n🏆 *Puntaje acumulado: ${progreso.puntosAcumulados}/${progreso.puntosPosibles} puntos*\n\n¡Sigue avanzando paso a paso! 💚`
  );
}

module.exports = { enviarMeta, enviarBienvenida, procesarMensaje, detectarEstadoEmocional, detectarDificultad, calcularProgresoMeta, resumenProgresoPaciente };
