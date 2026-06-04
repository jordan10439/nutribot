const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/history.json');

function readHistory() {
  if (!fs.existsSync(FILE)) return null;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function timestampValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractHistoryEventFields(clientId, event) {
  const occurredAt = timestampValue(event.fecha || event.createdAt || event.updatedAt);
  return {
    eventId: event.id,
    clientId,
    phone: event.phone || null,
    nombre: event.nombre || null,
    eventType: event.tipo || null,
    direction: event.direccion || null,
    goalId: event.goalId || event.metaId || event.payload?.goalId || null,
    sendId: event.sendId || event.payload?.sendId || null,
    pendingContentId: event.pendingContentId || event.payload?.pendingContentId || null,
    metaMessageId: event.metaMessageId || event.messageId || null,
    interactionMessageId: event.interactionMessageId || null,
    title: event.meta || event.title || event.tipTitle || null,
    emoji: event.metaEmoji || event.emoji || null,
    comment: event.comentario || event.comment || event.error || null,
    deliveryStatus: event.deliveryStatus || null,
    deliveryStage: event.deliveryStage || null,
    requiresReview: !!(event.requiresReview || event.requiereRevision),
    media: event.media || null,
    occurredAt,
    createdAt: timestampValue(event.createdAt) || occurredAt,
    updatedAt: timestampValue(event.updatedAt) || occurredAt || new Date().toISOString(),
    data: event,
  };
}

async function upsertHistoryEvent(fields) {
  await pool.query(`
    INSERT INTO history_events (
      event_id,
      client_id,
      phone,
      nombre,
      event_type,
      direction,
      goal_id,
      send_id,
      pending_content_id,
      meta_message_id,
      interaction_message_id,
      title,
      emoji,
      comment,
      delivery_status,
      delivery_stage,
      requires_review,
      media,
      occurred_at,
      created_at,
      updated_at,
      data
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18::jsonb, $19, $20, $21, $22::jsonb
    )
    ON CONFLICT (event_id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      phone = EXCLUDED.phone,
      nombre = EXCLUDED.nombre,
      event_type = EXCLUDED.event_type,
      direction = EXCLUDED.direction,
      goal_id = EXCLUDED.goal_id,
      send_id = EXCLUDED.send_id,
      pending_content_id = EXCLUDED.pending_content_id,
      meta_message_id = EXCLUDED.meta_message_id,
      interaction_message_id = EXCLUDED.interaction_message_id,
      title = EXCLUDED.title,
      emoji = EXCLUDED.emoji,
      comment = EXCLUDED.comment,
      delivery_status = EXCLUDED.delivery_status,
      delivery_stage = EXCLUDED.delivery_stage,
      requires_review = EXCLUDED.requires_review,
      media = EXCLUDED.media,
      occurred_at = EXCLUDED.occurred_at,
      created_at = COALESCE(history_events.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    fields.eventId,
    fields.clientId,
    fields.phone,
    fields.nombre,
    fields.eventType,
    fields.direction,
    fields.goalId,
    fields.sendId,
    fields.pendingContentId,
    fields.metaMessageId,
    fields.interactionMessageId,
    fields.title,
    fields.emoji,
    fields.comment,
    fields.deliveryStatus,
    fields.deliveryStage,
    fields.requiresReview,
    JSON.stringify(fields.media),
    fields.occurredAt,
    fields.createdAt,
    fields.updatedAt,
    JSON.stringify(fields.data),
  ]);
}

async function importHistoryFromJson() {
  const data = readHistory();
  const warnings = [];
  let clientsReviewed = 0;
  let eventsFound = 0;
  let imported = 0;

  if (!data) {
    console.log('ℹ️ data/history.json no existe; no hay historial para importar.');
    await pool.end();
    return;
  }

  try {
    for (const [clientId, events] of Object.entries(data)) {
      if (!clientId) {
        warnings.push({ issue: 'sin clientId' });
        continue;
      }
      clientsReviewed += 1;
      const list = Array.isArray(events) ? events : [];
      for (const event of list) {
        eventsFound += 1;
        if (!event?.id) {
          warnings.push({ clientId, type: event?.tipo || '', issue: 'evento sin id' });
          continue;
        }
        const fields = extractHistoryEventFields(clientId, event);
        if (!fields.occurredAt) warnings.push({ clientId, eventId: event.id, issue: 'evento sin fecha' });
        await upsertHistoryEvent(fields);
        imported += 1;
      }
    }

    console.log('✅ Historial importado/actualizado correctamente');
    console.log(`Clientes revisados: ${clientsReviewed}`);
    console.log(`Eventos encontrados: ${eventsFound}`);
    console.log(`Eventos importados/actualizados: ${imported}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de historial incompleto.');
    }
  } catch (error) {
    console.error('❌ Error importando historial desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importHistoryFromJson();
