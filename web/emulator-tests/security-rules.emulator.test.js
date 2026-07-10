import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";

// Live-enforcement counterpart to security-rules.spec.js's static assertions.
// That file confirms the rules *say* the right thing; this file confirms the
// Realtime Database Emulator actually *enforces* it — required before PR A
// (Activity Ledger) merges, per the Insights plan.
//
// Deliberately lives in web/emulator-tests/, NOT web/e2e/ — it uses vitest's
// test runner (beforeAll/describe/it from "vitest"), but Playwright's
// testDir is "./e2e" and auto-discovers any *.test.js there and tries to run
// it with its OWN runner, which crashes on vitest's globals. Keeping this
// out of e2e/ avoids that collision with `npm run test:e2e`.
//
// Requires a running RTDB emulator (firebase.json already configures one on
// port 9000). Run via `npm run test:rules-emulator` from web/ (wraps
// `firebase emulators:exec --only database "vitest run --config
// vitest.rules-emulator.config.js"`), or start `firebase emulators:start
// --only database` in one terminal and run `npx vitest run --config
// vitest.rules-emulator.config.js` in another. Not part of the default
// `npx vitest run` sweep (vitest.config.js's include glob is
// src/**/*.test.{js,ts}) — it needs a live emulator process, unlike every
// other test in this repo.
//
// NOTE: this file could not be executed in the sandboxed session that wrote
// it — the emulator's own local rules-push (PUT http://127.0.0.1:<port>/.settings/rules.json)
// was blocked by that session's outbound network policy even for loopback
// traffic. It is believed correct (mirrors Firebase's own documented
// RulesTestEnvironment usage) but is UNVERIFIED until it actually runs
// against a live emulator. Do not treat this file's existence as evidence
// the rules are enforced — run it for real before merging.

const rules = JSON.parse(readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8"));

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-loci-flow-rules-test",
    database: {
      rules: JSON.stringify(rules),
      host: "127.0.0.1",
      port: 9000,
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) await testEnv.clearDatabase();
});

describe("activityLogs/{uid} — live emulator enforcement", () => {
  const sampleEvent = {
    eventId: "evt1",
    schemaVersion: 1,
    type: "task_created",
    utcTimestamp: Date.now(),
    lociDateString: "2026-07-10",
    taskId: "task1",
    source: "user",
    taskSnapshot: { category: "Personal", priority: "P3", horizonLevel: "today" },
  };

  it("lets a user read/write their own activityLogs/{uid} path", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const path = alice.database().ref("activityLogs/alice/events/2026-07-10/evt1");
    await assertSucceeds(path.set(sampleEvent));
    await assertSucceeds(path.once("value"));
  });

  it("blocks a user from reading/writing another user's activityLogs/{uid} path", async () => {
    const bob = testEnv.authenticatedContext("bob");
    const path = bob.database().ref("activityLogs/alice/events/2026-07-10/evt1");
    await assertFails(path.set(sampleEvent));
    await assertFails(path.once("value"));
  });

  it("blocks unauthenticated read/write to activityLogs/{anyUid}", async () => {
    const anon = testEnv.unauthenticatedContext();
    const path = anon.database().ref("activityLogs/alice/events/2026-07-10/evt1");
    await assertFails(path.set(sampleEvent));
    await assertFails(path.once("value"));
  });

  it("lets a user read/write their own snapshot path", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const path = alice.database().ref("activityLogs/alice/snapshots/2026-07-10");
    await assertSucceeds(path.set({ schemaVersion: 1, lociDateString: "2026-07-10", capturedAt: Date.now(), todayTaskIds: [] }));
  });
});

describe("sync/{uid} — regression check, unaffected by the new activityLogs block", () => {
  const samplePayload = {
    userId: "alice",
    tasks: [{ id: 1, title: "Test task", userId: "alice" }],
    config: { userId: "alice" },
  };

  it("still lets a user read/write their own sync/{uid} path", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const path = alice.database().ref("sync/alice");
    await assertSucceeds(path.set(samplePayload));
    await assertSucceeds(path.once("value"));
  });

  it("still blocks a user from another user's sync/{uid} path", async () => {
    const bob = testEnv.authenticatedContext("bob");
    const path = bob.database().ref("sync/alice");
    await assertFails(path.set(samplePayload));
    await assertFails(path.once("value"));
  });

  it("still blocks unauthenticated access to sync/{anyUid}", async () => {
    const anon = testEnv.unauthenticatedContext();
    const path = anon.database().ref("sync/alice");
    await assertFails(path.set(samplePayload));
    await assertFails(path.once("value"));
  });
});
