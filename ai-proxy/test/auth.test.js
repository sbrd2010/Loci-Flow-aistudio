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

  it("refetches the keys when a token names a key it has not seen (rotation)", async () => {
    await verifyFirebaseToken(await signer.sign(), PROJECT, { fetchImpl });
    const rotated = await makeSigner("kid-2");
    fetchImpl.mockImplementation(async () => jwksResponse(rotated.jwk));
    await expect(verifyFirebaseToken(await rotated.sign(), PROJECT, { fetchImpl })).resolves.toMatchObject({ sub: "user-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["another project's audience", { aud: "other-project" }],
    ["another project's issuer", { iss: "https://securetoken.google.com/other-project" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["a token issued in the future", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["a sign-in in the future", { auth_time: Math.floor(Date.now() / 1000) + 3600 }],
    ["an empty subject", { sub: "" }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(verifyFirebaseToken(await signer.sign(overrides), PROJECT, { fetchImpl })).rejects.toThrow();
  });

  it("rejects a token signed by a key Google does not list", async () => {
    const stranger = await makeSigner();
    await expect(verifyFirebaseToken(await stranger.sign(), PROJECT, { fetchImpl })).rejects.toThrow("bad signature");
  });

  it("rejects a token whose claims were changed after signing", async () => {
    const [h, , s] = (await signer.sign()).split(".");
    const forged = btoa(JSON.stringify({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "someone-else", iat: 1, auth_time: 1, exp: 9999999999 })).replace(/=+$/, "");
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
