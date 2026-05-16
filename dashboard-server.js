const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const MENSAJES_FILE = path.join(DATA_DIR, "mensajes.json");
const CONV_FILE = path.join(DATA_DIR, "conversaciones.json");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// elegir carpeta pública (panel integrado si existe)
const publicDir1 = path.join(__dirname, "nutribot-panel-v2", "public");
const publicDir2 = path.join(__dirname, "public");
const staticDir = fs.existsSync(publicDir1) ? publicDir1 : publicDir2;
if (staticDir && fs.existsSync(staticDir)) app.use(express.static(staticDir));

app.get("/api/mensajes", (req, res) => {
  const data = readJson(MENSAJES_FILE) || {};
  res.json(data);
});

app.post("/api/mensajes", (req, res) => {
  const body = req.body || {};
  writeJson(MENSAJES_FILE, body);
  res.json({ ok: true });
});

app.get("/api/conversaciones", (req, res) => {
  const data = readJson(CONV_FILE) || {};
  res.json(data);
});

app.post("/api/conversaciones", (req, res) => {
  const body = req.body || {};
  writeJson(CONV_FILE, body);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Dashboard server listening on port ${PORT}`));

module.exports = app;
