import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { get, goOffline, goOnline, ref, runTransaction, set } from "firebase/database";
import { mergeLocalIntoServer } from "../src/utils/normalizePayload";

let env;
const uid = "notebook-sample";
const base = () => ({
  userId: "sample@example.test", config: { userId: "sample@example.test" },
  tasks: [{ id: 1, uuid: "sample-task", title: "File sample notes", userId: "sample@example.test" }],
  contributions: [], timestamp: 1, brainDumpUpdatedAt: 1,
  brainDump: [{ id: "a", text: "Blue sample", createdAt: 1 }, { id: "b", text: "Green sample", createdAt: 2 }],
});
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-loci-flow-notebook",
    database: { host: "127.0.0.1", port: 9000, rules: readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8") },
  });
});
beforeEach(async () => { await env.clearDatabase(); });
afterAll(async () => { await env?.cleanup(); });

describe("notebook edits through real Firebase transactions", () => {
  it("retains edits to different thoughts after an offline client reconnects", async () => {
    const a = env.authenticatedContext(uid).database();
    const b = env.authenticatedContext(uid).database();
    const initial = base();
    await set(ref(a, `sync/${uid}`), initial);
    await get(ref(a, `sync/${uid}`));
    await get(ref(b, `sync/${uid}`));
    const local = { ...initial, brainDump: [{ ...initial.brainDump[0], text: "Blue offline edit", updatedAt: 100, revisionId: "a" }, initial.brainDump[1]] };
    const online = { ...initial, brainDump: [initial.brainDump[0], { ...initial.brainDump[1], text: "Green online edit", updatedAt: 200, revisionId: "b" }] };
    goOffline(a);
    const pending = runTransaction(ref(a, `sync/${uid}`), server => mergeLocalIntoServer(server, local, initial));
    try {
      await runTransaction(ref(b, `sync/${uid}`), server => mergeLocalIntoServer(server, online, initial));
    } finally { goOnline(a); }
    expect((await pending).committed).toBe(true);
    const fresh = env.authenticatedContext(uid).database();
    expect((await get(ref(fresh, `sync/${uid}`))).val().brainDump.map(t => t.text)).toEqual(["Blue offline edit", "Green online edit"]);
  }, 20_000);

  it("does not resurrect a deleted thought when a stale client edits another", async () => {
    const a = env.authenticatedContext(uid).database();
    const b = env.authenticatedContext(uid).database();
    const initial = base();
    await set(ref(a, `sync/${uid}`), initial);
    const removed = { ...initial, brainDump: [initial.brainDump[1]] };
    await runTransaction(ref(b, `sync/${uid}`), server => mergeLocalIntoServer(server, removed, initial));
    const edited = { ...initial, brainDump: [initial.brainDump[0], { ...initial.brainDump[1], text: "Green later edit", updatedAt: 200, revisionId: "later" }] };
    await runTransaction(ref(a, `sync/${uid}`), server => mergeLocalIntoServer(server, edited, initial));
    const saved = (await get(ref(b, `sync/${uid}`))).val().brainDump;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "b", text: "Green later edit" });
  });
});
