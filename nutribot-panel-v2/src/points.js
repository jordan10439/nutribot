// src/points.js
const NIVELES = [
  { nombre: "Explorador",    min: 0,  max: 20,  emoji: "🏕️" },
  { nombre: "En Camino",     min: 21, max: 50,  emoji: "🚀" },
  { nombre: "Equilibrio",    min: 51, max: 80,  emoji: "⭐" },
  { nombre: "Maestro",       min: 81, max: 999, emoji: "👑" },
];
const store = {};

function init(id) {
  if (!store[id]) store[id] = { puntos: 0, completados: new Set(), totalCompletados: 0, fotos: 0, insignias: [] };
  return store[id];
}
function get(id)       { return init(id); }
function getNivel(pts) { return NIVELES.find(n => pts >= n.min && pts <= n.max) ?? NIVELES[0]; }

function sumar(id, phone, totalIntegrantes) {
  const p = init(id);
  const nivelAntes = getNivel(p.puntos);
  p.puntos += 10;
  p.fotos++;
  p.completados.add(phone);
  const ambos = p.completados.size >= totalIntegrantes;
  if (ambos) { p.totalCompletados++; p.completados = new Set(); }
  const nivelDespues = getNivel(p.puntos);
  return { puntos: p.puntos, subioNivel: nivelAntes.nombre !== nivelDespues.nombre, nivelNuevo: nivelDespues, ambos };
}
function yaCompleto(id, phone) { return init(id).completados.has(phone); }
function resumen(id) {
  const p = init(id); const n = getNivel(p.puntos);
  return `⭐ *${p.puntos} pts* | ${n.emoji} ${n.nombre}\n✅ Completadas: ${p.totalCompletados}`;
}
module.exports = { get, sumar, yaCompleto, resumen };
