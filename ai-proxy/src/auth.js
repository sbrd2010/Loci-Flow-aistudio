// Checks a Firebase sign-in token (the one the Loci app gets from
// auth.currentUser.getIdToken()) by hand: firebase-admin does not run on
// Workers. Rules from Firebase's "verify ID tokens using a third-party JWT
// library" guide: RS256, signed by one of Google's securetoken keys, aud is the
// project id, iss is securetoken.google.com/<project id>, sub non-empty, exp in
// the future, iat and auth_time in the past. Loci signs in with Google only, so
// a token from any other sign-in method (anonymous, email) is refused too, in
// case one is ever switched on in the Firebase console.

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_SEC = 300;
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;
// A token naming an unknown key makes the Worker refetch Google's keys; at most
// once a minute, so made-up tokens cannot make it fetch on every request.
const REFETCH_MIN_MS = 60 * 1000;

let cached = null; // { keys: Map<kid, CryptoKey>, expiresAt, fetchedAt }

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

function maxAgeMs(res) {
  const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
  return m ? Number(m[1]) * 1000 : DEFAULT_KEYS_TTL_MS;
}

// Any failure here is Google's side (an outage), never a bad sign-in.
async function loadKeys(fetchImpl, now) {
  let res, keys;
  try {
    res = await fetchImpl(JWKS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ({ keys = [] } = await res.json());
  } catch (err) {
    throw new Error(`Google key request failed (${err?.message || "network"}).`);
  }
  const map = new Map();
  for (const jwk of Array.isArray(keys) ? keys : []) {
    if (jwk?.kty !== "RSA" || !jwk.kid || (jwk.alg && jwk.alg !== "RS256")) continue;
    try {
      map.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    } catch { /* one unusable key must not lock everyone out */ }
  }
  cached = { keys: map, expiresAt: now + maxAgeMs(res), fetchedAt: now };
  return map;
}

async function keyFor(kid, fetchImpl, now) {
  const fresh = cached && cached.expiresAt > now;
  if (fresh && cached.keys.has(kid)) return cached.keys.get(kid);
  // Unknown kid: Google may have rotated keys, so refetch, but not more than once a minute.
  if (fresh && now - cached.fetchedAt < REFETCH_MIN_MS) return null;
  try {
    return (await loadKeys(fetchImpl, now)).get(kid) || null;
  } catch (err) {
    // Keep using the last good keys through a Google outage.
    if (cached?.keys.has(kid)) return cached.keys.get(kid);
    throw err;
  }
}

// Resolves to the token's claims, or throws if the token is not a valid
// sign-in to this project.
export async function verifyFirebaseToken(token, projectId, { fetchImpl = fetch, now = Date.now() } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  let header, claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { throw new Error("malformed token"); }
  if (header.alg !== "RS256" || !header.kid) throw new Error("wrong algorithm");

  const nowSec = Math.floor(now / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("wrong project");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) throw new Error("no subject");
  if (!(claims.exp > nowSec)) throw new Error("expired");
  if (!(claims.iat <= nowSec + CLOCK_SKEW_SEC) || !(claims.auth_time <= nowSec + CLOCK_SKEW_SEC)) throw new Error("issued in the future");
  if (claims.firebase?.sign_in_provider !== "google.com") throw new Error("not a Google sign-in");

  const key = await keyFor(header.kid, fetchImpl, now);
  if (!key) throw new Error("unknown key");
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error("bad signature");
  return claims;
}

export function resetKeyCache() {
  cached = null;
}
