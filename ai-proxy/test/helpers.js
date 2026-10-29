// A stand-in for Google's securetoken signing key, so tests can mint sign-in
// tokens the relay accepts (or, by changing one claim, rejects).

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

export const PROJECT = "test-project";
export const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export async function makeSigner(kid = "kid-1") {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid, alg: "RS256", use: "sig" };
  const sign = async (overrides = {}, header = {}) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const claims = {
      iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "user-1",
      iat: nowSec - 10, auth_time: nowSec - 10, exp: nowSec + 3600,
      firebase: { sign_in_provider: "google.com" }, email: "tester@example.test", email_verified: true, ...overrides,
    };
    const unsigned = `${b64urlJson({ alg: "RS256", typ: "JWT", kid, ...header })}.${b64urlJson(claims)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(unsigned));
    return `${unsigned}.${b64url(sig)}`;
  };
  return { jwk, sign };
}

export const jwksResponse = (...jwks) => new Response(JSON.stringify({ keys: jwks }), { status: 200, headers: { "Cache-Control": "public, max-age=3600" } });
