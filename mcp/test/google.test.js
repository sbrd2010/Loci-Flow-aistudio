import { describe, expect, it } from "vitest";
import { exchangeGoogleCode, googleAuthorizeUrl, isAllowedUser, s256 } from "../src/google.js";

const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const idToken = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const good = { iss: "https://accounts.google.com", aud: "cid", email: "Owner@Example.com", email_verified: true };
const rule = { clientId: "cid", allowedEmail: "owner@example.com" };

describe("isAllowedUser", () => {
  it("lets the allowed email in, whatever its case", () => {
    expect(isAllowedUser(good, rule)).toBe(true);
    expect(isAllowedUser({ ...good, iss: "accounts.google.com" }, rule)).toBe(true);
  });

  it("refuses every way of not being exactly that user", () => {
    for (const bad of [
      { ...good, email: "someone@example.com" },
      { ...good, email: "owner@example.com.evil.com" },
      { ...good, email_verified: false },
      { ...good, email_verified: "true" },
      { ...good, aud: "other-client" },
      { ...good, iss: "https://evil.example" },
      { ...good, email: undefined },
      null,
    ]) expect(isAllowedUser(bad, rule)).toBe(false);
  });

  it("refuses everyone when no email is configured", () => {
    expect(isAllowedUser({ ...good, email: "" }, { clientId: "cid", allowedEmail: "" })).toBe(false);
  });
});

describe("Google exchange", () => {
  it("sends the code with its PKCE verifier and reads the ID token claims", async () => {
    let sent;
    const claims = await exchangeGoogleCode(
      { code: "c1", verifier: "v1", clientId: "cid", clientSecret: "sec", redirectUri: "https://x.test/callback" },
      async (url, init) => { sent = [url, new URLSearchParams(init.body)]; return Response.json({ id_token: idToken(good) }); },
    );
    expect(claims.email).toBe("Owner@Example.com");
    expect(sent[0]).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(sent[1])).toMatchObject({ code: "c1", code_verifier: "v1", grant_type: "authorization_code", redirect_uri: "https://x.test/callback" });
  });

  it("fails on a refused code and on a response with no ID token", async () => {
    const args = { code: "c", verifier: "v", clientId: "cid", clientSecret: "s", redirectUri: "https://x.test/callback" };
    await expect(exchangeGoogleCode(args, async () => new Response("bad", { status: 400 }))).rejects.toThrow("(400)");
    await expect(exchangeGoogleCode(args, async () => Response.json({}))).rejects.toThrow(/ID token/);
  });
});

describe("PKCE and the sign-in URL", () => {
  it("computes the RFC 7636 example challenge", async () => {
    expect(await s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("asks only for openid and email, with S256", () => {
    const url = new URL(googleAuthorizeUrl({ clientId: "cid", redirectUri: "https://x.test/callback", state: "st", codeChallenge: "ch" }));
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
  });
});
