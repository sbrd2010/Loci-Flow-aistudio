import { auth } from "../firebase";
import { appendAIUsageWarning, checkAndRecordAIUsage } from "./aiUsageLimits";

const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "openai/gpt-oss-120b";
const NVIDIA_URL   = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const CEREBRAS_URL   = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = import.meta.env.VITE_CEREBRAS_MODEL || "gpt-oss-120b";
const GEMINI_URL   = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const ZAI_URL   = "https://api.z.ai/api/paas/v4/chat/completions";
const ZAI_MODEL = import.meta.env.VITE_ZAI_MODEL || "glm-4.7-flash";

// Z.ai's free GLM-4.7-Flash tier has a concurrency limit of 1 — only one
// request may be in flight at a time across the whole app instance. No
// queueing and no retries: a busy Z.ai is treated as "unavailable right now"
// and the next provider in the chain is tried instead.
const ZAI_MAX_OUTPUT_TOKENS = 800;
const ZAI_MAX_PAYLOAD_CHARS = 12000; // rough char-based size estimate, not a real tokenizer
let zaiInFlight = false;

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

// Robustly pulls text out of an OpenAI-compatible chat message: most
// providers return a plain string, but some return an array of content
// parts (e.g. [{ type: "text", text: "..." }]). Returns "" if neither shape
// yields text, rather than throwing — callers decide what an empty reply
// means.
function extractMessageContent(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // Only "text" parts are visible reply content — a "reasoning" part with
    // its own .text field must not be mistaken for the answer, since that's
    // exactly the hidden-token-consumption case this PR exists to detect.
    return content
      .map(part => (typeof part === "string" ? part : (part?.type === "text" && typeof part.text === "string" ? part.text : "")))
      .join("")
      .trim();
  }
  return "";
}

// Logs response *shape* only (never content) when a provider returns 200
// but no usable text — this is the signal needed to diagnose "<provider>_empty"
// failures without ever touching prompt/message/reply content.
function logEmptyReplyDiagnostics(provider, data, message) {
  const content = message?.content;
  console.debug("[aiCall:empty]", {
    provider,
    topLevelKeys: data ? Object.keys(data) : [],
    choicesLength: Array.isArray(data?.choices) ? data.choices.length : 0,
    finishReason: data?.choices?.[0]?.finish_reason ?? null,
    contentType: Array.isArray(content) ? "array" : typeof content,
    contentLength: typeof content === "string" ? content.length : (Array.isArray(content) ? content.length : 0),
    // Allowlisted token counts only, matching logAICallDiagnostics — never
    // the raw usage object, in case a provider ever nests extra fields there.
    promptTokens: data?.usage?.prompt_tokens ?? null,
    completionTokens: data?.usage?.completion_tokens ?? null,
    totalTokens: data?.usage?.total_tokens ?? null,
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

// Classifies a thrown provider error into a stable, caller-agnostic bucket.
// Used to pick the final error across all attempted providers (see callAI)
// and to drive describeAIError's user-facing copy.
export function classifyAIError(err) {
  const message = err?.message;
  if (message === "429") return "rate_limit";
  if (message === "503") return "service_unavailable";
  if (/_(401|403)$/.test(message || "")) return "invalid_key";
  if (err?.name === "AbortError" || err instanceof TypeError) return "network";
  return "unknown";
}

// Calm, non-technical copy for a final callAI() rejection (or its message
// code). Always makes clear that task data is untouched and this is a
// provider/connectivity issue, not the Coach "forgetting" or failing to
// reason — so callers can show this directly without their own mapping.
export function describeAIError(err) {
  const message = (err instanceof Error ? err.message : err) || "";
  switch (message) {
    case "429":
      return "AI is temporarily busy or rate-limited. Your tasks are safe — please wait a minute and try again.";
    case "503":
      return "AI service is temporarily unavailable. Your tasks are safe — please try again in a moment.";
    case "invalid_key":
      return "Your AI key looks invalid or unauthorized. Your tasks are safe — please check your AI key in Settings.";
    case "network":
      return "Couldn't reach the AI service — check your connection. Your tasks are safe, please try again.";
    case "no_key":
      return "Add an AI key in Settings to chat with your Coach.";
    case "all_providers_failed":
      return "AI is temporarily busy or rate-limited. Your tasks are safe. Please wait a minute and try again.";
    default:
      return "Something went wrong. Your tasks are safe — please try again.";
  }
}

function getAIUsageUserId() {
  return auth?.currentUser?.uid || auth?.currentUser?.email || "signed-out";
}

// gpt-oss-120b is a reasoning model on Groq too (same family Cerebras runs,
// see the Cerebras retry comment below) — hidden reasoning tokens can eat
// the whole completion budget before any visible content is written,
// producing an HTTP 200 with empty message.content. One retry at a larger
// budget recovers most of these without retrying indefinitely.
const GROQ_RETRY_TOKEN_CAP = 4000;

async function requestGroq(groqKey, systemPrompt, messages, tokenBudget, reasoningEffort) {
  const res = await fetchWithTimeout(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: tokenBudget,
      temperature: 0.4,
      top_p: 0.9,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
    })
  });
  if (!res.ok) throw statusError("groq", res.status, res);
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  return { reply: extractMessageContent(message), usage: data.usage, finishReason: data.choices?.[0]?.finish_reason, data, message };
}

async function callGroq(groqKey, systemPrompt, messages, maxTokens, reasoningEffort) {
  const initialBudget = maxTokens ?? 300;
  let { reply, usage, finishReason, data, message } = await requestGroq(groqKey, systemPrompt, messages, initialBudget, reasoningEffort);

  // Retry on finish_reason "length" alone, not just an empty reply — a
  // non-empty-but-truncated reply (hidden reasoning ate most, not all, of
  // the budget) is the literal mid-sentence-cutoff symptom this exists to
  // fix, and it would otherwise be returned as if it were a complete reply.
  if (finishReason === "length") {
    const retryBudget = Math.min(Math.max(initialBudget * 2, 1000), GROQ_RETRY_TOKEN_CAP);
    if (retryBudget > initialBudget) {
      ({ reply, usage, finishReason, data, message } = await requestGroq(groqKey, systemPrompt, messages, retryBudget, reasoningEffort));
    }
  }

  if (!reply) {
    logEmptyReplyDiagnostics("groq", data, message);
    throw new Error("groq_empty");
  }
  return { reply, usage };
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
  const reply = extractMessageContent(data.choices?.[0]?.message);
  if (!reply) {
    logEmptyReplyDiagnostics("nvidia", data, data.choices?.[0]?.message);
    throw new Error("nvidia_empty");
  }
  return { reply, usage: data.usage };
}

// Cerebras' gpt-oss-120b is a reasoning model: hidden reasoning tokens count
// against the completion budget, so a small max_completion_tokens can exhaust
// the budget (finish_reason "length") before any visible content is written,
// producing an HTTP 200 with empty message.content. One retry at a larger
// budget recovers most of these without retrying indefinitely.
const CEREBRAS_RETRY_TOKEN_CAP = 4000;

// reasoning_effort is only meaningful (and only validated as a known field)
// for Cerebras' gpt-oss family. VITE_CEREBRAS_MODEL (see README) lets a
// deployment swap in a different Cerebras model, which may reject an
// unrecognized reasoning_effort value with a 4xx — so only attach it when
// the configured model is actually gpt-oss. Matches both the bare Cerebras
// form ("gpt-oss-120b") and a namespaced form ("openai/gpt-oss-120b", the
// same naming GROQ_MODEL above uses) in case a deployment copies that form.
const CEREBRAS_SUPPORTS_REASONING_EFFORT = /(^|\/)gpt-oss/i.test(CEREBRAS_MODEL);

async function requestCerebras(cerebrasKey, systemPrompt, messages, tokenBudget, reasoningEffort) {
  const res = await fetchWithTimeout(CEREBRAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cerebrasKey}`
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      // gpt-oss-120b on Cerebras documents max_completion_tokens as the
      // current parameter (max_tokens is deprecated for this model), per
      // Cerebras' own cerebras-cloud-sdk-python completion_create_params.
      max_completion_tokens: tokenBudget,
      temperature: 0.4,
      top_p: 0.9,
      ...(reasoningEffort && CEREBRAS_SUPPORTS_REASONING_EFFORT ? { reasoning_effort: reasoningEffort } : {})
    })
  });
  if (!res.ok) throw statusError("cerebras", res.status, res);
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  return { reply: extractMessageContent(message), usage: data.usage, finishReason: data.choices?.[0]?.finish_reason, data, message };
}

async function callCerebras(cerebrasKey, systemPrompt, messages, maxTokens, reasoningEffort) {
  const initialBudget = maxTokens ?? 300;
  let { reply, usage, finishReason, data, message } = await requestCerebras(cerebrasKey, systemPrompt, messages, initialBudget, reasoningEffort);

  // Retry on finish_reason "length" alone, not just an empty reply — a
  // non-empty-but-truncated reply (hidden reasoning ate most, not all, of
  // the budget) is a mid-sentence cutoff, not a complete answer, and would
  // otherwise be returned as if it were done.
  if (finishReason === "length") {
    // A small initial budget (e.g. 220-300) can leave too little room for
    // gpt-oss-120b's hidden reasoning even after doubling, so the retry
    // budget has a 1000-token floor in addition to the doubling. Only retry
    // if that's actually larger than what was already tried — a caller that
    // already requested the 4000-token cap (e.g. MindBoxTab) would otherwise
    // get an identical second request with no chance of a different result.
    const retryBudget = Math.min(Math.max(initialBudget * 2, 1000), CEREBRAS_RETRY_TOKEN_CAP);
    if (retryBudget > initialBudget) {
      ({ reply, usage, finishReason, data, message } = await requestCerebras(cerebrasKey, systemPrompt, messages, retryBudget, reasoningEffort));
    }
  }

  if (!reply) {
    logEmptyReplyDiagnostics("cerebras", data, message);
    throw new Error("cerebras_empty");
  }
  return { reply, usage };
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

function computeZaiPayloadChars(systemPrompt, messages) {
  return String(systemPrompt || "").length +
    (messages || []).reduce((sum, m) => sum + String(m.content || "").length, 0);
}

// Coach's full task-context prompt embeds the task list as plain-text
// sections with a fixed set of horizon headers (see buildLociTaskContext in
// lociAIContext.js: "TODAY (n):", "THIS WEEK (n):", "THIS MONTH (n):",
// "QUARTER (n):", "6 MONTHS (n):", "WORK (n):", each followed by indented
// "  - ..." bullet lines). Dropping a header's bullet lines runs until the
// next header line or the first blank line (the dynamic prompt always has a
// blank line right after the task-context block ends), so trailing context
// blocks (Now Focus, day map, etc.) are never swept up by mistake.
const ZAI_ALL_HORIZON_HEADERS = ["TODAY (", "THIS WEEK (", "THIS MONTH (", "QUARTER (", "6 MONTHS (", "WORK ("];
const ZAI_DROP_HEADERS_TIER1 = ["THIS MONTH (", "QUARTER (", "6 MONTHS (", "WORK ("];
const ZAI_DROP_HEADERS_TIER2 = [...ZAI_DROP_HEADERS_TIER1, "THIS WEEK ("];

function dropZaiHorizonSections(text, dropHeaders, preserveHeaders = []) {
  if (!text) return text;
  let dropping = false;
  let keepDetailsRemaining = 0;
  let currentHorizonHeader = "";
  let headerEmittedForFocus = false;

  const lines = text.split("\n");
  const outputLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const trimmedUpper = trimmed.toUpperCase();

    // 1. Preserve explicit NOW FOCUS / Now Focus section if encountered.
    // If a line starts with the header of the Now Focus section, stop dropping.
    if (trimmedUpper.startsWith("NOW FOCUS") || trimmedUpper.startsWith("CURRENT NOW FOCUS")) {
      dropping = false;
      keepDetailsRemaining = 0;
    }

    const headerHit = ZAI_ALL_HORIZON_HEADERS.find(h => line.startsWith(h));
    if (headerHit) {
      const shouldDrop = dropHeaders.includes(headerHit) && !preserveHeaders.includes(headerHit);
      dropping = shouldDrop;
      keepDetailsRemaining = 0;
      currentHorizonHeader = headerHit.replace(" (", "").trim(); // e.g. "THIS MONTH"
      headerEmittedForFocus = false;

      if (!dropping) {
        outputLines.push(line);
      }
      continue;
    }

    if (dropping && line.trim() === "") {
      dropping = false;
      keepDetailsRemaining = 0;
    }

    // 2. If Now Focus is embedded inside a horizon section that is being dropped,
    // keep only this line and up to 4 subsequent detail lines, and prepend a label.
    if (dropping) {
      if (line.toUpperCase().includes("[NOW FOCUS]")) {
        keepDetailsRemaining = 4;
        if (!headerEmittedForFocus && currentHorizonHeader) {
          outputLines.push(`PRESERVED FROM ${currentHorizonHeader}:`);
          headerEmittedForFocus = true;
        }
        outputLines.push(line);
        continue;
      }

      if (keepDetailsRemaining > 0) {
        const isNewTask = /^\s*-\s*\[/.test(line);
        if (isNewTask) {
          keepDetailsRemaining = 0;
        } else {
          const hasSpaceOrTab = line.startsWith(" ") || line.startsWith("\t");
          const hasLabel = /\b(concrete step|next step|substep|focus|timer)\b/i.test(line);
          if (hasSpaceOrTab || hasLabel) {
            keepDetailsRemaining--;
            outputLines.push(line);
            continue;
          } else {
            keepDetailsRemaining = 0;
          }
        }
      }
    } else {
      outputLines.push(line);
    }
  }

  return outputLines.join("\n");
}

function detectRequestedHorizons(userText) {
  const text = (userText || "").toLowerCase();
  const requested = [];

  if (/\bwork\b/i.test(text)) {
    requested.push("WORK (");
  }
  if (/\b(this\s+)?week\b/i.test(text)) {
    requested.push("THIS WEEK (");
  }
  if (/\b(this\s+)?month\b/i.test(text)) {
    requested.push("THIS MONTH (");
  }
  if (/\bquarter\b/i.test(text)) {
    requested.push("QUARTER (");
  }
  if (/\b(6\s+months|six\s+months|half-year)\b/i.test(text)) {
    requested.push("6 MONTHS (");
  }

  return requested;
}

// Z.ai is an emergency-only fallback (free tier, concurrency limit 1, low
// payload cap) — not a primary provider. A normal Coach chat/task question
// can still be too big only because of the attached task-context snapshot,
// not because the caller actually needs a long/structured reply; for those,
// compress the context in stages (drop Month/Quarter/6 months/Work task
// lists, trim chat history to the latest exchange, then drop This Week too)
// instead of skipping Z.ai outright. Requests that genuinely need a long or
// structured reply are already excluded above by the output-token check.
function compressZaiContext(systemPrompt, messages) {
  const userMessages = (messages || []).filter(m => m.role === "user");
  const latestMessageContent = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : "";
  const preserveHeaders = detectRequestedHorizons(latestMessageContent);

  // 1. Try Tier 1 drops with full messages
  let trimmedSystemPrompt = dropZaiHorizonSections(systemPrompt, ZAI_DROP_HEADERS_TIER1, preserveHeaders);
  if (computeZaiPayloadChars(trimmedSystemPrompt, messages) <= ZAI_MAX_PAYLOAD_CHARS) {
    return { systemPrompt: trimmedSystemPrompt, messages };
  }

  // 2. Try Tier 2 drops (This Week) with full messages
  trimmedSystemPrompt = dropZaiHorizonSections(systemPrompt, ZAI_DROP_HEADERS_TIER2, preserveHeaders);
  if (computeZaiPayloadChars(trimmedSystemPrompt, messages) <= ZAI_MAX_PAYLOAD_CHARS) {
    return { systemPrompt: trimmedSystemPrompt, messages };
  }

  // 3. Try Tier 2 drops (This Week) with trimmed messages (last 3)
  const trimmedMessages = (messages || []).length > 3 ? messages.slice(-3) : messages;
  trimmedSystemPrompt = dropZaiHorizonSections(systemPrompt, ZAI_DROP_HEADERS_TIER2, preserveHeaders);
  return { systemPrompt: trimmedSystemPrompt, messages: trimmedMessages };
}

async function callZai(zaiKey, systemPrompt, messages, maxTokens) {
  if (zaiInFlight) throw new Error("zai_busy");

  // A caller requesting more than the cap (e.g. MindBox's JSON organizer) would
  // otherwise get a silently truncated reply that can pass the empty-reply check
  // but fail downstream parsing. Skip Z.ai entirely instead so callAI falls
  // through to the next provider with the caller's full requested budget.
  if ((maxTokens ?? 300) > ZAI_MAX_OUTPUT_TOKENS) throw new Error("zai_too_large_request");

  let effectiveSystemPrompt = systemPrompt;
  let effectiveMessages = messages;
  if (computeZaiPayloadChars(systemPrompt, messages) > ZAI_MAX_PAYLOAD_CHARS) {
    ({ systemPrompt: effectiveSystemPrompt, messages: effectiveMessages } = compressZaiContext(systemPrompt, messages));
  }
  if (computeZaiPayloadChars(effectiveSystemPrompt, effectiveMessages) > ZAI_MAX_PAYLOAD_CHARS) {
    throw new Error("zai_too_large");
  }

  zaiInFlight = true;
  try {
    const res = await fetchWithTimeout(ZAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${zaiKey}`
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [{ role: "system", content: effectiveSystemPrompt }, ...effectiveMessages],
        max_tokens: maxTokens ?? 300,
        temperature: 0.4
      })
    });
    if (!res.ok) throw statusError("zai", res.status, res);
    const data = await res.json();
    const message = data.choices?.[0]?.message;
    const reply = extractMessageContent(message);
    if (!reply) {
      logEmptyReplyDiagnostics("zai", data, message);
      throw new Error("zai_empty");
    }
    return { reply, usage: data.usage };
  } finally {
    zaiInFlight = false;
  }
}

// Returns ordered list of providers to try based on user's preference.
// Providers with no key are skipped automatically.
export function buildProviderOrder(pref, cleanGroqKey, cleanNvidiaKey, cleanGeminiKey, cleanCerebrasKey, cleanZaiKey) {
  const available = {
    groq:     cleanGroqKey     ? { name: "groq",     key: cleanGroqKey }     : null,
    nvidia:   cleanNvidiaKey   ? { name: "nvidia",    key: cleanNvidiaKey }   : null,
    gemini:   cleanGeminiKey   ? { name: "gemini",    key: cleanGeminiKey }   : null,
    cerebras: cleanCerebrasKey ? { name: "cerebras",  key: cleanCerebrasKey } : null,
    zai:      cleanZaiKey      ? { name: "zai",       key: cleanZaiKey }      : null,
  };
  // NVIDIA is excluded from "auto"/"groq"/"gemini" orders — currently
  // inaccessible due to a backend/provider issue; stays manual/experimental
  // via the explicit "nvidia" preference only. Z.ai is an emergency-only
  // fallback (free tier, concurrency limit 1) — placed after Cerebras and
  // before Gemini in every chain except the explicit Gemini/Z.ai preferences.
  // "auto" leads with Cerebras (matches the "cerebras" preset) rather than
  // Groq, since Cerebras has proven the stronger default for this app.
  const orders = {
    auto:     ["cerebras", "groq", "zai", "gemini"],
    groq:     ["groq", "cerebras", "zai", "gemini"],
    cerebras: ["cerebras", "groq", "zai", "gemini"],
    zai:      ["zai", "groq", "cerebras", "gemini"],
    gemini:   ["gemini", "groq", "cerebras", "zai"],
    nvidia:   ["nvidia", "groq", "cerebras", "zai", "gemini"],
  };
  return (orders[pref] || orders.auto).map(n => available[n]).filter(Boolean);
}

export async function callAI({ groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey, systemPrompt, messages, maxTokens, contextMode, reasoningEffort }) {
  const cleanGroqKey     = (groqKey     || "").trim();
  const cleanNvidiaKey   = (nvidiaKey   || "").trim();
  const cleanGeminiKey   = (geminiKey   || "").trim();
  const cleanCerebrasKey = (cerebrasKey || "").trim();
  const cleanZaiKey      = (zaiKey      || "").trim();

  const pref  = localStorage.getItem("loci_provider_pref") || "auto";
  const order = buildProviderOrder(pref, cleanGroqKey, cleanNvidiaKey, cleanGeminiKey, cleanCerebrasKey, cleanZaiKey);
  if (order.length === 0) throw new Error("no_key");

  const usage = checkAndRecordAIUsage({ userId: getAIUsageUserId() });
  if (!usage.allowed) return usage.message;

  // Request-local only (cleared every callAI invocation) — tracks every
  // attempted provider's failure so the final error reflects the real
  // bottleneck rather than whichever provider happened to fail last. E.g.
  // Groq 429 (real rate-limit) + fallback NVIDIA 401 (unrelated/likely
  // unconfigured) must surface as rate_limit, not invalid_key.
  const attempts = [];
  for (const provider of order) {
    const ckey = cooldownKey(provider);
    if (Date.now() < (providerCooldownUntil.get(ckey) || 0)) {
      const cooldownErr = new Error(providerCooldownReason.get(ckey) || "503");
      attempts.push({ err: cooldownErr, classification: classifyAIError(cooldownErr), live: false });
      logAICallDiagnostics({ provider: provider.name, outcome: "cooldown_skip", contextMode, systemPrompt, messages });
      continue; // skip the provider network call; no extra provider attempt
    }
    try {
      let result;
      if (provider.name === "groq") {
        result = await callGroq(provider.key, systemPrompt, messages, maxTokens, reasoningEffort);
      } else if (provider.name === "nvidia") {
        result = await callNvidia(provider.key, systemPrompt, messages, maxTokens);
      } else if (provider.name === "cerebras") {
        result = await callCerebras(provider.key, systemPrompt, messages, maxTokens, reasoningEffort);
      } else if (provider.name === "zai") {
        result = await callZai(provider.key, systemPrompt, messages, maxTokens);
      } else {
        result = await callGemini(provider.key, systemPrompt, messages, maxTokens);
      }
      const { reply, usage: callUsage } = result;
      logAICallDiagnostics({ provider: provider.name, outcome: "ok", contextMode, systemPrompt, messages, usage: callUsage });
      return appendAIUsageWarning(reply, usage.warning);
    } catch (err) {
      attempts.push({ err, classification: classifyAIError(err), live: true });
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

  // Pick the final error by priority across all attempts, not just the last
  // one — see comment above. Real availability issues (rate limit / service
  // down / network) always outrank a same-request auth failure on a
  // secondary/fallback provider. Cooldown-skips reflect a stale failure from
  // a previous call, not this request — prefer live attempts for the
  // decision whenever at least one provider was actually contacted, so a
  // live invalid-key failure isn't masked by an old cooldown reason.
  const liveAttempts = attempts.filter(a => a.live);
  const decisionAttempts = liveAttempts.length > 0 ? liveAttempts : attempts;
  const findAttempt = (classification) => decisionAttempts.find(a => a.classification === classification);
  if (decisionAttempts.every(a => a.classification === "invalid_key")) throw new Error("invalid_key");
  const rateLimited = findAttempt("rate_limit");
  if (rateLimited) throw rateLimited.err;
  const serviceUnavailable = findAttempt("service_unavailable");
  if (serviceUnavailable) throw serviceUnavailable.err;
  if (findAttempt("network")) throw new Error("network");
  throw new Error("all_providers_failed");
}

// Private-alpha build-key pattern: localStorage (user-entered BYOK) wins,
// otherwise falls back to a build-time VITE_* env var. This is the same
// pattern already in use for Groq/NVIDIA/Gemini and is a known, accepted
// exposure for this stage — see SettingsTab.jsx AI Keys section copy and
// the PR description for the server-side-proxy migration plan.
export function getAIKeys() {
  return {
    groqKey:     (localStorage.getItem("loci_groq_key")     || import.meta.env.VITE_GROQ_KEY     || "").trim(),
    nvidiaKey:   (localStorage.getItem("loci_nvidia_key")   || import.meta.env.VITE_NVIDIA_KEY    || "").trim(),
    geminiKey:   (localStorage.getItem("loci_gemini_key")   || import.meta.env.VITE_GEMINI_KEY    || "").trim(),
    cerebrasKey: (localStorage.getItem("loci_cerebras_key") || import.meta.env.VITE_CEREBRAS_KEY  || "").trim(),
    zaiKey:      (localStorage.getItem("loci_zai_key")      || import.meta.env.VITE_ZAI_KEY       || "").trim(),
  };
}

// True only if the user's selected provider order actually has a usable
// provider — e.g. an NVIDIA-only key with pref "auto" returns false, since
// NVIDIA is excluded from the auto/groq/gemini chains and callAI would
// throw "no_key" for that combination.
export function hasAIKey() {
  const { groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const pref = localStorage.getItem("loci_provider_pref") || "auto";
  return buildProviderOrder(pref, groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey).length > 0;
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
