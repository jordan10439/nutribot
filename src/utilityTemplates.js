const TEMPLATES = [
  {
    id: "seguimiento_nutricional",
    label: "Seguimiento nutricional",
    envKey: "META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL",
    languageEnvKey: "META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL_LANGUAGE",
    metaName: process.env.META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL || "",
    languageCode: process.env.META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL_LANGUAGE || "",
    body: "Hola\nTe escribo por tu seguimiento nutricional ✨🌱\nNutriGO",
  },
  {
    id: "recordatorio_registrado",
    label: "Recordatorio nutricional registrado",
    envKey: "META_TEMPLATE_RECORDATORIO_REGISTRADO",
    languageEnvKey: "META_TEMPLATE_RECORDATORIO_REGISTRADO_LANGUAGE",
    metaName: process.env.META_TEMPLATE_RECORDATORIO_REGISTRADO || "",
    languageCode: process.env.META_TEMPLATE_RECORDATORIO_REGISTRADO_LANGUAGE || "",
    body: "Hola, soy NutriGO\nTienes un recordatorio nutricional registrado 🌿✨",
  },
  {
    id: "recomendacion_nutricional",
    label: "Recomendación nutricional",
    envKey: "META_TEMPLATE_RECOMENDACION_NUTRICIONAL",
    languageEnvKey: "META_TEMPLATE_RECOMENDACION_NUTRICIONAL_LANGUAGE",
    metaName: process.env.META_TEMPLATE_RECOMENDACION_NUTRICIONAL || "",
    languageCode: process.env.META_TEMPLATE_RECOMENDACION_NUTRICIONAL_LANGUAGE || "",
    body: "Hola, soy NutriGO\n🌱Tienes una recomendación nutricional registrada por Carla✨.",
  },
  {
    id: "mensaje_carla",
    label: "Mensaje registrado por Carla",
    envKey: "META_TEMPLATE_MENSAJE_CARLA",
    languageEnvKey: "META_TEMPLATE_MENSAJE_CARLA_LANGUAGE",
    metaName: process.env.META_TEMPLATE_MENSAJE_CARLA || "",
    languageCode: process.env.META_TEMPLATE_MENSAJE_CARLA_LANGUAGE || "",
    body: "Hola, soy NutriGO\n🌿Tienes un mensaje registrado por Carla✨",
  },
];

function configuredValue(value) {
  const clean = String(value || "").trim();
  const placeholder = /placeholder|ejemplo|example|cambiar|configurar|nombre[_ -]?real/i.test(clean);
  return clean && !placeholder ? clean : "";
}

function configuredName(template) {
  const name = configuredValue(template?.metaName);
  if (!name) {
    throw new Error(`Falta configurar el nombre técnico real de la plantilla aprobada en Meta (${template?.envKey || "variable no definida"})`);
  }
  return name;
}

function configuredLanguage(template) {
  const language = configuredValue(template?.languageCode);
  if (!language) {
    throw new Error(`Falta configurar el idioma aprobado de la plantilla en Meta (${template?.languageEnvKey || "variable no definida"})`);
  }
  return language;
}

function isConfigured(template) {
  try {
    configuredName(template);
    configuredLanguage(template);
    return true;
  } catch {
    return false;
  }
}

function list() {
  return TEMPLATES.filter(isConfigured).map(template => ({ ...template }));
}

function get(id) {
  return TEMPLATES.find(template => template.id === id) || null;
}

function validateId(id) {
  if (!id) return "";
  const template = get(id);
  if (!template) throw new Error("Plantilla previa no válida");
  configuredName(template);
  configuredLanguage(template);
  return id;
}

module.exports = { configuredLanguage, configuredName, get, list, validateId };
