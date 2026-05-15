// src/state.js
const states = new Map();
const FLOW = {
  IDLE: "idle",
  META_ENVIADA: "meta_enviada",
  ESPERANDO_FOTO: "esperando_foto",
  ESPERANDO_ESTRELLAS: "esperando_estrellas",
  ESPERANDO_DIFICULTAD: "esperando_dificultad",
  ESPERANDO_COMENTARIO: "esperando_comentario",
  DONE: "done",
};
function get(phone)       { return states.get(phone) ?? { flow: FLOW.IDLE }; }
function set(phone, data) { states.set(phone, { ...get(phone), ...data }); }
function reset(phone)     { states.set(phone, { flow: FLOW.IDLE }); }
module.exports = { FLOW, get, set, reset };
