// Discover public web settings using a staging-only CI credential. Never read
// application data or print credentials. Google sign-in/RTDB are owner setup.
import { writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { firebaseCloudConfig, STAGING_PROJECT_ID } from "../web/src/utils/firebaseTarget.js";

export const PREVIEW_HOST = "loci-flow--redesign-75-5837bxye.web.app";
export async function prepareStagingFirebase({ token, fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!token) throw new Error("A staging Firebase access token is required.");
  const request = async (url, body) => {
    const response = await fetchImpl(url, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Staging Firebase setup request failed (HTTP ${response.status}). Check the test project's service-account permissions.`);
    return response.json();
  };
  const project = `projects/${STAGING_PROJECT_ID}`;
  const management = "https://firebase.googleapis.com/v1beta1";
  const databases = await request(`https://firebasedatabase.googleapis.com/v1beta/${project}/locations/-/instances`);
  const database = databases.instances?.find(item => item.name?.endsWith(`/${STAGING_PROJECT_ID}-default-rtdb`) && item.state === "ACTIVE");
  if (!database) throw new Error("Create the test project's default Realtime Database in locked mode before deploying staging.");
  const auth = await request(`https://identitytoolkit.googleapis.com/admin/v2/${project}/config`);
  if (!auth.authorizedDomains?.includes(PREVIEW_HOST)) throw new Error(`Add ${PREVIEW_HOST} to Authentication > Settings > Authorized domains in the test project.`);
  const google = await request(`https://identitytoolkit.googleapis.com/v2/${project}/defaultSupportedIdpConfigs/google.com`);
  if (!google.enabled) throw new Error("Enable Google sign-in in the test project's Firebase Authentication console.");
  const apps = await request(`${management}/${project}/webApps`);
  let app = apps.apps?.find(item => item.displayName === "Loci Alpha Staging");
  if (!app) {
    let operation = await request(`${management}/${project}/webApps`, { displayName: "Loci Alpha Staging" });
    for (let attempt = 0; !operation.done && attempt < 30; attempt += 1) {
      if (!operation.name?.startsWith("operations/")) throw new Error("Invalid Firebase web-app operation.");
      await wait(1000);
      operation = await request(`${management}/${operation.name}`);
    }
    if (!operation.done || operation.error) throw new Error("The staging web app could not be registered.");
    app = operation.response;
  }
  if (app?.projectId !== STAGING_PROJECT_ID || !/^projects\/[^/]+\/webApps\/[^/]+$/.test(app.name || "")) throw new Error("Firebase returned a web app outside the test project.");
  const settings = await request(`${management}/${app.name}/config`);
  return firebaseCloudConfig({ VITE_FIREBASE_TARGET: "staging",
    VITE_FIREBASE_STAGING_CONFIG: JSON.stringify({ ...settings, databaseURL: database.databaseUrl }) });
}

async function main() {
  if (!process.env.FIREBASE_STAGING_CONFIG_FILE) throw new Error("Set FIREBASE_STAGING_CONFIG_FILE.");
  const config = await prepareStagingFirebase({ token: process.env.FIREBASE_ACCESS_TOKEN });
  await writeFile(process.env.FIREBASE_STAGING_CONFIG_FILE, JSON.stringify(config), { mode: 0o600 });
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV,
    `VITE_FIREBASE_TARGET=staging\nVITE_FIREBASE_STAGING_CONFIG=${JSON.stringify(config)}\n`);
  console.log(`Prepared public Firebase settings for ${STAGING_PROJECT_ID}. No live account data was accessed.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
