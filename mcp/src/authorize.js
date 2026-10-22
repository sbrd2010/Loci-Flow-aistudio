import { AuthorizationError, CimdFetchError, authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import { publicUrl, redirectAllowed } from "./config.js";
import { exchangeGoogleCode, googleAuthorizeUrl, isAllowedUser, newVerifier, s256 } from "./google.js";
import { READ_SCOPE } from "./mcp.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const text = (message, status) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

function consentPage(details, handle) {
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Loci</title>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1>Let ${escapeHtml(details.clientName)} read your Loci plan?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>" : ""}
<p>It can read your plan, deadlines and progress. It cannot change anything.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <button name="decision" value="approve">Continue with Google</button>
  <button name="decision" value="deny">Cancel</button>
</form>
</body>`;
}

const NOT_ALLOWED = "That app is not on this connector's list of allowed apps.";

function refuseRedirect(redirectUri) {
  // Origin and path only: a redirect address can carry a query.
  let where = "an unparseable address";
  try { const u = new URL(redirectUri); where = `${u.origin}${u.pathname}`; } catch { /* keep the placeholder */ }
  console.warn(`Refused a sign-in that would send access to ${where}`);
  return text(NOT_ALLOWED, 400);
}

async function showConsent(request, env, oauth) {
  const authRequest = await oauth.parseAuthRequest(request);
  if (!redirectAllowed(authRequest.redirectUri, env)) return refuseRedirect(authRequest.redirectUri);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(consentPage(details, consent.handle), { headers: consent.headers });
}

async function submitConsent(request, env, oauth) {
  const form = await request.formData();
  const handle = String(form.get("handle"));
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle, { scope: [READ_SCOPE] });
  if (!redirectAllowed(approved.request.redirectUri, env)) return refuseRedirect(approved.request.redirectUri);
  const verifier = newVerifier();
  const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
  headers.set("Location", googleAuthorizeUrl({
    clientId: env.GOOGLE_CLIENT_ID, redirectUri: `${publicUrl(env)}/callback`, state, codeChallenge: await s256(verifier),
  }));
  return new Response(null, { status: 302, headers });
}

async function finishSignIn(request, env, oauth, fetchImpl) {
  const { request: original, data, headers } = await oauth.finishUpstream(request);
  const params = new URL(request.url).searchParams;
  const refuse = (code) => {
    headers.set("Location", authorizationErrorRedirect(original, code));
    return new Response(null, { status: 302, headers });
  };
  if (params.get("error") || !params.get("code")) return refuse("access_denied");

  const claims = await exchangeGoogleCode({
    code: params.get("code"), verifier: data.verifier, clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${publicUrl(env)}/callback`,
  }, fetchImpl);
  if (!isAllowedUser(claims, { clientId: env.GOOGLE_CLIENT_ID, allowedEmail: env.ALLOWED_EMAIL })) {
    console.warn("Sign-in refused: this Google account is not the allowed one.");
    return refuse("access_denied");
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: original, userId: env.LOCI_UID, metadata: {}, scope: [READ_SCOPE], props: { uid: env.LOCI_UID },
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

// Everything under the OAuth provider that is not the MCP endpoint itself.
export function createAuthorizeHandler({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      const oauth = env.OAUTH_PROVIDER;
      try {
        if (pathname === "/authorize" && request.method === "GET") return await showConsent(request, env, oauth);
        if (pathname === "/authorize" && request.method === "POST") return await submitConsent(request, env, oauth);
        if (pathname === "/callback" && request.method === "GET") return await finishSignIn(request, env, oauth, fetchImpl);
        if (pathname === "/") return text("Loci connector. Add this address as a connector in ChatGPT or Claude.", 200);
        return text("Not found", 404);
      } catch (error) {
        if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
        if (error instanceof AuthorizationError) return text(`${error.description || "That request could not be completed."} Start again from the app.`, 400);
        if (error instanceof CimdFetchError) return text("That app could not be verified.", 400);
        console.error("authorize failed:", error instanceof Error ? error.message : "unknown");
        return text("Something went wrong. Start again from the app.", 500);
      }
    },
  };
}
