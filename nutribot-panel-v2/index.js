// index.js
require("dotenv").config();

const express    = require("express");
const bodyParser = require("body-parser");
const path       = require("path");
const db         = require("./src/db");
const history    = require("./src/history");
const { procesarMensaje, enviarMeta } = require("./src/bot");
const { recargarTodos }               = require("./src/scheduler");

const app  = express();
const PORT = process.env.PORT || 3000;
const PASS = process.env.ADMIN_PASSWORD || "nutribot2024";
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "nutribot2024";

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (token !== PASS) return res.status(401).json({ error: "No autorizado" });
  next();
}

// ── Login ──────────────────────────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  if (req.body.password === PASS) res.json({ ok: true });
  else res.status(401).json({ error: "Contraseña incorrecta" });
});

// ── Clientes ───────────────────────────────────────────────────────────────────
app.get("/api/clients", auth, (req, res) => res.json(db.getAll()));

app.post("/api/clients", auth, (req, res) => {
  const { nombres, phones, timezone, goals } = req.body;
  if (!nombres?.length || !phones?.length) return res.status(400).json({ error: "Faltan datos" });
  const client = { id: db.newId(nombres[0]), nombres, phones, timezone: timezone || "America/Santiago", goals: goals || [] };
  db.upsert(client);
  recargarTodos();
  res.json({ ok: true, client });
});

app.delete("/api/clients/:id", auth, (req, res) => {
  db.remove(req.params.id);
  recargarTodos();
  res.json({ ok: true });
});

// ── Metas ──────────────────────────────────────────────────────────────────────
app.post("/api/clients/:id/goals", auth, (req, res) => {
  const client = db.getById(req.params.id);
  if (!client) return res.status(404).json({ error: "No encontrado" });
  const { titulo, descripcion, emoji, hora, dias } = req.body;
  const goal = { id: Date.now().toString(), titulo, descripcion: descripcion || titulo, emoji: emoji || "🎯", hora: hora || "09:00", dias: dias || [1,2,3,4,5] };
  client.goals = client.goals || [];
  client.goals.push(goal);
  db.upsert(client);
  recargarTodos();
  res.json({ ok: true, goal });
});

app.delete("/api/clients/:id/goals/:goalId", auth, (req, res) => {
  const client = db.getById(req.params.id);
  if (!client) return res.status(404).json({ error: "No encontrado" });
  client.goals = (client.goals || []).filter(g => g.id !== req.params.goalId);
  db.upsert(client);
  recargarTodos();
  res.json({ ok: true });
});

app.post("/api/clients/:id/send", auth, async (req, res) => {
  const client = db.getById(req.params.id);
  if (!client) return res.status(404).json({ error: "No encontrado" });
  const meta = client.goals?.[0];
  if (!meta) return res.status(400).json({ error: "Sin metas" });
  await enviarMeta(client.id, meta);
  res.json({ ok: true });
});

// ── Historial ──────────────────────────────────────────────────────────────────
app.get("/api/clients/:id/history", auth, (req, res) => res.json(history.getHistorial(req.params.id)));
app.get("/api/clients/:id/resumen", auth, (req, res) => res.json(history.getResumen(req.params.id)));

// ── Webhook Meta (verificación) ────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado por Meta");
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Forbidden");
  }
});

// ── Webhook Meta (mensajes entrantes) ─────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK"); // Responder rápido a Meta

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value    = change.value;
        const messages = value?.messages;
        if (!messages?.length) continue;

        for (const msg of messages) {
          const phone     = msg.from;
          const texto     = msg.type === "text" ? msg.text?.body ?? "" : "";
          const tieneMedia = ["image","video","document"].includes(msg.type);

          console.log(`📩 +${phone}: "${texto}"${tieneMedia ? " [📸]" : ""}`);
          procesarMensaje(phone, texto, tieneMedia).catch(console.error);
        }
      }
    }
  } catch (e) {
    console.error("Error webhook:", e.message);
  }
});

// ── Health ─────────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", clientes: db.getAll().length, uptime: Math.floor(process.uptime()) }));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public/index.html")));

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🥗 NutriBot con Meta API — puerto ${PORT}`);
  recargarTodos();
});
