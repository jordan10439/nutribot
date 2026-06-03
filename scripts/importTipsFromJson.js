const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/tips.json');

function readTipsData() {
  if (!fs.existsSync(FILE)) return { tips: [], folders: [], sends: [] };
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return {
    tips: Array.isArray(data.tips) ? data.tips : [],
    folders: Array.isArray(data.folders) ? data.folders : [],
    sends: Array.isArray(data.sends) ? data.sends : [],
  };
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function upsertFolder(folder) {
  await pool.query(`
    INSERT INTO tip_folders (
      folder_id,
      name,
      type,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    ON CONFLICT (folder_id) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      created_at = COALESCE(tip_folders.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    folder.id,
    folder.name || null,
    folder.type || null,
    parseTimestamp(folder.createdAt),
    parseTimestamp(folder.updatedAt) || parseTimestamp(folder.createdAt) || new Date().toISOString(),
    JSON.stringify(folder),
  ]);
}

async function upsertTip(tip) {
  await pool.query(`
    INSERT INTO tip_library (
      tip_id,
      request_id,
      type,
      title,
      description,
      phrase,
      filename,
      folder_id,
      fingerprint,
      created_at,
      updated_at,
      data
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
    ON CONFLICT (tip_id) DO UPDATE SET
      request_id = EXCLUDED.request_id,
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      phrase = EXCLUDED.phrase,
      filename = EXCLUDED.filename,
      folder_id = EXCLUDED.folder_id,
      fingerprint = EXCLUDED.fingerprint,
      created_at = COALESCE(tip_library.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    tip.id,
    tip.requestId || null,
    tip.type || null,
    tip.title || null,
    tip.desc || null,
    tip.phrase || null,
    tip.filename || null,
    tip.folderId || null,
    tip.fingerprint || null,
    parseTimestamp(tip.createdAt),
    parseTimestamp(tip.updatedAt) || parseTimestamp(tip.createdAt) || new Date().toISOString(),
    JSON.stringify(tip),
  ]);
}

async function upsertSend(send) {
  await pool.query(`
    INSERT INTO tip_sends (
      send_id,
      tip_id,
      client_id,
      phone,
      patient_name,
      recipient_role,
      message,
      utility_template_id,
      scheduled_at,
      status,
      error,
      sent_at,
      cancelled_at,
      reviewed_at,
      hidden,
      delivery_status,
      utility_template_message_id,
      meta_message_id,
      text_message_id,
      pending_content_id,
      created_at,
      updated_at,
      data
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22, $23::jsonb
    )
    ON CONFLICT (send_id) DO UPDATE SET
      tip_id = EXCLUDED.tip_id,
      client_id = EXCLUDED.client_id,
      phone = EXCLUDED.phone,
      patient_name = EXCLUDED.patient_name,
      recipient_role = EXCLUDED.recipient_role,
      message = EXCLUDED.message,
      utility_template_id = EXCLUDED.utility_template_id,
      scheduled_at = EXCLUDED.scheduled_at,
      status = EXCLUDED.status,
      error = EXCLUDED.error,
      sent_at = EXCLUDED.sent_at,
      cancelled_at = EXCLUDED.cancelled_at,
      reviewed_at = EXCLUDED.reviewed_at,
      hidden = EXCLUDED.hidden,
      delivery_status = EXCLUDED.delivery_status,
      utility_template_message_id = EXCLUDED.utility_template_message_id,
      meta_message_id = EXCLUDED.meta_message_id,
      text_message_id = EXCLUDED.text_message_id,
      pending_content_id = EXCLUDED.pending_content_id,
      created_at = COALESCE(tip_sends.created_at, EXCLUDED.created_at),
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data
  `, [
    send.id,
    send.tipId || null,
    send.clientId || null,
    send.phone || null,
    send.patientName || null,
    send.recipientRole || null,
    send.message || null,
    send.utilityTemplateId || null,
    parseTimestamp(send.scheduledAt),
    send.status || null,
    send.error || null,
    parseTimestamp(send.sentAt),
    parseTimestamp(send.cancelledAt),
    parseTimestamp(send.reviewedAt),
    !!send.hidden,
    send.deliveryStatus || null,
    send.utilityTemplateMessageId || null,
    send.metaMessageId || null,
    send.textMessageId || null,
    send.pendingContentId || null,
    parseTimestamp(send.createdAt),
    parseTimestamp(send.updatedAt) || parseTimestamp(send.createdAt) || new Date().toISOString(),
    JSON.stringify(send),
  ]);
}

async function importTipsFromJson() {
  const data = readTipsData();
  const warnings = [];
  let foldersImported = 0;
  let tipsImported = 0;
  let sendsImported = 0;

  try {
    for (const folder of data.folders) {
      if (!folder?.id) {
        warnings.push({ type: 'folder', name: folder?.name || '(sin nombre)', issue: 'sin id' });
        continue;
      }
      await upsertFolder(folder);
      foldersImported += 1;
    }

    for (const tip of data.tips) {
      if (!tip?.id) {
        warnings.push({ type: 'tip', title: tip?.title || '(sin título)', issue: 'sin id' });
        continue;
      }
      if (!tip.title) warnings.push({ type: 'tip', id: tip.id, issue: 'sin título' });
      await upsertTip(tip);
      tipsImported += 1;
    }

    for (const send of data.sends) {
      if (!send?.id) {
        warnings.push({ type: 'send', tipId: send?.tipId || '', issue: 'sin id' });
        continue;
      }
      if (!send.tipId) warnings.push({ type: 'send', id: send.id, issue: 'sin tipId' });
      if (!send.clientId) warnings.push({ type: 'send', id: send.id, issue: 'sin clientId' });
      if (!send.phone) warnings.push({ type: 'send', id: send.id, issue: 'sin phone' });
      await upsertSend(send);
      sendsImported += 1;
    }

    console.log('✅ Tips importados/actualizados correctamente');
    console.log(`Folders encontrados: ${data.folders.length}`);
    console.log(`Folders importados/actualizados: ${foldersImported}`);
    console.log(`Tips encontrados: ${data.tips.length}`);
    console.log(`Tips importados/actualizados: ${tipsImported}`);
    console.log(`Sends encontrados: ${data.sends.length}`);
    console.log(`Sends importados/actualizados: ${sendsImported}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de tips incompletos.');
    }
  } catch (error) {
    console.error('❌ Error importando tips desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importTipsFromJson();
