const TEMPLATES = [
  {
    id: "seguimiento_directo",
    label: "Te escribo por seguimiento nutricional",
    envKey: "META_TEMPLATE_SEGUIMIENTO_DIRECTO",
    languageEnvKey: "META_TEMPLATE_SEGUIMIENTO_DIRECTO_LANGUAGE",
    metaName: process.env.META_TEMPLATE_SEGUIMIENTO_DIRECTO || "",
    languageCode: process.env.META_TEMPLATE_SEGUIMIENTO_DIRECTO_LANGUAGE || "",
    body: "Hola\nTe escribo por tu seguimiento nutricional ✨",
    buttonLabel: "Ver seguimiento",
  },
  {
    id: "seguimiento_nutricional",
    label: "Mensaje de seguimiento",
    envKey: "META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL",
    languageEnvKey: "META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL_LANGUAGE",
    metaName: process.env.META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL || "",
    languageCode: process.env.META_TEMPLATE_SEGUIMIENTO_NUTRICIONAL_LANGUAGE || "",
    body: "Hola, soy NutriGO\nTienes un nuevo mensaje de seguimiento registrado por Carla ✨",
    buttonLabel: "Ver mensaje",
  },
  {
    id: "recordatorio_registrado",
    label: "Recordatorio nutricional",
    envKey: "META_TEMPLATE_RECORDATORIO_REGISTRADO",
    languageEnvKey: "META_TEMPLATE_RECORDATORIO_REGISTRADO_LANGUAGE",
    metaName: process.env.META_TEMPLATE_RECORDATORIO_REGISTRADO || "",
    languageCode: process.env.META_TEMPLATE_RECORDATORIO_REGISTRADO_LANGUAGE || "",
    body: "Hola, soy NutriGO\nTienes un recordatorio nutricional registrado para hoy ✨",
    buttonLabel: "Ver recordatorio",
  },
  {
    id: "recomendacion_nutricional",
    label: "Recomendación nutricional",
    envKey: "META_TEMPLATE_RECOMENDACION_NUTRICIONAL",
    languageEnvKey: "META_TEMPLATE_RECOMENDACION_NUTRICIONAL_LANGUAGE",
    metaName: process.env.META_TEMPLATE_RECOMENDACION_NUTRICIONAL || "",
    languageCode: process.env.META_TEMPLATE_RECOMENDACION_NUTRICIONAL_LANGUAGE || "",
    body: "Hola, soy NutriGO\nTienes una recomendación nutricional registrada por Carla ✨",
    buttonLabel: "Ver recomendación",
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
  return TEMPLATES.filter(isConfigured).map(template => ({
    ...template,
    metaTemplateName: configuredName(template),
    metaLanguageCode: configuredLanguage(template),
  }));
}

function diagnostics() {
  return TEMPLATES.map(template => ({
    id: template.id,
    label: template.label,
    envKey: template.envKey,
    languageEnvKey: template.languageEnvKey,
    configured: isConfigured(template),
    hasName: !!configuredValue(template.metaName),
    hasLanguage: !!configuredValue(template.languageCode),
    metaTemplateName: configuredValue(template.metaName),
    metaLanguageCode: configuredValue(template.languageCode),
  }));
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

module.exports = { configuredLanguage, configuredName, diagnostics, get, list, validateId };
