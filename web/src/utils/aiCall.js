const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

async function callGroq({ groqKey, systemPrompt, messages, maxTokens }) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.8
    })
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("empty");
  return reply;
}

async function callGemini({ geminiKey, systemPrompt, messages }) {
  // Gemini requires contents to start with "user" role - strip leading AI messages.
  let contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  while (contents.length > 0 && contents[0].role !== "user") contents.shift();
  if (contents.length === 0) {
    contents = [{ role: "user", parts: [{ text: "Hello" }] }];
  }

  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents
    })
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!reply) throw new Error("empty");
  return reply;
}

/**
 * Unified AI call - prefers Groq (fast, free) and falls back to Gemini
 * when Groq is rate-limited or temporarily unavailable.
 * messages: [{ role: "user"|"assistant", content: string }]
 */
export async function callAI({ groqKey, geminiKey, systemPrompt, messages, maxTokens = 300 }) {
  const cleanGroqKey = (groqKey || "").trim();
  const cleanGeminiKey = (geminiKey || "").trim();

  if (cleanGroqKey) {
    try {
      return await callGroq({ groqKey: cleanGroqKey, systemPrompt, messages, maxTokens });
    } catch (groqErr) {
      if (!cleanGeminiKey) throw groqErr;
      console.warn("Groq AI failed; trying Gemini fallback:", groqErr?.message || groqErr);
    }
  }

  if (cleanGeminiKey) {
    return callGemini({ geminiKey: cleanGeminiKey, systemPrompt, messages });
  }

  throw new Error("no_key");
}

export function getAIKeys() {
  return {
    groqKey:   (localStorage.getItem("loci_groq_key")   || import.meta.env.VITE_GROQ_KEY   || "").trim(),
    geminiKey: (localStorage.getItem("loci_gemini_key") || import.meta.env.VITE_GEMINI_KEY || "").trim(),
  };
}

export function hasAIKey() {
  const { groqKey, geminiKey } = getAIKeys();
  return !!(groqKey || geminiKey);
}
