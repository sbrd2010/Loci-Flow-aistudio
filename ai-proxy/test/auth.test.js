import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyFirebaseToken, resetKeyCache } from "../src/auth.js";
import { PROJECT, makeSigner, jwksResponse } from "./helpers.js";

describe("verifyFirebaseToken", () => {
  let signer;
  let fetchImpl;
  beforeEach(async () => {
    resetKeyCache();
    signer = await makeSigner();
    fetchImpl = vi.fn(async () => jwksResponse(signer.jwk));
  });

  it("accepts a valid token and returns its claims", async () => {
    const claims = await verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl });
    expect(claims.sub).toBe("user-1");
  });

  it("caches Google's keys between calls", async () => {
    await verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl });
    await verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches the keys when a token names a key it has not seen (rotation), at most once a minute", async () => {
    await verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl });
    const rotated = await makeSigner("kid-2");
    fetchImpl.mockImplementation(async () => jwksResponse(rotated.jwk));
    // Within the minute: no refetch, so a made-up kid cannot make the Worker fetch every time.
    await expect(verifyFirebaseToken(await rotated.sign(), PROJECT, { fetchImpl })).rejects.toThrow("unknown key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(verifyFirebaseToken(await rotated.sign(), PROJECT, { fetchImpl, now: Date.now() + 61_000 })).resolves.toMatchObject({ sub: "user-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps using the last good keys when Google is down after they expire", async () => {
    await verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl });
    fetchImpl.mockImplementation(async () => new Response("down", { status: 503 }));
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const token = await signer.sign({ exp: Math.floor(later / 1000) + 600 });
    await expect(verifyFirebaseToken(token, PROJECT, { fetchImpl, now: later })).resolves.toMatchObject({ sub: "user-1" });
  });

  it("skips a key it cannot use instead of failing every sign-in", async () => {
    const odd = { kty: "RSA", kid: "odd", alg: "RS512", n: "x", e: "AQAB" };
    const broken = { kty: "RSA", kid: "broken", n: "!!", e: "!!" };
    fetchImpl.mockImplementation(async () => jwksResponse(odd, broken, signer.jwk));
    await expect(verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl })).resolves.toMatchObject({ sub: "user-1" });
  });

  it("treats an unreadable key list as an outage, not a bad sign-in", async () => {
    fetchImpl.mockImplementation(async () => new Response("<html>", { status: 200 }));
    await expect(verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl })).rejects.toThrow(/^Google key request failed/);
  });

  it.each([
    ["another project's audience", { aud: "other-project" }],
    ["another project's issuer", { iss: "https://securetoken.google.com/other-project" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["a token issued in the future", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["a sign-in in the future", { auth_time: Math.floor(Date.now() / 1000) + 3600 }],
    ["an empty subject", { sub: "" }],
    ["an anonymous sign-in", { firebase: { sign_in_provider: "anonymous" } }],
    ["an email sign-in", { firebase: { sign_in_provider: "password" } }],
    ["a token with no sign-in method", { firebase: undefined }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(verifyFirebaseToken(await signer.sign(overrides), PROJECT, { fetchImpl })).rejects.toThrow();
  });

  it("rejects a token signed by a key Google does not list", async () => {
    const stranger = await makeSigner();
    await expect(verifyFirebaseToken(await stranger.sign(), PROJECT, { fetchImpl })).rejects.toThrow("bad signature");
  });

  it("rejects a token whose claims were changed after signing", async () => {
    const [h, , s] = (await signer.sign()).split(".");
    const forged = btoa(JSON.stringify({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "someone-else", iat: 1, auth_time: 1, exp: 9999999999, firebase: { sign_in_provider: "google.com" } })).replace(/=+$/, "");
    await expect(verifyFirebaseToken(`${h}.${forged}.${s}`, PROJECT, { fetchImpl })).rejects.toThrow("bad signature");
  });

  it("rejects a token that is not RS256", async () => {
    await expect(verifyFirebaseToken(await signer.sign({}, { alg: "HS256" }), PROJECT, { fetchImpl })).rejects.toThrow("wrong algorithm");
  });

  it.each([["", "empty"], ["a.b", "two parts"], ["%%%.%%%.%%%", "garbage"]])("rejects a malformed token (%s, %s)", async (token) => {
    await expect(verifyFirebaseToken(token, PROJECT, { fetchImpl })).rejects.toThrow();
  });

  it("says so when Google's key server cannot be reached at all", async () => {
    fetchImpl.mockImplementation(async () => { throw new TypeError("fetch failed"); });
    await expect(verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl })).rejects.toThrow(/^Google key request failed/);
  });

  it("says so when Google's key list cannot be fetched", async () => {
    fetchImpl.mockImplementation(async () => new Response("down", { status: 500 }));
    await expect(verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl })).rejects.toThrow(/^Google key request failed/);
  });
});
