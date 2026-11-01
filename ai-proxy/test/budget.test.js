import { beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { resetKeyCache } from "../src/auth.js";
import { PROJECT, JWKS_URL, makeSigner, jwksResponse } from "./helpers.js";

let signer, fetchImpl;
const EMAIL = "tester@example.test";
const baseEnv = { FIREBASE_PROJECT_ID: PROJECT, GROQ_API_KEY: "synthetic-groq-key", AI_ALLOWED_EMAILS: EMAIL };
const denyBudget = { idFromName: () => "only-ledger", get: () => ({ fetch: async () => Response.json({ code: "daily_cap", remaining: 0 }, { status: 429 }) }) };
async function call({ claims = {}, env = {}, provider = "groq" } = {}) {
  const token = await signer.sign({ email: EMAIL, email_verified: true, ...claims });
  return worker.fetch(new Request(`https://relay.example.test/${provider}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Synthetic prompt" }], max_tokens: 10 }),
  }), { ...baseEnv, AI_TOKEN_LEDGER: denyBudget, ...env }, {}, { fetchImpl });
}
beforeEach(async () => {
  resetKeyCache(); signer = await makeSigner();
  fetchImpl = vi.fn(async url => url === JWKS_URL ? jwksResponse(signer.jwk) : Response.json({ choices: [{ message: { content: "Synthetic reply" } }], usage: { total_tokens: 8 } }));
});
it("enforces the server budget before calling any provider", async () => {
  const res = await call();
  expect(res.status).toBe(429);
  expect((await res.json()).error.code).toBe("daily_cap");
  expect(fetchImpl.mock.calls.filter(([url]) => url !== JWKS_URL)).toHaveLength(0);
});
it("refuses a verified Google account outside the alpha allowlist", async () => {
  expect((await call({ claims: { email: "uninvited@example.test" } })).status).toBe(403);
});
it("does not accept an unverified allowlisted email", async () => {
  expect((await call({ claims: { email_verified: false } })).status).toBe(403);
});
it("fails closed when the allowlist or ledger is missing", async () => {
  expect((await call({ env: { AI_ALLOWED_EMAILS: "" } })).status).toBe(501);
  expect((await call({ env: { AI_TOKEN_LEDGER: null } })).status).toBe(501);
});

// The following checks use the production ledger and real SQLite, rather than
// a mock counter, including requests while an upstream response is pending.
it("shares a user's budget across providers and settles actual usage", async () => {
  const { makeLedger } = await import("./ledgerHarness.js");
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 1000 });
  const env = { AI_TOKEN_LEDGER: ledger };
  fetchImpl.mockImplementation(async url => url === JWKS_URL ? jwksResponse(signer.jwk) : Response.json({ usage: { total_tokens: 90 } }));
  const first = await call({ env });
  expect(first.status).toBe(200);
  expect(first.headers.get("X-Loci-Remaining-Tokens")).toBe("10");
  expect((await call({ env, provider: "cloudflare" })).status).toBe(429);
});
it("refunds failed provider requests", async () => {
  const { makeLedger } = await import("./ledgerHarness.js");
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 30, AI_POOL_DAILY_TOKENS: 30 });
  fetchImpl.mockImplementation(async url => url === JWKS_URL ? jwksResponse(signer.jwk) : Response.json({ error: { message: "Busy" } }, { status: 429 }));
  const env = { AI_TOKEN_LEDGER: ledger };
  for (let i = 0; i < 3; i++) {
    const res = await call({ env });
    expect(res.status).toBe(429);
    expect((await res.json()).error).not.toHaveProperty("code");
    expect(res.headers.get("X-Loci-Remaining-Tokens")).toBe("30");
  }
});
it("fails closed on a ledger outage and never contacts a provider", async () => {
  const ledger = { idFromName: () => "one", get: () => ({ fetch: async () => { throw new Error("Ledger offline"); } }) };
  const res = await call({ env: { AI_TOKEN_LEDGER: ledger } });
  expect(res.status).toBe(503);
  expect((await res.json()).error.code).toBe("quota_unavailable");
  expect(fetchImpl.mock.calls.filter(([url]) => url !== JWKS_URL)).toHaveLength(0);
});
it("reserves before forwarding, so concurrent relay requests cannot all pass", async () => {
  const { makeLedger } = await import("./ledgerHarness.js");
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 30, AI_POOL_DAILY_TOKENS: 1000 });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started = 0;
  fetchImpl.mockImplementation(async url => {
    if (url === JWKS_URL) return jwksResponse(signer.jwk);
    started++; await pending;
    return Response.json({ usage: { total_tokens: 5 } });
  });
  const first = call({ env: { AI_TOKEN_LEDGER: ledger } });
  await vi.waitFor(() => expect(started).toBe(1));
  const second = await call({ env: { AI_TOKEN_LEDGER: ledger } });
  expect(second.status).toBe(429);
  expect(started).toBe(1);
  release(); expect((await first).status).toBe(200);
});
it("does not reset a person's budget when their Firebase UID changes", async () => {
  const { makeLedger } = await import("./ledgerHarness.js");
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 1000 });
  fetchImpl.mockImplementation(async url => url === JWKS_URL ? jwksResponse(signer.jwk) : Response.json({ usage: { total_tokens: 90 } }));
  const env = { AI_TOKEN_LEDGER: ledger };
  expect((await call({ env, claims: { sub: "original-uid" } })).status).toBe(200);
  expect((await call({ env, claims: { sub: "recreated-uid" } })).status).toBe(429);
});
it("reports the shared pool shortage to a different invited person", async () => {
  const { makeLedger } = await import("./ledgerHarness.js");
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 1000, AI_POOL_DAILY_TOKENS: 100 });
  fetchImpl.mockImplementation(async url => url === JWKS_URL ? jwksResponse(signer.jwk) : Response.json({ usage: { total_tokens: 90 } }));
  const env = { AI_TOKEN_LEDGER: ledger, AI_ALLOWED_EMAILS: `${EMAIL}, second@example.test` };
  expect((await call({ env })).status).toBe(200);
  const res = await call({ env, claims: { email: "second@example.test", sub: "second-user" } });
  expect((await res.json()).error.code).toBe("pool_empty");
});
it("settles Gemini-style usage metadata as well as OpenAI usage", async () => {
  const { makeLedger } = await import("./ledgerHarness.js");
  const ledger = makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 1000 });
  fetchImpl.mockImplementation(async url => url === JWKS_URL ? jwksResponse(signer.jwk) : Response.json({ usageMetadata: { totalTokenCount: 30 } }));
  const res = await call({ provider: "gemini", env: { AI_TOKEN_LEDGER: ledger, GEMINI_API_KEY: "synthetic-key" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("X-Loci-Remaining-Tokens")).toBe("70");
});
