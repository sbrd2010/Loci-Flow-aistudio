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
const DAILY_LIMIT = 160;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 6000;
const MAX_SYSTEM_CHARS = 8000;
const MAX_TOKENS = 1000;

admin.initializeApp({ databaseURL: DATABASE_URL });

function json(res, status, body) {
  res.set("Cache-Control", "no-store");
  res.status(status).json(body);
}

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
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

async function consumeBucket(ref, limit, windowMs, now) {
  const result = await ref.transaction((current) => {
    const bucket = current || { count: 0, resetAt: now + windowMs };
    if (!bucket.resetAt || bucket.resetAt <= now) {
      return { count: 1, resetAt: now + windowMs, updatedAt: now };
    }
    if ((Number(bucket.count) || 0) >= limit) return;
    return { ...bucket, count: (Number(bucket.count) || 0) + 1, updatedAt: now };
  }, undefined, false);

  return result.committed;
}

async function enforceRateLimit(uid) {
  const now = Date.now();
  const db = admin.database();
  const hourlyRef = db.ref(`rateLimits/ai/${uid}/hour`);
  const dailyRef = db.ref(`rateLimits/ai/${uid}/day`);

  const hourlyOk = await consumeBucket(hourlyRef, HOURLY_LIMIT, 60 * 60 * 1000, now);
  if (!hourlyOk) return { ok: false, code: "hourly_limit" };

  const dailyOk = await consumeBucket(dailyRef, DAILY_LIMIT, 24 * 60 * 60 * 1000, now);
  if (!dailyOk) return { ok: false, code: "daily_limit" };

  return { ok: true };
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
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST") return json(res, 405, { code: "method_not_allowed" });

  try {
    const token = getBearerToken(req);
    if (!token) return json(res, 401, { code: "auth_required" });

    const decoded = await admin.auth().verifyIdToken(token);
    const limit = await enforceRateLimit(decoded.uid);
    if (!limit.ok) return json(res, 429, { code: limit.code });

    const payload = parseRequestBody(req);
    const groqKey = groqSecret.value() || "";
    const geminiKey = geminiSecret.value() || "";

    try {
      const reply = await callGroq({ apiKey: groqKey, ...payload });
      return json(res, 200, { reply, provider: "groq" });
    } catch (groqError) {
      console.warn("Groq AI failed; trying Gemini fallback", groqError?.message || groqError);
      const reply = await callGemini({ apiKey: geminiKey, ...payload });
      return json(res, 200, { reply, provider: "gemini" });
    }
  } catch (error) {
    console.error("AI proxy failed", error?.message || error);
    const code = error?.message || "ai_proxy_failed";
    const status = code.startsWith("invalid") || code.startsWith("missing") || code === "empty_message" ? 400 : 500;
    return json(res, status, { code });
  }
});
