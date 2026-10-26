// Checks a Firebase sign-in token (the one the Loci app gets from
// auth.currentUser.getIdToken()) by hand: firebase-admin does not run on
// Workers. Rules from Firebase's "verify ID tokens using a third-party JWT
// library" guide: RS256, signed by one of Google's securetoken keys, aud is the
// project id, iss is securetoken.google.com/<project id>, sub non-empty, exp in
// the future, iat and auth_time in the past.

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_SEC = 300;
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;

let cached = null; // { keys: Map<kid, CryptoKey>, expiresAt }

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

function maxAgeMs(res) {
  const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
  return m ? Number(m[1]) * 1000 : DEFAULT_KEYS_TTL_MS;
}

async function loadKeys(fetchImpl, now) {
  let res;
  try { res = await fetchImpl(JWKS_URL); } catch { throw new Error("Google key request failed (network)."); }
  if (!res.ok) throw new Error(`Google key request failed (${res.status}).`);
  const { keys = [] } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    map.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  cached = { keys: map, expiresAt: now + maxAgeMs(res) };
  return map;
}

async function keyFor(kid, fetchImpl, now) {
  if (cached && cached.expiresAt > now && cached.keys.has(kid)) return cached.keys.get(kid);
  // Unknown kid on a fresh cache: Google may have rotated keys, so fetch once more.
  const keys = await loadKeys(fetchImpl, now);
  return keys.get(kid) || null;
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

  const key = await keyFor(header.kid, fetchImpl, now);
  if (!key) throw new Error("unknown key");
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error("bad signature");
  return claims;
}

export function resetKeyCache() {
  cached = null;
}
