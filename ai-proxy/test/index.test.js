import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { cleanParams } from "../src/index.js";
import { resetKeyCache } from "../src/auth.js";
import { PROJECT, JWKS_URL, makeSigner, jwksResponse } from "./helpers.js";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const BODY = { messages: [{ role: "system", content: "You are a coach." }, { role: "user", content: "Hi" }], max_tokens: 300, reasoning_effort: "low", temperature: 0.4, top_p: 0.9 };
const OK_REPLY = { choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: { total_tokens: 12 } };

let signer;
let upstream; // NVIDIA's answer for the next call
let fetchImpl;

function call(path, { token, body = BODY, method = "POST", env = {} } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request(`https://loci-ai.example.workers.dev${path}`, { method, headers, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
  return worker.fetch(request, { FIREBASE_PROJECT_ID: PROJECT, NVIDIA_API_KEY: "nvapi-test", ...env }, {}, { fetchImpl });
}

beforeEach(async () => {
  resetKeyCache();
  signer = await makeSigner();
  upstream = () => new Response(JSON.stringify(OK_REPLY), { status: 200 });
  fetchImpl = vi.fn(async (url) => (url === JWKS_URL ? jwksResponse(signer.jwk) : upstream()));
});

describe("routing and CORS", () => {
  it("answers a preflight with CORS headers", async () => {
    const res = await call("/nvidia", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("Retry-After");
  });

  it("refuses unknown paths and other methods", async () => {
    expect((await call("/groq", { token: await signer.sign() })).status).toBe(404);
    expect((await call("/nvidia", { method: "GET" })).status).toBe(405);
  });

  it("says it is not set up when the project id is missing", async () => {
    expect((await call("/nvidia", { token: await signer.sign(), env: { FIREBASE_PROJECT_ID: "" } })).status).toBe(501);
  });

  it("answers an unexpected crash with a 502 that still has CORS headers", async () => {
    upstream = () => ({ ok: true, headers: new Headers(), text: async () => { throw new Error("stream broke"); } });
    const res = await call("/nvidia", { token: await signer.sign() });
    expect(res.status).toBe(502);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("sign-in check", () => {
  it("refuses a request with no token, before reaching NVIDIA", async () => {
    const res = await call("/nvidia");
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/Sign in to Loci/);
    expect(fetchImpl).not.toHaveBeenCalledWith(NVIDIA_URL, expect.anything());
  });

  it("refuses a token for another project", async () => {
    expect((await call("/cloudflare", { token: await signer.sign({ aud: "x", iss: "https://securetoken.google.com/x" }) })).status).toBe(401);
  });

  it("answers 503, not 401, when Google's keys cannot be fetched", async () => {
    fetchImpl.mockImplementation(async () => new Response("down", { status: 500 }));
    expect((await call("/nvidia", { token: await signer.sign() })).status).toBe(503);
  });
});

describe("request checks", () => {
  it("refuses a body that is not JSON or has no messages", async () => {
    const token = await signer.sign();
    expect((await call("/nvidia", { token, body: "not json" })).status).toBe(400);
    expect((await call("/nvidia", { token, body: { messages: [] } })).status).toBe(400);
    expect((await call("/nvidia", { token, body: { messages: [{ role: "tool", content: "x" }] } })).status).toBe(400);
  });

  it("refuses an oversized body", async () => {
    const big = { messages: [{ role: "user", content: "x".repeat(200_001) }] };
    expect((await call("/nvidia", { token: await signer.sign(), body: big })).status).toBe(413);
  });

  it("keeps only known fields and clamps them", () => {
    const params = cleanParams({ ...BODY, max_tokens: 99999, temperature: 7, top_p: -1, model: "expensive-model", stream: true, reasoning_effort: "max", messages: [{ role: "user", content: "a", name: "x" }] });
    expect(params).toEqual({ messages: [{ role: "user", content: "a" }], max_tokens: 4000, temperature: 2, top_p: 0 });
    expect(cleanParams({ messages: [{ role: "user", content: "a" }] }).max_tokens).toBe(300);
  });
});

describe("NVIDIA", () => {
  it("forwards to NVIDIA with the server key and the pinned model, and returns the reply", async () => {
    const res = await call("/nvidia", { token: await signer.sign(), body: { ...BODY, model: "someone-elses-model" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OK_REPLY);
    const [, init] = fetchImpl.mock.calls.find(([url]) => url === NVIDIA_URL);
    expect(init.headers.Authorization).toBe("Bearer nvapi-test");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ model: "openai/gpt-oss-120b", max_tokens: 300, reasoning_effort: "low", stream: false });
    expect(sent.messages).toHaveLength(2);
  });

  it("uses NVIDIA_MODEL when set, without reasoning_effort for a non-gpt-oss model", async () => {
    await call("/nvidia", { token: await signer.sign(), env: { NVIDIA_MODEL: "meta/llama-3.3-70b-instruct" } });
    const sent = JSON.parse(fetchImpl.mock.calls.find(([url]) => url === NVIDIA_URL)[1].body);
    expect(sent.model).toBe("meta/llama-3.3-70b-instruct");
    expect(sent).not.toHaveProperty("reasoning_effort");
  });

  it("says NVIDIA is not set up when the key is missing", async () => {
    const res = await call("/nvidia", { token: await signer.sign(), env: { NVIDIA_API_KEY: "" } });
    expect(res.status).toBe(501);
    expect((await res.json()).error.message).toMatch(/NVIDIA_API_KEY/);
  });

  it("passes a rate limit through with its Retry-After and reason", async () => {
    upstream = () => new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429, headers: { "Retry-After": "30" } });
    const res = await call("/nvidia", { token: await signer.sign() });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect((await res.json()).error.message).toBe("Too many requests");
  });

  it("turns NVIDIA refusing the relay's key into 502, so the app does not read it as a sign-in problem", async () => {
    upstream = () => new Response(JSON.stringify({ detail: "Invalid API key" }), { status: 401 });
    const res = await call("/nvidia", { token: await signer.sign() });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/refused the relay's key \(Invalid API key\)/);
  });

  it("never echoes the key back, even if the provider's error contains it", async () => {
    upstream = () => new Response(JSON.stringify({ error: { message: "Key nvapi-test is not valid" } }), { status: 401 });
    const text = await (await call("/nvidia", { token: await signer.sign() })).text();
    expect(text).not.toContain("nvapi-test");
    expect(text).toContain("[key]");
  });

  it("labels the provider's 403 as a refused request, not a refused key", async () => {
    upstream = () => new Response(JSON.stringify({ error: { message: "Input flagged by moderation" } }), { status: 403 });
    const res = await call("/nvidia", { token: await signer.sign() });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toBe("NVIDIA refused the request (Input flagged by moderation)");
  });

  it("answers 502 with CORS headers when NVIDIA cannot be reached", async () => {
    upstream = () => { throw new TypeError("fetch failed"); };
    const res = await call("/nvidia", { token: await signer.sign() });
    expect(res.status).toBe(502);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("passes a withdrawn model's status through with a reason", async () => {
    upstream = () => new Response("gone", { status: 410 });
    const res = await call("/nvidia", { token: await signer.sign() });
    expect(res.status).toBe(410);
    expect((await res.json()).error.message).toBe("HTTP 410");
  });
});

describe("OpenRouter", () => {
  const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
  const sentTo = () => JSON.parse(fetchImpl.mock.calls.find(([url]) => url === OPENROUTER_URL)[1].body);

  it("forwards to OpenRouter with the server key and its free router", async () => {
    const res = await call("/openrouter", { token: await signer.sign(), env: { OPENROUTER_API_KEY: "sk-or-test" } });
    expect(res.status).toBe(200);
    const [, init] = fetchImpl.mock.calls.find(([url]) => url === OPENROUTER_URL);
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
    expect(sentTo()).toMatchObject({ model: "openrouter/free", stream: false });
    expect(sentTo()).not.toHaveProperty("reasoning_effort");
    expect(sentTo()).not.toHaveProperty("reasoning");
  });

  it("uses a pinned free model, with OpenRouter's reasoning object for gpt-oss", async () => {
    await call("/openrouter", { token: await signer.sign(), env: { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "openai/gpt-oss-20b:free" } });
    expect(sentTo()).toMatchObject({ model: "openai/gpt-oss-20b:free", reasoning: { effort: "low" } });
  });

  it("never uses a paid model, even if one is configured", async () => {
    await call("/openrouter", { token: await signer.sign(), env: { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "openai/gpt-oss-120b" } });
    expect(sentTo().model).toBe("openrouter/free");
  });

  it("says OpenRouter is not set up when the key is missing", async () => {
    const res = await call("/openrouter", { token: await signer.sign() });
    expect(res.status).toBe(501);
    expect((await res.json()).error.message).toMatch(/OPENROUTER_API_KEY/);
  });

  it("turns OpenRouter refusing the relay's key into 502", async () => {
    upstream = () => new Response(JSON.stringify({ error: { message: "No auth credentials found" } }), { status: 401 });
    const res = await call("/openrouter", { token: await signer.sign(), env: { OPENROUTER_API_KEY: "k" } });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/^OpenRouter refused the relay's key/);
  });
});

describe("Cloudflare Workers AI", () => {
  const aiWith = (impl) => ({ run: vi.fn(impl) });

  it("runs the pinned model with the cleaned request and returns its chat completion", async () => {
    const AI = aiWith(async () => OK_REPLY);
    const res = await call("/cloudflare", { token: await signer.sign(), env: { AI } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OK_REPLY);
    expect(AI.run).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b", expect.objectContaining({ max_tokens: 300, reasoning_effort: "low" }));
  });

  it("wraps a { response } answer from another model into a chat completion", async () => {
    const AI = aiWith(async () => ({ response: "Hi there", usage: { total_tokens: 5 } }));
    const res = await call("/cloudflare", { token: await signer.sign(), env: { AI, CLOUDFLARE_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" } });
    const data = await res.json();
    expect(data.choices[0].message.content).toBe("Hi there");
    expect(AI.run.mock.calls[0][1]).not.toHaveProperty("reasoning_effort");
  });

  it("reads a Responses-style answer (output items) into a chat completion", async () => {
    const AI = aiWith(async () => ({ output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "thinking" }] }, { type: "message", content: [{ type: "output_text", text: "Hi " }, { type: "output_text", text: "there" }] }] }));
    const data = await (await call("/cloudflare", { token: await signer.sign(), env: { AI } })).json();
    expect(data.choices[0].message.content).toBe("Hi there");
  });

  it("answers 429 with a Retry-After when the free daily allowance is used up", async () => {
    const AI = aiWith(async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); });
    const res = await call("/cloudflare", { token: await signer.sign(), env: { AI } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("Retry-After"))).toBeLessThanOrEqual(86400);
  });

  it("answers 502 with the reason for any other failure", async () => {
    const AI = aiWith(async () => { throw new Error("model overloaded"); });
    const res = await call("/cloudflare", { token: await signer.sign(), env: { AI } });
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/model overloaded/);
  });

  it("says it is not set up without the AI binding", async () => {
    expect((await call("/cloudflare", { token: await signer.sign() })).status).toBe(501);
  });
});
