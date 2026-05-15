// src/db.js
const fs   = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "../data/db.json");

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

function getAll()     { return load().clients; }
function getById(id)  { return load().clients.find(c => c.id === id); }

function upsert(client) {
  const db  = load();
  const idx = db.clients.findIndex(c => c.id === client.id);
  if (idx >= 0) db.clients[idx] = client;
  else db.clients.push(client);
  save(db);
}

function remove(id) {
  const db = load();
  db.clients = db.clients.filter(c => c.id !== id);
  save(db);
}

function newId(name) {
  return name.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"") + "_" + Date.now();
}

module.exports = { getAll, getById, upsert, remove, newId };
