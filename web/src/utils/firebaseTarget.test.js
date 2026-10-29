import { describe, expect, it } from "vitest";
import { firebaseCloudConfig, STAGING_PROJECT_ID as projectId } from "./firebaseTarget";

const config = () => ({ apiKey: "synthetic-public-key", authDomain: `${projectId}.firebaseapp.com`,
  databaseURL: `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app`,
  projectId, appId: "1:123:web:synthetic", messagingSenderId: "123" });
const env = overrides => ({ VITE_FIREBASE_TARGET: "staging", VITE_FIREBASE_STAGING_CONFIG: JSON.stringify({ ...config(), ...overrides }) });

describe("Firebase test-project isolation", () => {
  it("preserves production defaults and rejects stray or unknown targets", () => {
    expect(firebaseCloudConfig({})).toBeNull();
    expect(() => firebaseCloudConfig({ VITE_FIREBASE_TARGET: "stagng" })).toThrow();
    expect(() => firebaseCloudConfig({ VITE_FIREBASE_STAGING_CONFIG: JSON.stringify(config()) })).toThrow();
  });
  it("requires complete staging settings before Firebase initializes", () => {
    expect(() => firebaseCloudConfig({ VITE_FIREBASE_TARGET: "staging" })).toThrow();
    for (const key of ["apiKey", "authDomain", "databaseURL", "appId", "messagingSenderId"]) expect(() => firebaseCloudConfig(env({ [key]: "" }))).toThrow();
  });
  it("accepts the separate project and strips unrelated config fields", () => {
    expect(firebaseCloudConfig(env({ accessToken: "never-bundle-this" }))).toEqual(config());
    const regional = config().databaseURL;
    expect(firebaseCloudConfig(env({ databaseURL: regional.replace(".europe-west1.firebasedatabase.app", ".firebaseio.com") }))).toBeTruthy();
  });
  it("rejects mixed production project, auth, database, app identity and relay settings", () => {
    for (const patch of [{ projectId: "loci-flow" }, { authDomain: "loci-flow.firebaseapp.com" },
      { databaseURL: "https://loci-flow-default-rtdb.firebaseio.com" }, { appId: "1:999:web:wrong" },
      { databaseURL: `${config().databaseURL}/sync` }, { databaseURL: `${config().databaseURL}?ns=loci-flow` }]) {
      expect(() => firebaseCloudConfig(env(patch))).toThrow();
    }
    expect(() => firebaseCloudConfig({ ...env(), VITE_AI_RELAY_URL: "https://loci-ai.example.workers.dev" })).toThrow();
    expect(firebaseCloudConfig({ ...env(), VITE_AI_RELAY_URL: "https://loci-ai-alpha-staging.example.workers.dev" })).toEqual(config());
  });
});
