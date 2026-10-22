// Sign-in through Google. The connector keeps no accounts of its own: Google says
// who is at the keyboard, and only the one allowed email gets a token.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function s256(verifier) {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export function newVerifier() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function googleAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email",
    state, code_challenge: codeChallenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return url.toString();
}

function decodeClaims(idToken) {
  const payload = String(idToken).split(".")[1];
  if (!payload) throw new Error("Google sent no usable ID token.");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
}

// The ID token is read, not signature-checked: it comes straight from Google's
// token endpoint over TLS in exchange for our one-time code and client secret,
// which OpenID Connect Core 3.1.3.7 accepts in place of a signature check.
export async function exchangeGoogleCode({ code, verifier, clientId, clientSecret, redirectUri }, fetchImpl = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}).`);
  return decodeClaims((await res.json()).id_token);
}

// Fails closed: anything missing or different from what we expect is a no.
export function isAllowedUser(claims, { clientId, allowedEmail }) {
  const allowed = String(allowedEmail ?? "").trim().toLowerCase();
  const email = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
  return allowed !== ""
    && email === allowed
    && ISSUERS.includes(claims.iss)
    && claims.aud === clientId
    && claims.email_verified === true;
}
