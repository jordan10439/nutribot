function explainMetaError(message) {
  const text = String(message || "").trim();
  if (/re-engagement message/i.test(text)) {
    return [
      text,
      "Meta rechazó el contenido principal porque el paciente está fuera de la ventana de 24 horas.",
      "La plantilla previa puede llegar, pero el contenido libre de la meta/tip puede requerir una plantilla aprobada o que el paciente responda primero.",
    ].join(" ");
  }
  return text || "Error desconocido de Meta";
}

module.exports = { explainMetaError };
