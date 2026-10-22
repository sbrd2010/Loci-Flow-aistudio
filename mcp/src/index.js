import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createAuthorizeHandler } from "./authorize.js";
import { missingConfig, publicUrl } from "./config.js";
import { assertTimeZone } from "./time.js";
import { handleMcp, READ_SCOPE } from "./mcp.js";

let provider = null;
let providerFor = null; // PUBLIC_URL the provider was built for

function getProvider(env) {
  const base = publicUrl(env);
  if (provider && providerFor === base) return provider;
  provider = new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: { fetch: (request, workerEnv, ctx) => handleMcp(request, workerEnv, ctx) },
    defaultHandler: createAuthorizeHandler(),
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: [READ_SCOPE],
    requiredScopes: [READ_SCOPE],
    resourceMetadata: { resource: `${base}/mcp`, authorization_servers: [base] },
    clientIdMetadataDocumentEnabled: true,
  });
  providerFor = base;
  return provider;
}

export default {
  async fetch(request, env, ctx) {
    // Fail closed: a half-configured connector answers nothing rather than guessing.
    const missing = missingConfig(env);
    if (missing.length) {
      console.error(`Connector is not configured. Missing: ${missing.join(", ")}`);
      return new Response("The Loci connector is not configured.", { status: 503 });
    }
    try {
      assertTimeZone(env.LOCI_TIMEZONE);
    } catch (err) {
      console.error(err.message);
      return new Response("The Loci connector is not configured.", { status: 503 });
    }
    return getProvider(env).fetch(request, env, ctx);
  },
};
