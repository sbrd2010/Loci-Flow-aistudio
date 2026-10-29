import { firebaseCloudConfig } from "../web/src/utils/firebaseTarget.js";

const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

export async function assertStagingDatabaseSafe({ config, rules, token, fetchImpl = fetch }) {
  const target = firebaseCloudConfig({ VITE_FIREBASE_TARGET: "staging", VITE_FIREBASE_STAGING_CONFIG: JSON.stringify(config) });
  if (!token) throw new Error("Staging database inspection requires credentials.");
  const read = async suffix => {
    const response = await fetchImpl(`${target.databaseURL.replace(/\/$/, "")}/${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Cannot verify the staging database (HTTP ${response.status}); no rules were changed.`);
    return response.json();
  };
  const current = await read(".settings/rules.json");
  if (canonical(current) === canonical(rules)) return; // Already managed by this Loci test build.
  if (canonical(current) !== canonical({ rules: { ".read": false, ".write": false } })) {
    throw new Error("The test project has unrelated database rules. Keep them intact and use a separate empty database/project.");
  }
  const root = await read(".json?shallow=true");
  if (root !== null && !(root && typeof root === "object" && !Array.isArray(root) && Object.keys(root).length === 0)) {
    throw new Error("The locked test database contains existing data. No rules were changed.");
  }
}
