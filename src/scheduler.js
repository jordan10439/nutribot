// src/scheduler.js
const cron = require("node-cron");
const db   = require("./db");
const { enviarMeta } = require("./bot");

const jobs = new Map(); // metaId -> cron job

function programarMeta(client, meta) {
  const key = `${client.id}_${meta.id}`;
  if (jobs.has(key)) { jobs.get(key).stop(); jobs.delete(key); }

  const [hora, min] = meta.hora.split(":").map(Number);
  const specificDate = meta.specificDate ? String(meta.specificDate).slice(0, 10) : "";
  const [, month, day] = specificDate.split("-");
  const diasCron = (meta.dias?.length ? meta.dias : [1,2,3,4,5]).map(d => d === 7 ? 0 : d).join(",");
  const expr = specificDate ? `${min} ${hora} ${Number(day)} ${Number(month)} *` : `${min} ${hora} * * ${diasCron}`;

  const job = cron.schedule(expr, async () => {
    if (specificDate) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone: client.timezone || "America/Santiago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
      const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
      if (dateKey !== specificDate) return;
    }
    console.log(`🔔 Meta: "${meta.titulo}" → ${client.nombres.join(" & ")}`);
    try {
      await enviarMeta(client.id, meta);
    } catch (e) {
      console.error(`Error real al enviar meta programada "${meta.titulo}":`, e.message);
    }
    if (specificDate) {
      job.stop();
      jobs.delete(key);
    }
  }, { timezone: client.timezone || "America/Santiago" });

  jobs.set(key, job);
}

function recargarTodos() {
  // Detener todos los jobs actuales
  jobs.forEach(j => j.stop());
  jobs.clear();

  const clients = db.getAll();
  let total = 0;
  for (const client of clients) {
    for (const meta of (client.goals || [])) {
      programarMeta(client, meta);
      console.log(`📅 ${client.nombres.join(" & ")} → "${meta.titulo}" ${meta.hora}`);
      total++;
    }
  }
  console.log(`✅ ${total} metas programadas para ${clients.length} cliente(s).`);
}

module.exports = { recargarTodos, programarMeta };
