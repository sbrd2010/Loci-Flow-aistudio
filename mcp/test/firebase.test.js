import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, parseServiceAccount, readUserRecord, resetTokenCache } from "../src/firebase.js";

async function makeAccount() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { pair, json: JSON.stringify({ client_email: "viewer@demo-project.iam.gserviceaccount.com", private_key: pem }) };
}

const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

beforeEach(() => resetTokenCache());

describe("getAccessToken", () => {
  it("signs a JWT Google can verify, with the database scope and a one-hour life", async () => {
    const { pair, json } = await makeAccount();
    const fetchImpl = vi.fn(async () => Response.json({ access_token: "tok-1", expires_in: 3600 }));
    const now = Date.UTC(2026, 9, 22, 6, 0, 0);
    expect(await getAccessToken(json, { fetchImpl, now })).toBe("tok-1");

    const [, init] = fetchImpl.mock.calls[0];
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, s] = body.get("assertion").split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(h)))).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
    expect(claims).toMatchObject({ iss: "viewer@demo-project.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", iat: now / 1000, exp: now / 1000 + 3600 });
    expect(claims.scope).toContain("https://www.googleapis.com/auth/firebase.database");
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, fromB64url(s), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("reuses a token until five minutes before it expires, then asks again", async () => {
    const { json } = await makeAccount();
    const fetchImpl = vi.fn(async () => Response.json({ access_token: "tok", expires_in: 3600 }));
    const now = Date.UTC(2026, 9, 22, 6, 0, 0);
    await getAccessToken(json, { fetchImpl, now });
    await getAccessToken(json, { fetchImpl, now: now + 54 * 60 * 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await getAccessToken(json, { fetchImpl, now: now + 56 * 60 * 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails clearly on a bad key file and on a refused token request", async () => {
    expect(() => parseServiceAccount("not json")).toThrow(/valid JSON/);
    expect(() => parseServiceAccount("{}")).toThrow(/client_email/);
    const { json } = await makeAccount();
    await expect(getAccessToken(json, { fetchImpl: async () => new Response("no", { status: 400 }) })).rejects.toThrow("(400)");
  });
});

describe("readUserRecord", () => {
  const env = (json) => ({ FIREBASE_SERVICE_ACCOUNT: json, FIREBASE_DB_URL: "https://demo-project-default-rtdb.firebaseio.com/" });

  it("GETs sync/{uid}.json with the token in a header, not the URL", async () => {
    const { json } = await makeAccount();
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([String(url), init]);
      return String(url).includes("oauth2") ? Response.json({ access_token: "tok", expires_in: 3600 }) : Response.json({ tasks: [] });
    };
    expect(await readUserRecord(env(json), "abc123", { fetchImpl })).toEqual({ tasks: [] });
    const [url, init] = calls[1];
    expect(url).toBe("https://demo-project-default-rtdb.firebaseio.com/sync/abc123.json");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.method).toBeUndefined(); // a plain GET
  });

  it("refuses a uid that could change the path", async () => {
    const { json } = await makeAccount();
    for (const bad of ["", "../x", "a/b", "a?b=1", "a.json", "x".repeat(129)]) {
      await expect(readUserRecord(env(json), bad, { fetchImpl: vi.fn() })).rejects.toThrow("Invalid user id");
    }
  });

  it("reports a failed read by status only", async () => {
    const { json } = await makeAccount();
    const fetchImpl = async (url) => String(url).includes("oauth2") ? Response.json({ access_token: "tok" }) : new Response("secret body", { status: 403 });
    await expect(readUserRecord(env(json), "abc", { fetchImpl })).rejects.toThrow(/^Database read failed \(403\)\.$/);
  });
});
