const TEMPLATES = [
  {
    id: "recordatorio_hoy",
    label: "Recordatorio nutricional para hoy",
    envKey: "META_TEMPLATE_RECORDATORIO_HOY",
    metaName: process.env.META_TEMPLATE_RECORDATORIO_HOY || "",
    body: "🌿Tienes un recordatorio nutricional registrado para hoy✨:\nSi tienes dudas, puedes revisarlo directamente con Carla.",
  },
  {
    id: "seguimiento_nutricional",
    label: "Seguimiento nutricional",
    envKey: "META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL",
    metaName: process.env.META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL || "",
    body: "Hola\nTe escribo por tu seguimiento nutricional ✨🌱\nNutriGO",
  },
  {
    id: "recordatorio_registrado",
    label: "Recordatorio nutricional registrado",
    envKey: "META_TEMPLATE_RECORDATORIO_REGISTRADO",
    metaName: process.env.META_TEMPLATE_RECORDATORIO_REGISTRADO || "",
    body: "Hola, soy NutriGO\nTienes un recordatorio nutricional registrado 🌿✨",
  },
  {
    id: "recomendacion_nutricional",
    label: "Recomendación nutricional",
    envKey: "META_TEMPLATE_RECOMENDACION_NUTRICIONAL",
    metaName: process.env.META_TEMPLATE_RECOMENDACION_NUTRICIONAL || "",
    body: "Hola, soy NutriGO\n🌱Tienes una recomendación nutricional registrada por Carla✨.",
  },
  {
    id: "mensaje_carla",
    label: "Mensaje registrado por Carla",
    envKey: "META_TEMPLATE_MENSAJE_CARLA",
    metaName: process.env.META_TEMPLATE_MENSAJE_CARLA || "",
    body: "Hola, soy NutriGO\n🌿Tienes un mensaje registrado por Carla✨",
  },
];

function list() {
  return TEMPLATES.map(template => ({ ...template }));
}

function get(id) {
  return TEMPLATES.find(template => template.id === id) || null;
}

function validateId(id) {
  if (!id) return "";
  if (!get(id)) throw new Error("Plantilla previa no válida");
  return id;
}

function configuredName(template) {
  const name = String(template?.metaName || "").trim();
  const placeholder = /placeholder|ejemplo|example|cambiar|configurar|nombre[_ -]?real/i.test(name);
  if (!name || placeholder) {
    throw new Error(`Falta configurar el nombre técnico real de la plantilla aprobada en Meta (${template?.envKey || "variable no definida"})`);
  }
  return name;
}

function configuredLanguage() {
  const language = String(process.env.META_TEMPLATE_LANGUAGE || "").trim();
  if (!language) {
    throw new Error("Falta configurar el idioma aprobado de la plantilla en Meta (META_TEMPLATE_LANGUAGE)");
  }
  return language;
}

module.exports = { configuredLanguage, configuredName, get, list, validateId };
