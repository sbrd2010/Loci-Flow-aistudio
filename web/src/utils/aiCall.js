import { auth } from "../firebase";
import { appendAIUsageWarning, checkAndRecordAIUsage } from "./aiUsageLimits";

const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "openai/gpt-oss-120b";
const NVIDIA_URL   = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const GEMINI_URL   = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

const AI_TIMEOUT_MS = 30000;
const RATE_LIMIT_COOLDOWN_MS = 30000;
const SERVICE_UNAVAILABLE_COOLDOWN_MS = 10000;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

// Per-provider cooldown so a rate-limited provider is skipped (not re-hit)
// on subsequent calls until its cooldown expires. Keyed by provider name +
// key fingerprint (not provider name alone) so pasting a new key after an
// old key's 429 isn't blocked by the old key's cooldown.
const providerCooldownUntil = new Map();
const providerCooldownReason = new Map();

// One-way bucketing key for cooldown state only — never logged, never used
// to recover the key.
function keyFingerprint(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `${key.length}:${Math.abs(hash)}`;
}

function cooldownKey(provider) {
  return `${provider.name}:${keyFingerprint(provider.key)}`;
}

// Logs counts/metadata only — never the API key, key fingerprint, system
// prompt content, message content, or raw request body.
function logAICallDiagnostics({ provider, outcome, retryAfterMs, contextMode, systemPrompt, messages, usage }) {
  const messagesChars = (messages || []).reduce((sum, m) => sum + String(m.content || "").length, 0);
  const systemPromptChars = String(systemPrompt || "").length;

  const promptTokens = usage?.prompt_tokens ?? null;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? null;
  const completionTokens = usage?.completion_tokens ?? null;
  const totalTokens = usage?.total_tokens ?? null;
  const cacheHitRate = (promptTokens && cachedTokens !== null)
    ? Number((cachedTokens / promptTokens).toFixed(4))
    : null;

  console.debug("[aiCall]", {
    provider,
    outcome,
    retryAfterMs: retryAfterMs ?? null,
    contextMode: contextMode ?? null,
    systemPromptChars,
    messagesCount: (messages || []).length,
    messagesChars,
    approxTotalChars: systemPromptChars + messagesChars,
    promptTokens,
    cachedTokens,
    completionTokens,
    totalTokens,
    cacheHitRate,
  });
}

function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(id));
}

// Reads Retry-After (seconds or HTTP-date) off a 429/503 response.
// Returns null if missing/unparseable/non-positive, capped to 5 minutes.
function parseRetryAfterMs(res) {
  const header = res.headers?.get?.("Retry-After");
  if (!header) return null;
  let ms = null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    ms = seconds * 1000;
  } else {
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) ms = dateMs - Date.now();
  }
  if (ms === null || ms <= 0) return null;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

// Test-only: clears per-provider cooldown state between unrelated test cases.
export function resetProviderCooldowns() {
  providerCooldownUntil.clear();
  providerCooldownReason.clear();
}

// Helper to determine status errors
function statusError(provider, status, res) {
  // CoachTab already maps plain 429/503 to friendly messages.
  if (status === 429 || status === 503) {
    const err = new Error(String(status));
    err.retryAfterMs = parseRetryAfterMs(res);
    return err;
  }
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
      max_tokens: maxTokens ?? 300,
      temperature: 0.4,
      top_p: 0.9
    })
  });
  if (!res.ok) throw statusError("groq", res.status, res);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("groq_empty");
  return { reply, usage: data.usage };
}

async function callNvidia(nvidiaKey, systemPrompt, messages, maxTokens) {
  const outputMaxTokens = Math.min(maxTokens ?? 1500, 4000);
  const res = await fetchWithTimeout(NVIDIA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${nvidiaKey}`
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: outputMaxTokens,
      temperature: 0.4,
      top_p: 0.9,
      reasoning_effort: "high",
      reasoning_budget: 4096,
      stream: false
    })
  });
  if (!res.ok) throw statusError("nvidia", res.status, res);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("nvidia_empty");
  return { reply, usage: data.usage };
}

async function callGemini(geminiKey, systemPrompt, messages, maxTokens) {
  // Gemini requires contents to start with "user" role - strip leading AI messages
  let contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  while (contents.length > 0 && contents[0].role !== "user") contents.shift();
  if (contents.length === 0) {
    contents = [{ role: "user", parts: [{ text: "Hello" }] }];
  }
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents
  };
  const parsedMaxTokens = Number(maxTokens);
  if (Number.isInteger(parsedMaxTokens) && parsedMaxTokens > 0) {
    requestBody.generationConfig = { maxOutputTokens: parsedMaxTokens };
  }
  const res = await fetchWithTimeout(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  if (!res.ok) throw statusError("gemini", res.status, res);
  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!reply) throw new Error("gemini_empty");
  
  const usage = data.usageMetadata ? {
    prompt_tokens: data.usageMetadata.promptTokenCount,
    completion_tokens: data.usageMetadata.candidatesTokenCount,
    total_tokens: data.usageMetadata.totalTokenCount
  } : null;
  
  return { reply, usage };
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
    groq:   ["groq", "nvidia", "gemini"],
    nvidia: ["nvidia", "groq", "gemini"],
    gemini: ["gemini", "groq", "nvidia"],
  };
  return (orders[pref] || orders.auto).map(n => available[n]).filter(Boolean);
}

export async function callAI({ groqKey, nvidiaKey, geminiKey, systemPrompt, messages, maxTokens, contextMode }) {
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
    const ckey = cooldownKey(provider);
    if (Date.now() < (providerCooldownUntil.get(ckey) || 0)) {
      lastErr = new Error(providerCooldownReason.get(ckey) || "503");
      logAICallDiagnostics({ provider: provider.name, outcome: "cooldown_skip", contextMode, systemPrompt, messages });
      continue; // skip the provider network call; no extra provider attempt
    }
    try {
      let result;
      if (provider.name === "groq") {
        result = await callGroq(provider.key, systemPrompt, messages, maxTokens);
      } else if (provider.name === "nvidia") {
        result = await callNvidia(provider.key, systemPrompt, messages, maxTokens);
      } else {
        result = await callGemini(provider.key, systemPrompt, messages, maxTokens);
      }
      const { reply, usage: callUsage } = result;
      logAICallDiagnostics({ provider: provider.name, outcome: "ok", contextMode, systemPrompt, messages, usage: callUsage });
      return appendAIUsageWarning(reply, usage.warning);
    } catch (err) {
      lastErr = err;
      if (err.message === "429") {
        providerCooldownUntil.set(ckey, Date.now() + (err.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS));
        providerCooldownReason.set(ckey, "429");
      } else if (err.message === "503") {
        providerCooldownUntil.set(ckey, Date.now() + (err.retryAfterMs ?? SERVICE_UNAVAILABLE_COOLDOWN_MS));
        providerCooldownReason.set(ckey, "503");
      }
      logAICallDiagnostics({ provider: provider.name, outcome: err.message, retryAfterMs: err.retryAfterMs, contextMode, systemPrompt, messages });
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
    nvidiaKey: (localStorage.getItem("loci_nvidia_key") || import.meta.env.VITE_NVIDIA_KEY || "").trim(),
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
