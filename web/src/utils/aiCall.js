import { auth } from "../firebase";
import { appendAIUsageWarning, checkAndRecordAIUsage } from "./aiUsageLimits";

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

/**
 * Unified AI call - prefers Groq (fast, free) over Gemini.
 * messages: [{ role: "user"|"assistant", content: string }]
 */
const AI_TIMEOUT_MS = 30000;

function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(id));
}

function statusError(provider, status) {
  // CoachTab already maps plain 429/503 to friendly messages.
  if (status === 429 || status === 503) return new Error(String(status));
  return new Error(`${provider}_${status}`);
}

function getAIUsageUserId() {
  return auth?.currentUser?.uid || auth?.currentUser?.email || "signed-out";
}

async function callGroq(groqKey, systemPrompt, messages, maxTokens) {
  const res = await fetchWithTimeout(GROQ_URL, {
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
  if (!res.ok) throw statusError("groq", res.status);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("groq_empty");
  return reply;
}

async function callGemini(geminiKey, systemPrompt, messages) {
  // Gemini requires contents to start with "user" role - strip leading AI messages
  let contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  while (contents.length > 0 && contents[0].role !== "user") contents.shift();
  if (contents.length === 0) {
    contents = [{ role: "user", parts: [{ text: "Hello" }] }];
  }
  const res = await fetchWithTimeout(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents
    })
  });
  if (!res.ok) throw statusError("gemini", res.status);
  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!reply) throw new Error("gemini_empty");
  return reply;
}

export async function callAI({ groqKey, geminiKey, systemPrompt, messages, maxTokens = 300 }) {
  const cleanGroqKey = (groqKey || "").trim();
  const cleanGeminiKey = (geminiKey || "").trim();

  if (!cleanGroqKey && !cleanGeminiKey) {
    throw new Error("no_key");
  }

  const usage = checkAndRecordAIUsage({ userId: getAIUsageUserId() });
  if (!usage.allowed) {
    return usage.message;
  }

  if (cleanGroqKey) {
    try {
      const reply = await callGroq(cleanGroqKey, systemPrompt, messages, maxTokens);
      return appendAIUsageWarning(reply, usage.warning);
    } catch (err) {
      // Rate-limited or quota exhausted - fall through to Gemini if available
      if (!cleanGeminiKey) throw err;
      console.warn("Groq failed, falling back to Gemini:", err.message);
    }
  }

  if (cleanGeminiKey) {
    const reply = await callGemini(cleanGeminiKey, systemPrompt, messages);
    return appendAIUsageWarning(reply, usage.warning);
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

// Parses a JSON array out of an AI reply, tolerating markdown code fences and
// stray text around the array (e.g. an "AI usage note" appended by callAI, or
// a leading sentence). Throws if no JSON array can be found.
export function extractJsonArray(raw) {
  const cleaned = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("invalid_json_array");
    parsed = JSON.parse(match[0]);
  }
  if (!Array.isArray(parsed)) throw new Error("invalid_json_array");
  return parsed;
}
