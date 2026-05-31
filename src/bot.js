// src/bot.js
const db      = require("./db");
const state   = require("./state");
const { enviar, enviarBotones, enviarPlantillaOficial, enviarPlantillaUtilidad } = require("./whatsapp");
const { respuestaIA } = require("./ai");
const points  = require("./points");
const history = require("./history");
const msg     = require("./messages");
const utilityTemplates = require("./utilityTemplates");
const { explainMetaError } = require("./metaErrors");

const WELCOME_TEMPLATE_WITH_BUTTON_NAME = process.env.META_WELCOME_TEMPLATE_WITH_BUTTON_NAME || process.env.META_WELCOME_TEMPLATE_NAME || process.env.META_TEMPLATE_NAME || "";
const WELCOME_TEMPLATE_WITH_BUTTON_LANGUAGE = process.env.META_WELCOME_TEMPLATE_WITH_BUTTON_LANGUAGE || process.env.META_WELCOME_TEMPLATE_LANGUAGE || "";
const WELCOME_TEMPLATE_WITHOUT_BUTTON_NAME = process.env.META_WELCOME_TEMPLATE_WITHOUT_BUTTON_NAME || "";
const WELCOME_TEMPLATE_WITHOUT_BUTTON_LANGUAGE = process.env.META_WELCOME_TEMPLATE_WITHOUT_BUTTON_LANGUAGE || "";

function configuredWelcomeValue(value, variable, field) {
  const clean = String(value || "").trim();
  const placeholder = /placeholder|ejemplo|example|cambiar|configurar|nombre[_ -]?real/i.test(clean);
  if (!clean || placeholder) {
    throw new Error(`Falta configurar ${field} de la plantilla de bienvenida aprobada en Meta (${variable})`);
  }
  return clean;
}

function welcomeTemplateConfig(type = "with_button") {
  const cleanType = type === "without_button" ? "without_button" : "with_button";
  if (cleanType === "without_button") {
    return {
      type: cleanType,
      label: "Bienvenida sin botón",
      name: configuredWelcomeValue(WELCOME_TEMPLATE_WITHOUT_BUTTON_NAME, "META_WELCOME_TEMPLATE_WITHOUT_BUTTON_NAME", "el nombre técnico real de la plantilla de bienvenida sin botón"),
      languageCode: configuredWelcomeValue(WELCOME_TEMPLATE_WITHOUT_BUTTON_LANGUAGE, "META_WELCOME_TEMPLATE_WITHOUT_BUTTON_LANGUAGE", "el idioma de la plantilla de bienvenida sin botón"),
    };
  }
  return {
    type: cleanType,
    label: "Bienvenida con botón",
    name: configuredWelcomeValue(WELCOME_TEMPLATE_WITH_BUTTON_NAME, "META_WELCOME_TEMPLATE_WITH_BUTTON_NAME o META_WELCOME_TEMPLATE_NAME", "el nombre técnico real de la plantilla de bienvenida con botón"),
    languageCode: configuredWelcomeValue(WELCOME_TEMPLATE_WITH_BUTTON_LANGUAGE, "META_WELCOME_TEMPLATE_WITH_BUTTON_LANGUAGE o META_WELCOME_TEMPLATE_LANGUAGE", "el idioma de la plantilla de bienvenida con botón"),
  };
}

function welcomeTemplateOptions() {
  const options = [];
  for (const type of ["with_button", "without_button"]) {
    try {
      const config = welcomeTemplateConfig(type);
      options.push({
        type: config.type,
        label: config.label,
        templateName: config.name,
        languageCode: config.languageCode,
      });
    } catch (e) {
      console.log("Plantilla de bienvenida no disponible", JSON.stringify({ type, error: e.message }));
    }
  }
  return options;
}

function findClientByPhone(phone) {
  return db.getAll().find(c => c.phones.includes(phone));
}
function nombreDe(client, phone) {
  return client.nombres[client.phones.indexOf(phone)] ?? "Amig@";
}
function esIndividual(client) { return client.phones.length === 1; }
function estrellas(n) { return "⭐".repeat(n) + "☆".repeat(5 - n); }

function isMetaFlowReply(value) {
  return /^(meta_|estrellas_|dificultad_)/i.test(String(value || "").trim());
}

function utilityTemplateButtonText(value) {
  const clean = String(value || "").trim();
  const normalized = clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const labels = {
    "ver seguimiento": "Ver seguimiento",
    "ver mensaje": "Ver mensaje",
    "ver recomendacion": "Ver recomendación",
    "ver recordatorio": "Ver recordatorio",
  };
  return labels[normalized] || "";
}

function isUtilityTemplateButtonInteraction(value) {
  return /^Paciente tocó:/i.test(String(value || "")) || !!utilityTemplateButtonText(value);
}

function formatMetaTitle(meta) {
  const emoji = String(meta?.emoji || "").trim();
  const title = String(meta?.titulo || "Meta").trim();
  return `${emoji ? `${emoji} ` : ""}*${title}*`;
}

function formatMetaMessage(nombre, meta) {
  const description = String(meta?.descripcion || meta?.titulo || "").trim();
  const emoji = String(meta?.emoji || "").trim();
  const title = String(meta?.titulo || "Meta").trim();
  const titleLine = `${emoji ? `${emoji} ` : ""}*${title}*`;
  const lines = ["✨*¡Nueva meta!*✨", "", titleLine];
  if (description) lines.push("", description);
  return lines.join("\n");
}

function metaRecipients(client) {
  const seen = new Set();
  return (client.phones || []).map((phone, index) => ({
    phone,
    nombre: client.nombres?.[index] || client.nombres?.[0] || "Paciente",
    role: index === 0 ? "paciente principal" : "pareja",
  })).filter(recipient => {
    if (!recipient.phone || seen.has(recipient.phone)) return false;
    seen.add(recipient.phone);
    return true;
  });
}

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
async function enviarBienvenida(clientId, phone, templateType = "with_button") {
  const client = db.getById(clientId);
  if (!client) return;
  const nombre = nombreDe(client, phone);

  try {
    const config = welcomeTemplateConfig(templateType);
    const templateName = config.name;
    const languageCode = config.languageCode;
    console.log("Plantilla de bienvenida seleccionada", JSON.stringify({ type: config.type, label: config.label, name: templateName, languageCode, phone }));
    console.log("Template enviado a Meta", JSON.stringify({ name: templateName, languageCode }));
    await enviarPlantillaOficial(phone, templateName, languageCode, config.label, nombre);
    console.log(`✅ Bienvenida enviada a +${phone}`);

    history.registrar(clientId, phone, nombre, {
      tipo: "bienvenida_enviada",
      meta: config.label,
      metaEmoji: "👋",
      direccion: "saliente",
      templateName,
      templateLanguage: languageCode,
      templateType: config.type,
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

  const recipients = metaRecipients(client);
  const results = [];
  console.log("Destinatarios finales del envío", JSON.stringify({ clientId, metaId: meta.id, recipients: recipients.map(r => ({ phone: r.phone, nombre: r.nombre, role: r.role })) }));
  console.log("Cantidad de destinatarios", recipients.length);

  for (const [index, recipient] of recipients.entries()) {
    const { phone, nombre, role } = recipient;
    let utilityTemplateSent = false;
    let utilityTemplateMessageId = "";
    let contentStarted = false;
    let mainMessageId = "";
    let interactionMessageId = "";
    const trace = { clientId, role, nombre, phone, goalId: meta.id, meta: meta.titulo, destinatarioIndex: index + 1, totalDestinatarios: recipients.length };

    const texto = formatMetaMessage(nombre, meta);

    // Enviar la pregunta con botones Sí / No
    const botones = [
      { id: `meta_si`, title: "Sí, la cumplí" },
      { id: `meta_no`, title: "Aún no" }
    ];
    try {
      console.log(`Procesando destinatario ${index + 1}`, JSON.stringify({ total: recipients.length, clientId, phone, nombre, role, meta: meta.titulo }));
      console.log("Destinatario actual del loop", JSON.stringify(trace));
      console.log("Nombre destinatario", nombre);
      console.log("Phone destinatario", phone);
      console.log("ClientId destinatario", clientId);
      console.log("Role destinatario", role);
      console.log(role === "pareja" ? "Enviando a pareja" : "Enviando a paciente principal", JSON.stringify({ clientId, phone, nombre, meta: meta.titulo }));
      if (utilityTemplate) {
        console.log(`Enviando plantilla previa a ${nombre}/${phone}`, JSON.stringify({ role, utilityTemplateId, utilityTemplateLabel: utilityTemplate.label }));
        const templateResult = await enviarPlantillaUtilidad(phone, utilityTemplate, nombre, { trace });
        utilityTemplateSent = true;
        utilityTemplateMessageId = templateResult.messageId;
        console.log("Resultado plantilla previa destinatario", JSON.stringify({ phone, nombre, role, ok: true, messageId: templateResult.messageId }));
        history.registrar(clientId, phone, nombre, {
          tipo: "plantilla_previa_enviada",
          meta: utilityTemplate.label,
          metaEmoji: "📨",
          direccion: "saliente",
          utilityTemplateId,
          utilityTemplateLabel: utilityTemplate.label,
          metaMessageId: templateResult.messageId,
          deliveryStatus: "accepted",
          deliveryStage: "plantilla_previa",
        });
      }
      console.log("Continuando con envío de contenido principal");
      console.log(`Enviando contenido principal a ${nombre}/${phone}`, JSON.stringify({ role, tipo: "meta", meta: meta.titulo }));
      console.log("Enviando meta", JSON.stringify({ clientId, phone, goalId: meta.id, titulo: meta.titulo }));
      contentStarted = true;
      const textResult = await enviar(phone, texto, nombre, { throwOnError: true, context: "meta", trace });
      mainMessageId = textResult.messageId;
      const buttonResult = await enviarBotones(phone, msg.get("pedir_listo"), botones, { throwOnError: true, context: "botones de meta", trace });
      interactionMessageId = buttonResult.messageId;
      console.log("Resultado contenido principal destinatario", JSON.stringify({ phone, nombre, role, ok: true, metaMessageId: textResult.messageId, interactionMessageId: buttonResult.messageId }));
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
        deliveryStage: "contenido_principal",
      });
      console.log("Meta enviada correctamente", JSON.stringify({ clientId, phone, goalId: meta.id, metaMessageId: textResult.messageId, interactionMessageId: buttonResult.messageId }));
      console.log(role === "pareja" ? "Resultado envío pareja" : "Resultado envío paciente principal", JSON.stringify({ phone, ok: true, meta: meta.titulo }));
      const individualResult = { nombre, phone, clientId, role, plantillaPrevia: utilityTemplate ? "enviada" : "no seleccionada", contenidoPrincipal: "enviado", messageId: textResult.messageId, interactionMessageId: buttonResult.messageId, templateMessageId: utilityTemplateMessageId, ok: true };
      console.log("Resultado final individual", JSON.stringify(individualResult));
      results.push(individualResult);
    } catch (e) {
      const realError = explainMetaError(e.message);
      const templateFailed = utilityTemplate && !utilityTemplateSent && !contentStarted;
      const detail = templateFailed
        ? `Error al enviar plantilla previa: ${realError}`
        : utilityTemplateSent
          ? `Plantilla previa enviada correctamente, pero falló el envío de la meta: ${realError}`
          : `Error al enviar meta: ${realError}`;
      if (templateFailed) {
        console.error("Resultado plantilla previa destinatario", JSON.stringify({ phone, nombre, role, ok: false, error: detail }));
      } else {
        console.error("Resultado contenido principal destinatario", JSON.stringify({ phone, nombre, role, ok: false, error: detail, plantillaPreviaEnviada: utilityTemplateSent }));
      }
      console.error("Error individual de destinatario", JSON.stringify({ clientId, phone, nombre, role, error: detail }));
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
        deliveryStage: templateFailed ? "plantilla_previa" : "contenido_principal",
        templateWasSent: utilityTemplateSent,
      });
      console.log("Continuando con siguiente destinatario", JSON.stringify({ clientId, phone, meta: meta.titulo }));
      const individualResult = { nombre, phone, clientId, role, plantillaPrevia: utilityTemplate ? (utilityTemplateSent ? "enviada" : "error") : "no seleccionada", contenidoPrincipal: contentStarted ? "error" : "no intentado", messageId: mainMessageId, interactionMessageId, templateMessageId: utilityTemplateMessageId, ok: false, error: detail };
      console.log("Resultado final individual", JSON.stringify(individualResult));
      results.push(individualResult);
    }
  }
  const summary = {
    meta: meta.titulo,
    total: results.length,
    ok: results.filter(r => r.ok).length,
    error: results.filter(r => !r.ok).length,
  };
  console.log("Resumen final de envío a pareja", JSON.stringify({ clientId, ...summary, results }));
  if (!results.some(r => r.ok)) {
    const message = results.map(r => `${r.nombre}: ${r.error}`).join(" | ") || `No se pudo enviar la meta "${meta.titulo}"`;
    throw new Error(message);
  }
  console.log(`📤 Meta "${meta.titulo}" enviada/procesada para ${client.nombres.join(" & ")}`);
  return { ok: results.every(r => r.ok), partial: results.some(r => r.ok) && results.some(r => !r.ok), results };
}

// ── Procesar mensajes entrantes ───────────────────────────────────────────────
async function getIncomingText(m) {
  // Extract text from various WhatsApp message shapes
  const type = m.type;
  let text = "";
  if (type === 'text') text = m.text?.body || "";
  else if (type === 'button') {
    const payload = m.button?.payload || "";
    const title = m.button?.text || "";
    text = isMetaFlowReply(payload) ? payload : (utilityTemplateButtonText(title || payload) ? `Paciente tocó: ${utilityTemplateButtonText(title || payload)}` : (title || payload));
  }
  else if (type === 'interactive') {
    if (m.interactive?.type === 'button_reply') {
      const id = m.interactive.button_reply?.id || "";
      const title = m.interactive.button_reply?.title || "";
      text = isMetaFlowReply(id) ? id : (utilityTemplateButtonText(title || id) ? `Paciente tocó: ${utilityTemplateButtonText(title || id)}` : (title || id));
    }
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
      meta: isUtilityTemplateButtonInteraction(incoming.raw) ? "Interacción con plantilla previa" : (s.meta?.titulo ?? "—"),
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

  if (isUtilityTemplateButtonInteraction(incoming.raw)) {
    console.log("Interacción de botón de plantilla previa registrada", JSON.stringify({ phone, text: incoming.raw }));
    return;
  }

  const nombre = nombreDe(client, phone);
  const solo   = esIndividual(client);
  console.log('[bot] Incoming:', { phone, tipoMsg, raw: incoming.raw, txt, state: s.flow });

  // ── Esperando LISTO ──────────────────────────────────────────────────────
  if (s.flow === state.FLOW.META_ENVIADA) {
    // Accept button replies (meta_si / meta_no) or free-text yes/no
    if (incoming.raw === 'meta_si' || /^(si|sí|s|yes|y|si,?\s*la\s*cumpli|sí,?\s*la\s*cumplí|la\s*cumpli|la\s*cumplí)$/i.test(incoming.raw)) {
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
    } else if (incoming.raw === 'meta_no' || /^(no|n|nah|not|aun\s*no|aún\s*no)$/i.test(incoming.raw)) {
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
      await enviarBotones(phone, msg.get("pedir_listo"), [{ id: 'meta_si', title: 'Sí, la cumplí' }, { id: 'meta_no', title: 'Aún no' }]);
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

module.exports = { enviarMeta, enviarBienvenida, welcomeTemplateOptions, procesarMensaje, detectarEstadoEmocional, detectarDificultad, calcularProgresoMeta, resumenProgresoPaciente };
