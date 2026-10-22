// Everything the connector needs from the Worker's environment. Plain values go
// in wrangler.jsonc "vars"; the two secrets are set with `wrangler secret put`.
// The owner's email, uid and zone are not committed: they are set at deploy time.
const REQUIRED = [
  "PUBLIC_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ALLOWED_EMAIL",
  "LOCI_UID", "LOCI_TIMEZONE", "FIREBASE_DB_URL", "FIREBASE_SERVICE_ACCOUNT",
];

export function missingConfig(env) {
  return REQUIRED.filter(name => typeof env[name] !== "string" || !env[name].trim());
}

export const publicUrl = (env) => env.PUBLIC_URL.replace(/\/+$/, "");

// Where an access code may be sent. Registration is open (ChatGPT and Claude
// register themselves), so without this anyone could register an app under a
// friendly name, send the owner a link, and be handed a token once the owner
// signs in with Google. An entry ending in "/" matches any path under it.
// ChatGPT's address carries a per-connector id; the older shared one still works.
// EXTRA_REDIRECT_URIS (comma-separated, same format) adds more without a code change.
const DEFAULT_REDIRECTS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector/oauth/",
  "https://chatgpt.com/connector_platform_oauth_redirect",
];

export function redirectAllowed(redirectUri, env = {}) {
  let url;
  try { url = new URL(redirectUri); } catch { return false; }
  if (url.protocol !== "https:") return false;
  // Parsed, not string-matched: "https://claude.ai@evil.example/" has the origin evil.example.
  const where = `${url.origin}${url.pathname}`;
  const extra = String(env.EXTRA_REDIRECT_URIS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return [...DEFAULT_REDIRECTS, ...extra].some(entry => (entry.endsWith("/") ? where.startsWith(entry) && where.length > entry.length : where === entry));
}
