// Loci AI relay. NVIDIA's API refuses browser calls (no CORS, #356),
// Cloudflare's own models are reached through the Worker's AI binding, and the
// owner's OpenRouter key must not sit in the app's public code, so the app sends
// those providers' requests here. Only a signed-in Loci user gets through; the
// keys never leave the Worker. Prompts and replies are
// passed on, never logged or stored.
//
//   POST /nvidia      → NVIDIA's OpenAI-style chat endpoint
//   POST /openrouter  → OpenRouter, free models only, with the owner's key
//   POST /cloudflare  → env.AI.run (Workers AI)
//
// Both answer in the OpenAI chat-completions shape the app already reads.

import { verifyFirebaseToken } from "./auth.js";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_NVIDIA_MODEL = "openai/gpt-oss-120b";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// OpenRouter's own router that always picks a free model that exists (#568).
const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
const RELAY_PATHS = new Set(["nvidia", "openrouter", "cloudflare"]);
const DEFAULT_CLOUDFLARE_MODEL = "@cf/openai/gpt-oss-120b";
const MAX_BODY_CHARS = 200_000;
const MAX_MESSAGES = 100;
// The app's largest ask (Mind Box, and the retry after a cut-off reply) is 4,000.
const MAX_TOKENS_CAP = 4000;
const ROLES = new Set(["system", "user", "assistant"]);
const EFFORTS = new Set(["low", "medium", "high"]);

// The token is the gate, not the origin, so any origin may call.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const isGptOss = (model) => /(^|\/)gpt-oss/i.test(model);

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...extraHeaders } });
}

// Same shape as an OpenAI error, so the app's failedResponse() reads the reason.
const fail = (status, message, extraHeaders) => json(status, { error: { message } }, extraHeaders);

const secondsUntilUtcMidnight = (now = Date.now()) => {
  const d = new Date(now);
  return String(Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000)));
};

// Keeps only the fields the relay passes on, with the values clamped.
export function cleanParams(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  if (!messages.every(m => ROLES.has(m?.role) && typeof m.content === "string")) return null;
  const params = { messages: messages.map(({ role, content }) => ({ role, content })) };
  const maxTokens = Math.floor(Number(body.max_tokens));
  params.max_tokens = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, MAX_TOKENS_CAP) : 300;
  if (EFFORTS.has(body.reasoning_effort)) params.reasoning_effort = body.reasoning_effort;
  const temperature = Number(body.temperature);
  if (body.temperature != null && Number.isFinite(temperature)) params.temperature = Math.min(Math.max(temperature, 0), 2);
  const topP = Number(body.top_p);
  if (body.top_p != null && Number.isFinite(topP)) params.top_p = Math.min(Math.max(topP, 0), 1);
  return params;
}

// reasoning_effort only goes to a gpt-oss model; another model may reject it.
function forModel(params, model) {
  const { reasoning_effort: effort, ...rest } = params;
  return effort && isGptOss(model) ? { ...rest, reasoning_effort: effort } : rest;
}

// Forwards an OpenAI-style request with a key held on the Worker.
async function relayUpstream(label, url, key, payload, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...payload, stream: false }),
    });
  } catch {
    return fail(502, `The relay could not reach ${label}.`);
  }
  const extra = res.headers.get("Retry-After") ? { "Retry-After": res.headers.get("Retry-After") } : {};
  if (res.ok) return new Response(await res.text(), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

  let reason = "";
  try {
    const body = await res.json();
    reason = String(body?.error?.message ?? body?.detail ?? body?.message ?? body?.error ?? "");
  } catch { /* not JSON */ }
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 200) || `HTTP ${res.status}`;
  // The app reads 401/403 from the relay as "not signed in to Loci"; the
  // provider refusing the relay's own key is a relay problem, not the user's.
  if (res.status === 401 || res.status === 403) return fail(502, `${label} refused the relay's key (${reason})`);
  return fail(res.status, reason, extra);
}

function relayNvidia(params, env, fetchImpl) {
  if (!env.NVIDIA_API_KEY) return fail(503, "NVIDIA is not set up on the relay yet (NVIDIA_API_KEY missing).");
  const model = env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL;
  return relayUpstream("NVIDIA", NVIDIA_URL, env.NVIDIA_API_KEY, { model, ...forModel(params, model) }, fetchImpl);
}

// Free models only, so the owner's key can never be billed through the relay,
// even if credit is added to the account later.
const isFreeOpenRouterModel = (model) => model === DEFAULT_OPENROUTER_MODEL || /:free$/.test(model);

function relayOpenRouter(params, env, fetchImpl) {
  if (!env.OPENROUTER_API_KEY) return fail(503, "OpenRouter is not set up on the relay yet (OPENROUTER_API_KEY missing).");
  const model = isFreeOpenRouterModel(env.OPENROUTER_MODEL || "") ? env.OPENROUTER_MODEL : DEFAULT_OPENROUTER_MODEL;
  // OpenRouter takes a reasoning object rather than reasoning_effort.
  const { reasoning_effort: effort, ...rest } = params;
  const payload = { model, ...rest, ...(effort && isGptOss(model) ? { reasoning: { effort } } : {}) };
  return relayUpstream("OpenRouter", OPENROUTER_URL, env.OPENROUTER_API_KEY, payload, fetchImpl);
}

// Workers AI answers gpt-oss in the chat-completions shape; other models may
// answer { response } or { output_text }, so those are wrapped to match.
function toChatCompletion(out, model) {
  if (Array.isArray(out?.choices)) return out;
  const content = typeof out?.response === "string" ? out.response : typeof out?.output_text === "string" ? out.output_text : "";
  return { object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: out?.usage };
}

async function runCloudflare(params, env) {
  if (!env.AI) return fail(503, "Cloudflare AI is not set up on the relay (no AI binding).");
  const model = env.CLOUDFLARE_MODEL || DEFAULT_CLOUDFLARE_MODEL;
  try {
    const out = await env.AI.run(model, forModel(params, model));
    return json(200, toChatCompletion(out, model));
  } catch (err) {
    const reason = String(err?.message || err).replace(/\s+/g, " ").trim().slice(0, 200);
    // The free plan stops at 10,000 neurons a day and resets at 00:00 UTC.
    if (/4006|daily free allocation|neurons/i.test(reason)) {
      return fail(429, "Cloudflare's free daily AI allowance is used up; it resets at 00:00 UTC.", { "Retry-After": secondsUntilUtcMidnight() });
    }
    return fail(502, `Cloudflare AI failed (${reason || "no reason given"})`);
  }
}

export default {
  async fetch(request, env, ctx, { fetchImpl = fetch } = {}) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const provider = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
    if (!RELAY_PATHS.has(provider)) return fail(404, "Not found.");
    if (request.method !== "POST") return fail(405, "Use POST.");
    if (!env.FIREBASE_PROJECT_ID) return fail(503, "The relay is not set up yet (FIREBASE_PROJECT_ID missing).");

    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    try {
      await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID, { fetchImpl });
    } catch (err) {
      // Google's key list unreachable is an outage, not a bad sign-in.
      if (/^Google key request failed/.test(err?.message)) return fail(503, "The relay could not check your sign-in right now.");
      return fail(401, "Sign in to Loci to use this provider.");
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return fail(413, "Request too large for the relay.");
    let body;
    try { body = JSON.parse(raw); } catch { return fail(400, "Body must be JSON."); }
    const params = cleanParams(body);
    if (!params) return fail(400, "messages must be a non-empty list of { role, content }.");

    if (provider === "nvidia") return relayNvidia(params, env, fetchImpl);
    if (provider === "openrouter") return relayOpenRouter(params, env, fetchImpl);
    return runCloudflare(params, env);
  },
};
