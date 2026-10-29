// The owner's separate, previously unused Firebase project for alpha testing.
export const STAGING_PROJECT_ID = "gen-lang-client-0903100727";

export function firebaseCloudConfig(env = {}) {
  const target = env.VITE_FIREBASE_TARGET || "production";
  const raw = env.VITE_FIREBASE_STAGING_CONFIG;
  if (target === "production") {
    if (raw) throw new Error("Staging Firebase settings require VITE_FIREBASE_TARGET=staging.");
    return null; // Preserve the existing production configuration.
  }
  if (target !== "staging") throw new Error("Firebase target must be production or staging.");
  let input;
  try { input = JSON.parse(raw || ""); } catch { throw new Error("Staging requires valid Firebase configuration JSON."); }
  if (!input || input.projectId !== STAGING_PROJECT_ID) throw new Error("Staging must use the separate alpha Firebase project.");
  for (const key of ["apiKey", "authDomain", "databaseURL", "appId", "messagingSenderId"]) {
    if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`Staging Firebase configuration is missing ${key}.`);
  }
  if (input.authDomain !== `${STAGING_PROJECT_ID}.firebaseapp.com`) throw new Error("Staging Auth must belong to the test project.");
  if (!/^\d+$/.test(input.messagingSenderId) || !input.appId.startsWith(`1:${input.messagingSenderId}:web:`)) throw new Error("Staging requires a matching Firebase web app and sender ID.");
  let url;
  try { url = new URL(input.databaseURL); } catch { throw new Error("Invalid staging database URL."); }
  const instance = `${STAGING_PROJECT_ID}-default-rtdb`;
  const validHost = url.hostname === `${instance}.firebaseio.com`
    || (url.hostname.startsWith(`${instance}.`) && /^[a-z0-9-]+\.firebasedatabase\.app$/.test(url.hostname.slice(instance.length + 1)));
  if (url.protocol !== "https:" || !validHost || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Staging database must be the test project's default RTDB, never the live database.");
  }
  if (env.VITE_AI_RELAY_URL && !/^https:\/\/loci-ai-alpha-staging\.[a-z0-9-]+\.workers\.dev\/?$/.test(env.VITE_AI_RELAY_URL)) {
    throw new Error("Staging must use its separate AI relay.");
  }
  return Object.fromEntries(["apiKey", "authDomain", "databaseURL", "projectId", "storageBucket", "messagingSenderId", "appId"]
    .filter(key => typeof input[key] === "string").map(key => [key, input[key]]));
}
