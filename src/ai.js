// src/ai.js
async function respuestaIA(nombre, prompt) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content: `Eres NutriGO y acompañas a ${nombre} en el registro de sus metas. Responde en español, con tono cálido, breve (máx. 2 oraciones) y lenguaje neutro en género. Celebra el avance o acompaña con empatía, sin dar recomendaciones clínicas, sin juzgar y sin mencionar a Carla.`,
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "¡Excelente trabajo! 💪";
  } catch {
    return "¡Sigue adelante, vas muy bien! 🌱";
  }
}
module.exports = { respuestaIA };
