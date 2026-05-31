import { auth } from "../firebase";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const BUILTIN_PROXY_KEY = "__LOCI_BUILTIN_AI_PROXY__";

function isBuiltinProxyKey(key) {
  return key === BUILTIN_PROXY_KEY;
}

async function callBuiltinProxy({ systemPrompt, messages, maxTokens }) {
  const user = auth.currentUser;
  if (!user) throw new Error("auth_required");

  const token = await user.getIdToken();
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ systemPrompt, messages, maxTokens }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.code || `${res.status}`);

  const reply = data.reply || "";
  if (!reply) throw new Error("empty");
  return reply;
}

async function callGroq({ groqKey, systemPrompt, messages, maxTokens }) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.8,
    }),
  });

  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("empty");
  return reply;
}

async function callGemini({ geminiKey, systemPrompt, messages }) {
  // Gemini requires contents to start with user role; strip leading AI messages.
  let contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
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
      contents,
    }),
  });

  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!reply) throw new Error("empty");
  return reply;
}

/**
 * Unified AI call.
 * - Deployed default: authenticated Firebase Function proxy, so shared keys are not in JS.
 * - Optional personal local keys: direct browser provider calls, owned by the user.
 */
export async function callAI({ groqKey, geminiKey, systemPrompt, messages, maxTokens = 300 }) {
  const cleanGroqKey = (groqKey || "").trim();
  const cleanGeminiKey = (geminiKey || "").trim();

  if (isBuiltinProxyKey(cleanGroqKey) && !cleanGeminiKey) {
    return callBuiltinProxy({ systemPrompt, messages, maxTokens });
  }

  if (cleanGroqKey && !isBuiltinProxyKey(cleanGroqKey)) {
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
  const localGroq = (localStorage.getItem("loci_groq_key") || "").trim();
  const localGemini = (localStorage.getItem("loci_gemini_key") || "").trim();
  const proxyEnabled =
    import.meta.env.VITE_AI_PROXY_ENABLED === "true" ||
    import.meta.env.VITE_GROQ_KEY === BUILTIN_PROXY_KEY;

  return {
    groqKey: localGroq || (!localGemini && proxyEnabled ? BUILTIN_PROXY_KEY : ""),
    geminiKey: localGemini,
  };
}

export function hasAIKey() {
  const { groqKey, geminiKey } = getAIKeys();
  return !!(groqKey || geminiKey);
}
