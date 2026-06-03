// src/db.js
const { Pool } = require('pg');
require('dotenv').config();

const crypto = require("crypto");
const fs   = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "../data/db.json");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const HAS_DATABASE_URL = Boolean(DATABASE_URL);
console.log("DATABASE_URL configurada:", HAS_DATABASE_URL);
if (!HAS_DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL no está configurada. PostgreSQL no se cargará.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

let clientsCache = null;

function load() {
  try {
    if (!fs.existsSync(FILE)) return { clients: [] };
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch { return { clients: [] }; }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function loadJsonClients() {
  return sortClientsNewestFirst(load().clients || []);
}

function saveClientsBackup(clients) {
  save({ clients: sortClientsNewestFirst(clients || []) });
}

function displayNameFor(client) {
  return client?.displayName || (client?.nombres || []).filter(Boolean).join(" & ") || client?.name || client?.nombre || "";
}

function typeFor(client) {
  return client?.type || client?.tipo || ((client?.phones || []).length > 1 ? "couple" : "individual");
}

function membersFor(client, type = typeFor(client)) {
  if (Array.isArray(client?.members) && client.members.length) return client.members;
  const nombres = Array.isArray(client?.nombres) ? client.nombres : [];
  const phones = Array.isArray(client?.phones) ? client.phones : [];
  return nombres.map((name, index) => ({
    name,
    phone: phones[index] || "",
    role: index === 0 ? "partner_1" : "partner_2",
    internalName: `${name || "Paciente"} · ${type === "couple" ? "En pareja" : "Individual"}`,
  }));
}

function normalizePatientRow(row) {
  return row?.data || {
    id: row.client_id,
    nombres: Array.isArray(row.nombres) ? row.nombres : [],
    phones: Array.isArray(row.phones) ? row.phones : [],
    type: row.type || "individual",
    displayName: row.display_name || row.name || "",
    internalName: row.internal_name || "",
    contextKey: row.context_key || "",
    members: Array.isArray(row.members) ? row.members : [],
    timezone: row.timezone || "America/Santiago",
    welcome: row.welcome || undefined,
    goals: Array.isArray(row.goals) ? row.goals : [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

async function loadPatientsFromPostgres() {
  if (!HAS_DATABASE_URL) {
    console.warn("⚠️ DATABASE_URL no está configurada. PostgreSQL no se cargará.");
    return [];
  }
  const result = await pool.query(`
    SELECT
      client_id,
      name,
      phone,
      display_name,
      internal_name,
      context_key,
      type,
      nombres,
      phones,
      members,
      timezone,
      welcome,
      goals,
      data,
      created_at,
      updated_at
    FROM patients
    WHERE client_id IS NOT NULL
    ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
  `);
  return result.rows.map(normalizePatientRow).filter(client => client?.id);
}

async function initPatientsFromPostgres() {
  if (!HAS_DATABASE_URL) {
    clientsCache = loadJsonClients();
    console.warn("⚠️ DATABASE_URL no está configurada. PostgreSQL no se cargará.");
    console.log("Pacientes cargados desde respaldo JSON", JSON.stringify({ count: clientsCache.length }));
    return clientsCache;
  }
  try {
    const patients = await loadPatientsFromPostgres();
    if (patients.length) {
      clientsCache = sortClientsNewestFirst(patients);
      saveClientsBackup(clientsCache);
      console.log("✅ Pacientes cargados desde PostgreSQL", JSON.stringify({ count: clientsCache.length }));
      console.log("✅ Respaldo JSON de pacientes sincronizado desde PostgreSQL");
      return clientsCache;
    }
    clientsCache = loadJsonClients();
    console.log("⚠️ PostgreSQL no tiene pacientes; usando respaldo JSON", JSON.stringify({ count: clientsCache.length }));
    return clientsCache;
  } catch (error) {
    clientsCache = loadJsonClients();
    console.error("⚠️ Error cargando pacientes desde PostgreSQL; usando respaldo JSON:", error.message);
    console.log("Pacientes cargados desde respaldo JSON", JSON.stringify({ count: clientsCache.length }));
    return clientsCache;
  }
}

async function syncPatientToPostgres(client) {
  if (!client?.id) return;
  if (!HAS_DATABASE_URL) {
    console.warn("⚠️ DATABASE_URL no está configurada. No se sincronizará paciente con PostgreSQL.", JSON.stringify({ clientId: client.id }));
    return;
  }
  const type = typeFor(client);
  const displayName = displayNameFor(client);
  const members = membersFor(client, type);
  const internalName = client.internalName || `${displayName || "Paciente"} · ${type === "couple" ? "Pareja" : "Individual"}`;
  const contextKey = client.contextKey || `${type}:${client.id}`;
  try {
    await pool.query(`
      INSERT INTO patients (
        client_id,
        name,
        phone,
        display_name,
        internal_name,
        context_key,
        type,
        nombres,
        phones,
        members,
        timezone,
        welcome,
        goals,
        data,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::jsonb, $9::jsonb, $10::jsonb,
        $11, $12::jsonb, $13::jsonb, $14::jsonb, NOW()
      )
      ON CONFLICT (client_id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        display_name = EXCLUDED.display_name,
        internal_name = EXCLUDED.internal_name,
        context_key = EXCLUDED.context_key,
        type = EXCLUDED.type,
        nombres = EXCLUDED.nombres,
        phones = EXCLUDED.phones,
        members = EXCLUDED.members,
        timezone = EXCLUDED.timezone,
        welcome = EXCLUDED.welcome,
        goals = EXCLUDED.goals,
        data = EXCLUDED.data,
        updated_at = NOW()
    `, [
      client.id,
      displayName || client.nombres?.[0] || "Paciente",
      client.phones?.[0] || null,
      displayName,
      internalName,
      contextKey,
      type,
      JSON.stringify(client.nombres || []),
      JSON.stringify(client.phones || []),
      JSON.stringify(members),
      client.timezone || "America/Santiago",
      JSON.stringify(client.welcome || null),
      JSON.stringify(client.goals || []),
      JSON.stringify(client),
    ]);
    console.log("✅ Paciente sincronizado con PostgreSQL", JSON.stringify({ clientId: client.id }));
  } catch (error) {
    console.error("⚠️ Error sincronizando paciente con PostgreSQL", JSON.stringify({ clientId: client.id, error: error.message }));
  }
}

function parseGoalTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stableGoalId(clientId, goal, index) {
  const existingId = String(goal?.id || goal?.goalId || "").trim();
  if (existingId) return existingId;
  const seed = JSON.stringify({
    clientId,
    index,
    title: goal?.titulo || goal?.title || "",
    description: goal?.descripcion || goal?.description || "",
    createdAt: goal?.createdAt || goal?.fechaCreacion || "",
    scheduledAt: goal?.scheduledAt || goal?.specificDate || goal?.fecha || "",
  });
  const hash = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
  return `goal_${index + 1}_${hash}`;
}

function goalScheduledAt(goal) {
  if (goal?.scheduledAt) return parseGoalTimestamp(goal.scheduledAt);
  const date = String(goal?.specificDate || goal?.fecha || "").slice(0, 10);
  const time = String(goal?.hora || "").slice(0, 5);
  if (!date || !time) return null;
  return parseGoalTimestamp(`${date}T${time}:00`);
}

async function upsertGoalToPostgres(clientId, goal, index) {
  const goalId = stableGoalId(clientId, goal, index);
  const title = String(goal?.titulo || goal?.title || goal?.nombre || "").trim();
  const description = String(goal?.descripcion || goal?.description || goal?.detalle || "").trim();
  const status = String(goal?.status || goal?.estado || goal?.state || "").trim() || "pendiente";
  console.log("[goals] intentando insertar goal_id", JSON.stringify({
    clientId,
    goalId,
    title,
    index,
  }));
  await pool.query(`
    INSERT INTO goals (
      client_id,
      goal_id,
      title,
      description,
      status,
      scheduled_at,
      sent_at,
      completed_at,
      data,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
    ON CONFLICT (client_id, goal_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      scheduled_at = EXCLUDED.scheduled_at,
      sent_at = EXCLUDED.sent_at,
      completed_at = EXCLUDED.completed_at,
      data = EXCLUDED.data,
      updated_at = NOW()
  `, [
    clientId,
    goalId,
    title || null,
    description || null,
    status,
    goalScheduledAt(goal),
    parseGoalTimestamp(goal?.sentAt || goal?.enviadaAt || goal?.lastSentAt),
    parseGoalTimestamp(goal?.completedAt || goal?.completadaAt),
    JSON.stringify(goal || {}),
  ]);
  console.log("[goals] meta sincronizada correctamente", JSON.stringify({ clientId, goalId, title }));
  return goalId;
}

async function syncGoalsToPostgres(client) {
  if (!client?.id) return;
  if (!HAS_DATABASE_URL) {
    console.warn("[goals] DATABASE_URL no está configurada. No se sincronizarán metas con PostgreSQL.", JSON.stringify({ clientId: client.id }));
    return;
  }
  const goals = Array.isArray(client.goals) ? client.goals : [];
  console.log("[goals] metas detectadas", JSON.stringify({ clientId: client.id, count: goals.length }));
  if (!goals.length) return;
  let synced = 0;
  for (let index = 0; index < goals.length; index += 1) {
    try {
      await upsertGoalToPostgres(client.id, goals[index], index);
      synced += 1;
    } catch (error) {
      console.warn("[goals] error sincronizando meta", JSON.stringify({
        clientId: client.id,
        goalId: stableGoalId(client.id, goals[index], index),
        error: error.message,
      }));
    }
  }
  console.log("[goals] sincronización espejo terminada", JSON.stringify({ clientId: client.id, detected: goals.length, synced }));
}

async function syncClientMirrorToPostgres(client) {
  await syncPatientToPostgres(client);
  await syncGoalsToPostgres(client);
}

async function deletePatientFromPostgres(id) {
  if (!HAS_DATABASE_URL) {
    console.warn("⚠️ DATABASE_URL no está configurada. No se eliminará paciente en PostgreSQL.", JSON.stringify({ clientId: id }));
    return;
  }
  try {
    await pool.query("DELETE FROM patients WHERE client_id = $1", [id]);
    console.log("✅ Paciente eliminado de PostgreSQL", JSON.stringify({ clientId: id }));
  } catch (error) {
    console.error("⚠️ Error eliminando paciente de PostgreSQL", JSON.stringify({ clientId: id, error: error.message }));
  }
}

function clientCreatedTime(client) {
  const explicit = new Date(client?.createdAt || client?.fechaRegistro || client?.registeredAt || 0).getTime();
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const idTime = Number(String(client?.id || "").match(/_(\d{10,})$/)?.[1] || 0);
  return Number.isFinite(idTime) ? idTime : 0;
}

function sortClientsNewestFirst(clients) {
  return [...(clients || [])].map((client, index) => ({ client, index, time: clientCreatedTime(client) }))
    .sort((a, b) => (b.time - a.time) || (a.index - b.index))
    .map(item => item.client);
}

function getAll() {
  if (!clientsCache) clientsCache = loadJsonClients();
  return sortClientsNewestFirst(clientsCache);
}

function getById(id)  { return getAll().find(c => c.id === id); }

function upsert(client) {
  if (!clientsCache) clientsCache = loadJsonClients();
  const idx = clientsCache.findIndex(c => c.id === client.id);
  if (idx >= 0) clientsCache[idx] = client;
  else clientsCache.push(client);
  clientsCache = sortClientsNewestFirst(clientsCache);
  saveClientsBackup(clientsCache);
  console.log("[goals] upsert client llamado", JSON.stringify({
    clientId: client.id,
    goalsCount: Array.isArray(client.goals) ? client.goals.length : 0,
  }));
  syncClientMirrorToPostgres(client).catch(error => {
    console.warn("[goals] error en sincronización espejo de cliente/metas con PostgreSQL", JSON.stringify({ clientId: client.id, error: error.message }));
  });
}

function remove(id) {
  if (!clientsCache) clientsCache = loadJsonClients();
  clientsCache = clientsCache.filter(c => c.id !== id);
  saveClientsBackup(clientsCache);
  deletePatientFromPostgres(id);
}

function newId(name) {
  const base = name.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
  return `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { pool, getAll, getById, initPatientsFromPostgres, upsert, remove, newId, sortClientsNewestFirst };
