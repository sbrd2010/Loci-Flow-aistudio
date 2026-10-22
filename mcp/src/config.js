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
