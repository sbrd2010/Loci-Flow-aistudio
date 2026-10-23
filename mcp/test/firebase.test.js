import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, parseServiceAccount, readFocusEvents, readUserRecord, resetTokenCache } from "../src/firebase.js";

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

  it("GETs only tasks, config and contributions, with the token in a header, not the URL", async () => {
    const { json } = await makeAccount();
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([String(url), init]);
      if (String(url).includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
      return Response.json({ tasks: [{ id: 1 }], config: { a: 1 }, contributions: [] }[String(url).split("/").pop().replace(".json", "")]);
    };
    expect(await readUserRecord(env(json), "abc123", { fetchImpl })).toEqual({ userId: "abc123", tasks: [{ id: 1 }], config: { a: 1 }, contributions: [] });
    const reads = calls.filter(([url]) => !url.includes("oauth2"));
    expect(reads.map(([url]) => url).sort()).toEqual([
      "https://demo-project-default-rtdb.firebaseio.com/sync/abc123/config.json",
      "https://demo-project-default-rtdb.firebaseio.com/sync/abc123/contributions.json",
      "https://demo-project-default-rtdb.firebaseio.com/sync/abc123/tasks.json",
    ]);
    for (const [, init] of reads) {
      expect(init.headers.Authorization).toBe("Bearer tok");
      expect(init.method).toBeUndefined(); // a plain GET
    }
  });

  it("reads only the parts it is asked for, and refuses any other (chatHistory included)", async () => {
    const { json } = await makeAccount();
    const seen = [];
    const fetchImpl = async (url) => {
      if (String(url).includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
      seen.push(String(url).split("/").pop());
      return Response.json([{ id: "b" }]);
    };
    expect(await readUserRecord(env(json), "abc", { fetchImpl }, ["brainDump"])).toEqual({ userId: "abc", brainDump: [{ id: "b" }] });
    expect(seen).toEqual(["brainDump.json"]);
    for (const bad of [["chatHistory"], ["tasks", "chatHistory"], ["../x"], []]) {
      await expect(readUserRecord(env(json), "abc", { fetchImpl: vi.fn() }, bad)).rejects.toThrow("Unreadable part requested");
    }
  });

  it("drops the cached token when the database refuses it, so the next read gets a fresh one", async () => {
    const { json } = await makeAccount();
    let tokens = 0;
    const refused = async (url) => String(url).includes("oauth2") ? (tokens += 1, Response.json({ access_token: `tok-${tokens}`, expires_in: 3600 })) : new Response("", { status: 401 });
    await expect(readUserRecord(env(json), "abc", { fetchImpl: refused })).rejects.toThrow("(401)");
    await expect(readUserRecord(env(json), "abc", { fetchImpl: refused })).rejects.toThrow("(401)");
    expect(tokens).toBe(2);
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

describe("readFocusEvents", () => {
  const env = (json) => ({ FIREBASE_SERVICE_ACCOUNT: json, FIREBASE_DB_URL: "https://demo-project-default-rtdb.firebaseio.com/" });

  it("reads one bounded slice of the user's focus log, with a plain GET and the token in a header", async () => {
    const { json } = await makeAccount();
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([String(url), init]);
      return String(url).includes("oauth2") ? Response.json({ access_token: "tok", expires_in: 3600 }) : Response.json({ "2026-10-22": { e1: { type: "focus_completed" } } });
    };
    expect(await readFocusEvents(env(json), "abc123", "2026-09-23", { fetchImpl })).toEqual({ "2026-10-22": { e1: { type: "focus_completed" } } });
    const reads = calls.filter(([url]) => !url.includes("oauth2"));
    expect(reads).toHaveLength(1);
    expect(reads[0][0]).toBe('https://demo-project-default-rtdb.firebaseio.com/activityLogs/abc123/events.json?orderBy=%22%24key%22&startAt=%222026-09-23%22');
    expect(reads[0][1].headers.Authorization).toBe("Bearer tok");
    expect(reads[0][1].method).toBeUndefined();
  });

  it("refuses a user id or day that could change the path or the query", async () => {
    const { json } = await makeAccount();
    for (const uid of ["", "../x", "a/b", "a?b"]) {
      await expect(readFocusEvents(env(json), uid, "2026-09-23", { fetchImpl: vi.fn() })).rejects.toThrow("Invalid user id");
    }
    for (const day of ["", "2026-9-1", "2026-09-23\"&orderBy=1", "2026-09-23/../x", undefined, "yesterday"]) {
      await expect(readFocusEvents(env(json), "abc", day, { fetchImpl: vi.fn() })).rejects.toThrow("Invalid day");
    }
  });

  it("reports a failed read by status only, and drops a refused token", async () => {
    const { json } = await makeAccount();
    let tokens = 0;
    const refused = async (url) => String(url).includes("oauth2") ? (tokens += 1, Response.json({ access_token: `t${tokens}`, expires_in: 3600 })) : new Response("secret", { status: 401 });
    await expect(readFocusEvents(env(json), "abc", "2026-09-23", { fetchImpl: refused })).rejects.toThrow(/^Database read failed \(401\)\.$/);
    await expect(readFocusEvents(env(json), "abc", "2026-09-23", { fetchImpl: refused })).rejects.toThrow("(401)");
    expect(tokens).toBe(2);
  });
});
