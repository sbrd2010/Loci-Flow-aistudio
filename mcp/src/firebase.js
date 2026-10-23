// Reads a user's record from the Realtime Database over its REST API, signed in
// as a service account. firebase-admin does not run on Workers, so the OAuth
// token is made by hand: a signed JWT exchanged at Google's token endpoint.
//
// A service-account token bypasses database.rules.json. Two things stand in for
// the rules: this file only ever GETs under sync/{uid} and the focus log
// activityLogs/{uid}/events for the uid it is handed, and the account should hold
// only the "Firebase Realtime Database Viewer" role, so even a bug here could not
// write (see docs/mcp-connector.md).

const SCOPES = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cached = null; // { token, expiresAt, key }

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

function pemToDer(pem) {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}

export function parseServiceAccount(json) {
  let account;
  try { account = JSON.parse(json); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON."); }
  if (!account?.client_email || !account?.private_key) throw new Error("FIREBASE_SERVICE_ACCOUNT needs client_email and private_key.");
  return account;
}

async function signJwt(account, nowSec) {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const unsigned = `${b64urlJson({ alg: "RS256", typ: "JWT" })}.${b64urlJson({
    iss: account.client_email, scope: SCOPES, aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: nowSec, exp: nowSec + 3600,
  })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

export async function getAccessToken(serviceAccountJson, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (cached && cached.key === serviceAccountJson && cached.expiresAt - REFRESH_MARGIN_MS > now) return cached.token;
  const account = parseServiceAccount(serviceAccountJson);
  const assertion = await signJwt(account, Math.floor(now / 1000));
  const res = await fetchImpl(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status}).`);
  const { access_token: token, expires_in: expiresIn } = await res.json();
  if (!token) throw new Error("Google token response had no access_token.");
  cached = { token, expiresAt: now + Number(expiresIn || 3600) * 1000, key: serviceAccountJson };
  return token;
}

export function resetTokenCache() {
  cached = null;
}

// Firebase uids are short alphanumerics. Anything else could change the path.
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// The only children of sync/{uid} that can be read. chatHistory is not on the
// list, so it never reaches the Worker whatever a caller asks for.
export const READABLE_PARTS = ["tasks", "config", "contributions", "brainDump"];

// One authenticated GET. Status only in the error: the body can echo the path or the data.
async function getJson(base, path, token, fetchImpl) {
  const res = await fetchImpl(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  // A refused token (key revoked or rotated) must not keep being reused until it expires.
  if (res.status === 401) resetTokenCache();
  if (!res.ok) throw new Error(`Database read failed (${res.status}).`);
  return res.json();
}

const baseOf = (env) => env.FIREBASE_DB_URL.replace(/\/+$/, "");

export async function readUserRecord(env, uid, { fetchImpl = fetch, now = Date.now() } = {}, parts = ["tasks", "config", "contributions"]) {
  if (!UID_PATTERN.test(uid)) throw new Error("Invalid user id.");
  if (!parts.length || !parts.every(p => READABLE_PARTS.includes(p))) throw new Error("Unreadable part requested.");
  const token = await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT, { fetchImpl, now });
  const values = await Promise.all(parts.map(part => getJson(baseOf(env), `sync/${uid}/${part}.json`, token, fetchImpl)));
  return { userId: uid, ...Object.fromEntries(parts.map((p, i) => [p, values[i]])) };
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The user's focus log from `sinceDay` on: activityLogs/{uid}/events/{lociDay}/{eventId},
// the same bounded read the app makes (days sort as they read, so ordering by key
// and starting at the oldest day fetches just the window). Returns the raw
// { "2026-10-22": { eventId: event } } object, or null when nothing is logged.
export async function readFocusEvents(env, uid, sinceDay, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!UID_PATTERN.test(uid)) throw new Error("Invalid user id.");
  if (typeof sinceDay !== "string" || !DAY_PATTERN.test(sinceDay)) throw new Error("Invalid day.");
  const token = await getAccessToken(env.FIREBASE_SERVICE_ACCOUNT, { fetchImpl, now });
  return getJson(baseOf(env), `activityLogs/${uid}/events.json?orderBy=%22%24key%22&startAt=%22${sinceDay}%22`, token, fetchImpl);
}
