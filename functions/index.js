const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const groqSecret = defineSecret("GROQ_API_KEY");
const geminiSecret = defineSecret("GEMINI_API_KEY");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const DATABASE_URL = "https://loci-flow-default-rtdb.firebaseio.com";

const HOURLY_LIMIT = 40;
const DAILY_LIMIT = 120;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 6000;
const MAX_SYSTEM_CHARS = 8000;
const MAX_TOKENS = 1000;

admin.initializeApp({ databaseURL: DATABASE_URL });

function json(res, status, body) {
  res.set("Cache-Control", "no-store");
  res.status(status).json(body);
}

function noContent(res) {
  res.set("Cache-Control", "no-store");
  res.status(204).send("");
}

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    throw new Error("invalid_messages");
  }

  return messages.map((message) => {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = String(message?.content || "").slice(0, MAX_MESSAGE_CHARS).trim();
    if (!content) throw new Error("empty_message");
    return { role, content };
  });
}

function parseRequestBody(req) {
  const systemPrompt = String(req.body?.systemPrompt || "").slice(0, MAX_SYSTEM_CHARS).trim();
  const messages = cleanMessages(req.body?.messages);
  const requestedTokens = Number(req.body?.maxTokens || 300);
  const maxTokens = Math.min(MAX_TOKENS, Math.max(1, Number.isFinite(requestedTokens) ? requestedTokens : 300));

  if (!systemPrompt) throw new Error("missing_system_prompt");
  return { systemPrompt, messages, maxTokens };
}

function normalizeBucket(raw, windowMs, now) {
  const resetAt = Number(raw?.resetAt) || 0;
  if (!resetAt || resetAt <= now) {
    return { count: 0, resetAt: now + windowMs };
  }
  return {
    count: Math.max(0, Number(raw?.count) || 0),
    resetAt,
  };
}

function dailyWarning(percent) {
  if (percent >= 100) return { code: "day_exhausted", label: "Daily shared AI limit reached", percent: 100 };
  if (percent >= 95) return { code: "day_95", label: "95% of today's shared AI limit used", percent: 95 };
  if (percent >= 80) return { code: "day_80", label: "80% of today's shared AI limit used", percent: 80 };
  if (percent >= 50) return { code: "day_50", label: "50% of today's shared AI limit used", percent: 50 };
  return null;
}

function usageSnapshot(value, now) {
  const hour = normalizeBucket(value?.hour, 60 * 60 * 1000, now);
  const day = normalizeBucket(value?.day, 24 * 60 * 60 * 1000, now);
  const hourlyCount = Math.min(HOURLY_LIMIT, hour.count);
  const dailyCount = Math.min(DAILY_LIMIT, day.count);
  const dailyPercent = Math.min(100, Math.round((dailyCount / DAILY_LIMIT) * 100));

  return {
    hourly: {
      count: hourlyCount,
      limit: HOURLY_LIMIT,
      remaining: Math.max(0, HOURLY_LIMIT - hourlyCount),
      percent: Math.min(100, Math.round((hourlyCount / HOURLY_LIMIT) * 100)),
      resetAt: hour.resetAt,
    },
    daily: {
      count: dailyCount,
      limit: DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - dailyCount),
      percent: dailyPercent,
      resetAt: day.resetAt,
      warning: dailyWarning(dailyPercent),
    },
  };
}

async function enforceRateLimit(uid) {
  const now = Date.now();
  const ref = admin.database().ref(`rateLimits/ai/${uid}`);

  const result = await ref.transaction((current) => {
    const hour = normalizeBucket(current?.hour, 60 * 60 * 1000, now);
    const day = normalizeBucket(current?.day, 24 * 60 * 60 * 1000, now);

    if (hour.count >= HOURLY_LIMIT || day.count >= DAILY_LIMIT) return;

    return {
      hour: {
        ...hour,
        count: hour.count + 1,
        limit: HOURLY_LIMIT,
        updatedAt: now,
      },
      day: {
        ...day,
        count: day.count + 1,
        limit: DAILY_LIMIT,
        updatedAt: now,
      },
    };
  }, undefined, false);

  const usage = usageSnapshot(result.snapshot.val(), now);
  if (!result.committed) {
    const code = usage.daily.remaining <= 0 ? "daily_limit" : "hourly_limit";
    return { ok: false, code, usage };
  }

  return { ok: true, usage };
}

async function callGroq({ apiKey, systemPrompt, messages, maxTokens }) {
  if (!apiKey) throw new Error("groq_not_configured");
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.8,
    }),
  });

  if (!response.ok) throw new Error(`groq_${response.status}`);
  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || "";
  if (!reply) throw new Error("groq_empty");
  return reply;
}

async function callGemini({ apiKey, systemPrompt, messages, maxTokens }) {
  if (!apiKey) throw new Error("gemini_not_configured");

  let contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
  while (contents.length > 0 && contents[0].role !== "user") contents.shift();
  if (contents.length === 0) {
    contents = [{ role: "user", parts: [{ text: "Hello" }] }];
  }

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: maxTokens,
      },
    }),
  });

  if (!response.ok) throw new Error(`gemini_${response.status}`);
  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!reply) throw new Error("gemini_empty");
  return reply;
}

exports.aiProxy = onRequest({
  region: "europe-west1",
  secrets: [groqSecret, geminiSecret],
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (req, res) => {
  if (req.method === "OPTIONS") return noContent(res);
  if (req.method !== "POST") return json(res, 405, { code: "method_not_allowed" });

  try {
    const token = getBearerToken(req);
    if (!token) return json(res, 401, { code: "auth_required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const limit = await enforceRateLimit(decoded.uid);
    if (!limit.ok) return json(res, 429, { code: limit.code, usage: limit.usage });

    const payload = parseRequestBody(req);
    const groqKey = groqSecret.value() || "";
    const geminiKey = geminiSecret.value() || "";

    try {
      const reply = await callGroq({ apiKey: groqKey, ...payload });
      return json(res, 200, { reply, provider: "groq", usage: limit.usage });
    } catch (groqError) {
      console.warn("Groq AI failed; trying Gemini fallback", groqError?.message || groqError);
      const reply = await callGemini({ apiKey: geminiKey, ...payload });
      return json(res, 200, { reply, provider: "gemini", usage: limit.usage });
    }
  } catch (error) {
    console.error("AI proxy failed", error?.message || error);
    const code = error?.message || "ai_proxy_failed";
    const status = code.startsWith("invalid") || code.startsWith("missing") || code === "empty_message" ? 400 : 500;
    return json(res, status, { code });
  }
});
