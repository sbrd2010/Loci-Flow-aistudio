import { auth } from "../firebase";
import { appendAIUsageWarning, checkAndRecordAIUsage } from "./aiUsageLimits";

const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "openai/gpt-oss-120b";
const NVIDIA_URL   = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const GEMINI_URL   = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

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
      temperature: 0.4,
      top_p: 0.9
    })
  });
  if (!res.ok) throw statusError("groq", res.status);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("groq_empty");
  return reply;
}

async function callNvidia(nvidiaKey, systemPrompt, messages, maxTokens) {
  // Use at least 1500 to leave room for reasoning tokens alongside the visible reply.
  const effectiveMaxTokens = Math.max(1500, maxTokens || 0);
  const res = await fetchWithTimeout(NVIDIA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${nvidiaKey}`
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: effectiveMaxTokens,
      temperature: 0.4,
      top_p: 0.9,
      reasoning_effort: "high",
      reasoning_budget: 4096,
      stream: false
    })
  });
  if (!res.ok) throw statusError("nvidia", res.status);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("nvidia_empty");
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

// Returns ordered list of providers to try based on user's preference.
// Providers with no key are skipped automatically.
function buildProviderOrder(pref, cleanGroqKey, cleanNvidiaKey, cleanGeminiKey) {
  const available = {
    groq:   cleanGroqKey   ? { name: "groq",   key: cleanGroqKey }   : null,
    nvidia: cleanNvidiaKey ? { name: "nvidia",  key: cleanNvidiaKey } : null,
    gemini: cleanGeminiKey ? { name: "gemini",  key: cleanGeminiKey } : null,
  };
  const orders = {
    auto:   ["groq", "nvidia", "gemini"],
    groq:   ["groq", "gemini", "nvidia"],
    nvidia: ["nvidia", "groq", "gemini"],
    gemini: ["gemini", "groq", "nvidia"],
  };
  return (orders[pref] || orders.auto).map(n => available[n]).filter(Boolean);
}

export async function callAI({ groqKey, nvidiaKey, geminiKey, systemPrompt, messages, maxTokens = 300 }) {
  const cleanGroqKey   = (groqKey   || "").trim();
  const cleanNvidiaKey = (nvidiaKey || "").trim();
  const cleanGeminiKey = (geminiKey || "").trim();

  const pref  = localStorage.getItem("loci_provider_pref") || "auto";
  const order = buildProviderOrder(pref, cleanGroqKey, cleanNvidiaKey, cleanGeminiKey);
  if (order.length === 0) throw new Error("no_key");

  const usage = checkAndRecordAIUsage({ userId: getAIUsageUserId() });
  if (!usage.allowed) return usage.message;

  let lastErr;
  for (const provider of order) {
    try {
      let reply;
      if (provider.name === "groq") {
        reply = await callGroq(provider.key, systemPrompt, messages, maxTokens);
      } else if (provider.name === "nvidia") {
        reply = await callNvidia(provider.key, systemPrompt, messages, maxTokens);
      } else {
        reply = await callGemini(provider.key, systemPrompt, messages);
      }
      return appendAIUsageWarning(reply, usage.warning);
    } catch (err) {
      lastErr = err;
      if (provider !== order[order.length - 1]) {
        console.warn(`${provider.name} failed, trying next provider:`, err.message);
      }
    }
  }
  // Preserve 429/503 so callers can surface rate-limit/busy hints.
  // All other failures become a stable, provider-agnostic error code.
  if (lastErr.message === "429" || lastErr.message === "503") throw lastErr;
  throw new Error("all_providers_failed");
}

export function getAIKeys() {
  return {
    groqKey:   (localStorage.getItem("loci_groq_key")   || import.meta.env.VITE_GROQ_KEY   || "").trim(),
    nvidiaKey: (localStorage.getItem("loci_nvidia_key") || "").trim(),
    geminiKey: (localStorage.getItem("loci_gemini_key") || import.meta.env.VITE_GEMINI_KEY || "").trim(),
  };
}

export function hasAIKey() {
  const { groqKey, nvidiaKey, geminiKey } = getAIKeys();
  return !!(groqKey || nvidiaKey || geminiKey);
}

// Parses a JSON array out of an AI reply, tolerating markdown code fences,
// leading sentences, and the "AI usage note" callAI appends after the reply.
// Throws if no JSON array can be found or parsed.
export function extractJsonArray(raw) {
  // Strip usage warning appended by appendAIUsageWarning before any parsing —
  // the warning text is not JSON and causes JSON.parse to fail on first try.
  const noWarning = String(raw || "").replace(/\n\nAI usage note:[\s\S]*/i, "");
  const cleaned = noWarning.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) throw new Error("invalid_json_array");
    parsed = JSON.parse(cleaned.substring(start, end + 1));
  }
  if (!Array.isArray(parsed)) throw new Error("invalid_json_array");
  return parsed;
}
