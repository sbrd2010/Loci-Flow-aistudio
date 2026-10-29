import test from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_HOST, prepareStagingFirebase } from "./prepare-staging-firebase.mjs";
import { STAGING_PROJECT_ID as projectId } from "../web/src/utils/firebaseTarget.js";

function fixture(overrides = {}) {
  const calls = [];
  const app = { name: "projects/123/webApps/1:123:web:synthetic", projectId, displayName: "Loci Alpha Staging" };
  const database = { name: `projects/123/locations/europe-west1/instances/${projectId}-default-rtdb`, state: "ACTIVE", databaseUrl: `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app` };
  const settings = { apiKey: "synthetic-key", authDomain: `${projectId}.firebaseapp.com`, projectId, appId: "1:123:web:synthetic", messagingSenderId: "123" };
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    assert.ok(!url.includes("/projects/loci-flow"));
    let data;
    if (url.endsWith("/instances")) data = { instances: overrides.noDatabase ? [] : [database] };
    else if (url.includes("/admin/v2/")) data = { authorizedDomains: overrides.noDomain ? [] : [PREVIEW_HOST] };
    else if (url.endsWith("/google.com")) data = { enabled: !overrides.noGoogle };
    else if (url.endsWith("/webApps") && options.method === "POST") data = { name: "operations/staging-app" };
    else if (url.endsWith("/webApps")) data = { apps: overrides.create ? [] : [app] };
    else if (url.includes("/operations/")) data = { done: true, response: app };
    else if (url.endsWith("/config")) data = { ...settings, ...overrides.settings };
    else throw new Error("Unexpected staging request");
    return { ok: true, json: async () => data };
  };
  return { calls, fetchImpl };
}

test("discovers the dedicated web app using numeric resource names without reading user data", async () => {
  const f = fixture();
  const config = await prepareStagingFirebase({ ...f, token: "synthetic-token" });
  assert.equal(config.projectId, projectId);
  assert.ok(config.databaseURL.includes(projectId));
  assert.ok(f.calls.every(c => c.method === "GET" && !c.url.includes("/sync/")));
});
test("registers only the dedicated staging web app when it is missing", async () => {
  const f = fixture({ create: true });
  await prepareStagingFirebase({ ...f, token: "synthetic-token", wait: async () => {} });
  assert.deepEqual(f.calls.filter(c => c.method === "POST").map(c => JSON.parse(c.body)), [{ displayName: "Loci Alpha Staging" }]);
});
test("stops before creating apps when database, authorized domain or Google sign-in is missing", async () => {
  for (const key of ["noDatabase", "noDomain", "noGoogle"]) {
    const f = fixture({ [key]: true });
    await assert.rejects(prepareStagingFirebase({ ...f, token: "synthetic-token" }));
    assert.ok(f.calls.every(c => c.method === "GET"));
  }
});
test("rejects mixed production settings and absent credentials", async () => {
  const f = fixture({ settings: { projectId: "loci-flow" } });
  await assert.rejects(prepareStagingFirebase({ ...f, token: "synthetic-token" }));
  await assert.rejects(prepareStagingFirebase({ fetchImpl: () => assert.fail("No requests without credentials") }));
});
