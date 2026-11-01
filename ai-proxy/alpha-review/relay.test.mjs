// Audit evidence, deliberately outside the unit-test glob. No live AI calls.
// Run: node --test ai-proxy/alpha-review/relay.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeLedger } from "../test/ledgerHarness.js";
import { resetKeyCache } from "../src/auth.js";
import { PROJECT, JWKS_URL, makeSigner, jwksResponse } from "../test/helpers.js";

test("direct requests are bounded by the server budget without browser counters", async () => {
  resetKeyCache();
  const signer = await makeSigner();
  const token = await signer.sign();
  let upstreamCalls = 0;
  const env = {
    FIREBASE_PROJECT_ID: PROJECT, AI_ALLOWED_EMAILS: "tester@example.test",
    AI_TOKEN_LEDGER: makeLedger({ AI_USER_DAILY_TOKENS: 100, AI_POOL_DAILY_TOKENS: 100 }),
    AI: { run: async () => { upstreamCalls++; return { response: "Synthetic answer", usage: { total_tokens: 20 } }; } },
  };
  const fetchImpl = async url => {
    assert.equal(url, JWKS_URL, "only the fake key endpoint may be fetched");
    return jwksResponse(signer.jwk);
  };
  for (let i = 0; i < 121; i++) {
    const res = await worker.fetch(new Request("https://review.invalid/cloudflare", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Synthetic review" }], max_tokens: 1 }),
    }), env, {}, { fetchImpl });
    assert.equal(res.status, i < 5 ? 200 : 429);
  }
  assert.equal(upstreamCalls, 5, "only reservations that fit may reach shared AI");
});

test("caller cannot select a paid model or inject an upstream URL", async () => {
  resetKeyCache();
  const signer = await makeSigner();
  const token = await signer.sign();
  let sent;
  const res = await worker.fetch(new Request("https://review.invalid/openrouter", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Synthetic review" }],
      model: "paid-model", url: "http://169.254.169.254/", max_tokens: 99999,
    }),
  }), { FIREBASE_PROJECT_ID: PROJECT, AI_ALLOWED_EMAILS: "tester@example.test", AI_TOKEN_LEDGER: makeLedger(), OPENROUTER_API_KEY: "synthetic-server-key" }, {}, {
    fetchImpl: async (url, init) => {
      if (url === JWKS_URL) return jwksResponse(signer.jwk);
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      sent = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: "Synthetic answer" } }] });
    },
  });
  assert.equal(res.status, 200);
  assert.equal(sent.max_tokens, 4000);
  assert.equal(sent.url, undefined);
  assert.ok(sent.models.every(model => model === "openrouter/free" || model.endsWith(":free")));
});
