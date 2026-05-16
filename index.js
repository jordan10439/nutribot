// index.js
require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const path       = require("path");
const db         = require("./src/db");
const history    = require("./src/history");
const messages   = require("./src/messages");
const { procesarMensaje, enviarMeta, enviarBienvenida } = require("./src/bot");
const { recargarTodos } = require("./src/scheduler");

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

// ── Auth ───────────────────────────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  if (req.body.password === PASS) res.json({ ok: true });
  else res.status(401).json({ error: "Contraseña incorrecta" });
});

// ── Clientes ───────────────────────────────────────────────────────────────────
app.get("/api/clients", auth, (req, res) => res.json(db.getAll()));

app.post("/api/clients", auth, async (req, res) => {
  const { nombres, phones, timezone, goals } = req.body;
  if (!nombres?.length || !phones?.length) return res.status(400).json({ error: "Faltan datos" });
  const client = { id: db.newId(nombres[0]), nombres, phones, timezone: timezone || "America/Santiago", goals: goals || [] };
  db.upsert(client);
  recargarTodos();
  // Enviar bienvenida a cada integrante
  for (const phone of phones) {
    await enviarBienvenida(client.id, phone);
  }
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
  const goalId = req.body.goalId;
  const meta = goalId ? client.goals?.find(g => g.id === goalId) : client.goals?.[0];
  if (!meta) return res.status(400).json({ error: "Sin metas" });
  await enviarMeta(client.id, meta);
  res.json({ ok: true });
});

app.post("/api/clients/:id/welcome", auth, async (req, res) => {
  const client = db.getById(req.params.id);
  if (!client) return res.status(404).json({ error: "No encontrado" });
  for (const phone of client.phones) await enviarBienvenida(client.id, phone);
  res.json({ ok: true });
});

// ── Historial ──────────────────────────────────────────────────────────────────
app.get("/api/clients/:id/history", auth, (req, res) => res.json(history.getHistorial(req.params.id)));
app.get("/api/clients/:id/resumen", auth, (req, res) => res.json(history.getResumen(req.params.id)));
app.get("/api/history/all", auth, (req, res) => {
  const clients = db.getAll();
  let todo = [];
  for (const c of clients) {
    const h = history.getHistorial(c.id);
    todo = todo.concat(h.map(e => ({ ...e, clientNombre: c.nombres?.join(" & ") })));
  }
  todo.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  res.json(todo);
});

// ── Mensajes configurables ─────────────────────────────────────────────────────
app.get("/api/messages", auth, (req, res) => res.json(messages.getAll()));
app.put("/api/messages/:key", auth, (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: "Falta value" });
  messages.set(req.params.key, value);
  res.json({ ok: true });
});
app.post("/api/messages/:key/reset", auth, (req, res) => {
  messages.reset(req.params.key);
  res.json({ ok: true });
});
app.get("/api/messages/labels", auth, (req, res) => res.json(messages.LABELS));

// ── Webhook Meta ───────────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else res.status(403).send("Forbidden");
});

app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");
  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const messages2 = change.value?.messages;
        if (!messages2?.length) continue;
        for (const m of messages2) {
          const phone = m.from;
          let texto = "";
          if (m.type === "text") texto = m.text?.body ?? "";
          else if (m.type === "button") texto = m.button?.text || m.button?.payload || "";
          else if (m.type === "interactive") {
            if (m.interactive?.type === 'button_reply') texto = m.interactive.button_reply?.id || m.interactive.button_reply?.title || "";
            else if (m.interactive?.type === 'list_reply') texto = m.interactive.list_reply?.id || m.interactive.list_reply?.title || "";
          }
          const tieneMedia = ["image","video","document"].includes(m.type) || !!(m.image||m.video||m.document);
          console.log(`📩 +${phone}: "${texto}"${tieneMedia ? " [📸]" : ""}`);
          procesarMensaje(phone, texto, tieneMedia).catch(console.error);
        }
      }
    }
  } catch (e) { console.error("Error webhook:", e.message); }
});

app.get("/health", (_, res) => res.json({ status: "ok", clientes: db.getAll().length, uptime: Math.floor(process.uptime()) }));
app.get("/privacy", (_, res) => res.sendFile(path.join(__dirname, "public/privacy.html")));
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.listen(PORT, () => {
  console.log(`\n🌱 NutriGO Panel v3 — puerto ${PORT}`);
  recargarTodos();
});
