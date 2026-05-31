import { auth } from "../firebase";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const BUILTIN_PROXY_KEY = "__LOCI_BUILTIN_AI_PROXY__";

function isBuiltinProxyKey(key) {
  return key === BUILTIN_PROXY_KEY;
}

function usageNoticeText(usage) {
  const warning = usage?.daily?.warning;
  if (!warning) return "";

  const used = usage.daily.count;
  const limit = usage.daily.limit;
  const remaining = usage.daily.remaining;

  if (warning.code === "day_exhausted") {
    return `Shared built-in AI limit reached for today (${used}/${limit}). Please wait for reset, or add a personal AI key in Settings.`;
  }
  if (warning.code === "day_95") {
    return `Shared built-in AI is almost used up today (${used}/${limit}; ${remaining} left). Please conserve chats now.`;
  }
  if (warning.code === "day_80") {
    return `Shared built-in AI is 80% used today (${used}/${limit}; ${remaining} left). Use it for important chats.`;
  }
  if (warning.code === "day_50") {
    return `Shared built-in AI is 50% used today (${used}/${limit}; ${remaining} left). You can still chat, but keep an eye on usage.`;
  }
  return "";
}

function proxyErrorMessage(code) {
  if (code === "daily_limit") {
    return "Shared built-in AI daily limit reached. Please wait until it resets, or add a personal AI key in Settings.";
  }
  if (code === "hourly_limit") {
    return "Shared built-in AI hourly limit reached. Please wait a while before trying again, or add a personal AI key in Settings.";
  }
  if (code === "auth_required") {
    return "Please sign in again to use built-in AI.";
  }
  return code;
}

function showUsageToast(usage) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const warning = usage?.daily?.warning;
  const text = usageNoticeText(usage);
  if (!warning || !text) return;

  const resetAt = usage?.daily?.resetAt || "unknown";
  const storageKey = `loci_ai_usage_notice_${warning.code}_${resetAt}`;
  if (localStorage.getItem(storageKey)) return;
  localStorage.setItem(storageKey, "1");

  document.getElementById("loci-ai-usage-toast")?.remove();

  const toast = document.createElement("div");
  toast.id = "loci-ai-usage-toast";
  toast.textContent = text;
  toast.setAttribute("role", "status");
  toast.style.cssText = [
    "position:fixed",
    "left:16px",
    "right:16px",
    "bottom:calc(88px + env(safe-area-inset-bottom, 0px))",
    "max-width:480px",
    "margin:0 auto",
    "z-index:9999",
    "padding:12px 14px",
    "border-radius:12px",
    "border:1px solid var(--border, rgba(255,255,255,.15))",
    "background:var(--bg-card, #111827)",
    "color:var(--text-primary, #fff)",
    "box-shadow:0 8px 32px rgba(0,0,0,.25)",
    "font:700 12.5px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "line-height:1.45",
    "text-align:left",
  ].join(";");

  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), warning.code === "day_exhausted" ? 12000 : 9000);
}

function emitAIUsage(usage) {
  if (!usage || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("loci-ai-usage", { detail: usage }));
  showUsageToast(usage);
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
  emitAIUsage(data.usage);

  if (!res.ok) {
    const err = new Error(proxyErrorMessage(data.code || `${res.status}`));
    err.usage = data.usage;
    throw err;
  }

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
