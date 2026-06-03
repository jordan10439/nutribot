// src/db.js
const { Pool } = require('pg');
require('dotenv').config();

const fs   = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "../data/db.json");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

async function deletePatientFromPostgres(id) {
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
  syncPatientToPostgres(client);
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
