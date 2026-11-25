// #680: the functional save through the real useSync and the real database
// emulator (auth-e2e/harness/sync-harness.html, test-only). Covers what the
// pure resolver's unit tests cannot: the live payload, the cache, the
// debounced write and its acknowledgement, the drop guard and the session.
import { test, expect, readServer } from "./helpers";

const task = (uuid, title) => ({
  id: uuid, uuid, title, userId: "alpha-a@example.test", concreteStep: "Open the sample folder",
  horizonLevel: "week", priority: "P3", category: "Personal", timeEstimateMinutes: 25,
  isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false, orderIndex: 9, lastUpdated: 1,
});

async function openHarness(clients) {
  const a = await clients.open();
  await a.page.goto("/auth-e2e/harness/sync-harness.html");
  await expect.poll(() => a.page.evaluate(() => window.__h?.api?.payload?.tasks?.length || 0)).toBe(2);
  return a;
}
const cache = (a) => a.page.evaluate(uid => localStorage.getItem(`loci_payload_v1_${uid}`), a.uid);
const serverUuids = async (clients, a) => (await readServer(clients.request, a.uid)).tasks.map(t => t.uuid);

test("#680 harness: two functional saves in one tick both land; the second sees the first", async ({ clients }) => {
  const a = await openHarness(clients);
  const r = await a.page.evaluate(([one, two]) => {
    const { api } = window.__h;
    const renders = window.__h.renders;
    const o1 = api.savePayload(p => ({ ...p, tasks: [...p.tasks, one] }));
    let sawOne = false;
    const o2 = api.savePayload(p => { sawOne = p.tasks.some(t => t.uuid === one.uuid); return { ...p, tasks: [...p.tasks, two] }; });
    const cached = JSON.parse(localStorage.getItem(`loci_payload_v1_${window.__h.uid}`)).payload.tasks.map(t => t.uuid);
    return { o1, o2, sawOne, sameRender: window.__h.renders === renders, cached };
  }, [task("h1", "Harness one"), task("h2", "Harness two")]);
  expect(r).toMatchObject({ o1: "applied", o2: "applied", sawOne: true, sameRender: true });
  expect(r.cached).toEqual(expect.arrayContaining(["h1", "h2"]));
  await expect.poll(() => serverUuids(clients, a)).toEqual(expect.arrayContaining(["seed-a", "seed-b", "h1", "h2"]));
});

test("#680 harness: object save, key patch and functional save in one tick: the function sees both", async ({ clients }) => {
  const a = await openHarness(clients);
  const r = await a.page.evaluate(([three, four]) => {
    const { api } = window.__h;
    api.savePayload({ ...api.payload, tasks: [...api.payload.tasks, three] });
    api.saveConfigPatch({ userName: "Harness Name" });
    let seen = null;
    const o = api.savePayload(p => { seen = { three: p.tasks.some(t => t.uuid === three.uuid), name: p.config.userName }; return { ...p, tasks: [...p.tasks, four] }; });
    return { o, seen };
  }, [task("h3", "Harness three"), task("h4", "Harness four")]);
  expect(r).toEqual({ o: "applied", seen: { three: true, name: "Harness Name" } });
  await expect.poll(async () => { const s = await readServer(clients.request, a.uid); return [s.config.userName, s.tasks.some(t => t.uuid === "h3"), s.tasks.some(t => t.uuid === "h4")]; }).toEqual(["Harness Name", true, true]);
});

test("#680 harness: no-op, throw, invalid and drop-guard refusals while a write is pending touch nothing", async ({ clients }) => {
  const a = await openHarness(clients);
  await a.page.evaluate(five => window.__h.api.savePayload(p => ({ ...p, tasks: [...p.tasks, five] })), task("h5", "Harness five"));
  const pending = await cache(a);
  const r = await a.page.evaluate(async () => {
    const { api } = window.__h;
    const key = `loci_payload_v1_${window.__h.uid}`;
    const before = localStorage.getItem(key);
    const seen = [];
    const out = {
      noop: api.savePayload(() => null, { onLocalOutcome: o => seen.push(o) }),
      threw: api.savePayload(() => { throw new Error("harness"); }),
      partial: api.savePayload(p => ({ config: p.config })),
      empty: api.savePayload(() => ({})),
      dropGuard: api.savePayload(p => ({ ...p, tasks: p.tasks.slice(0, 0) })),
    };
    const asyncNoop = await api.savePayloadAsync(() => null);
    const asyncThrew = await api.savePayloadAsync(() => { throw new Error("harness"); }).then(() => "resolved", e => e.outcome);
    return { out, seen, asyncNoop, asyncThrew, unchanged: localStorage.getItem(key) === before };
  });
  expect(r).toEqual({
    out: { noop: "noop", threw: "refused:threw", partial: "refused:invalid", empty: "refused:invalid", dropGuard: "refused:drop-guard" },
    seen: ["noop"], asyncNoop: "noop", asyncThrew: "refused:threw", unchanged: true,
  });
  expect(await cache(a)).toBe(pending);
  // The pending write still lands, alone.
  await expect.poll(() => serverUuids(clients, a)).toEqual(expect.arrayContaining(["seed-a", "seed-b", "h5"]));
  expect((await serverUuids(clients, a)).length).toBe(3);
});

test("#680 harness: savePayloadAsync(fn) resolves once the server has the write", async ({ clients }) => {
  const a = await openHarness(clients);
  const outcome = await a.page.evaluate(async six => {
    let local = null;
    await window.__h.api.savePayloadAsync(p => ({ ...p, tasks: [...p.tasks, six] }), { onLocalOutcome: o => { local = o; } });
    return local;
  }, task("h6", "Harness six"));
  expect(outcome).toBe("applied");
  expect(await serverUuids(clients, a)).toContain("h6"); // already there when the promise resolved
});

test("#680 harness: a save function from before signing out (same account after) is refused, without running", async ({ clients }) => {
  const a = await openHarness(clients);
  await a.page.evaluate(() => { window.__old = window.__h.api; window.__h.setUid(null); });
  await expect.poll(() => a.page.evaluate(() => window.__h.uid)).toBeNull();
  await a.page.evaluate(() => window.__h.setUid(undefined));
  await expect.poll(() => a.page.evaluate(() => window.__h?.api?.payload?.tasks?.length || 0)).toBe(2);
  const r = await a.page.evaluate(seven => {
    let ran = false;
    const stale = window.__old.savePayload(p => { ran = true; return { ...p, tasks: [...p.tasks, seven] }; });
    const current = window.__h.api.savePayload(p => ({ ...p, tasks: [...p.tasks, { ...seven, uuid: "h8", id: "h8" }] }));
    return { stale, ran, current };
  }, task("h7", "Harness seven"));
  expect(r).toEqual({ stale: "refused:owner", ran: false, current: "applied" });
  await expect.poll(() => serverUuids(clients, a)).toEqual(expect.arrayContaining(["h8"]));
  expect(await serverUuids(clients, a)).not.toContain("h7");
});

test("#680 harness: a named removal the drop guard would block is applied with expectedRemovals, refused without", async ({ clients }) => {
  const a = await openHarness(clients);
  await a.page.evaluate(nine => window.__h.api.savePayload(p => ({ ...p, tasks: [...p.tasks, nine] })), task("h9", "Harness nine"));
  const r = await a.page.evaluate(() => {
    const { api } = window.__h;
    const gone = ["seed-a", "seed-b", "h9"];
    const drop = p => ({ ...p, tasks: p.tasks.map(t => (gone.includes(t.uuid) ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t)) });
    return { without: api.savePayload(drop), withNamed: api.savePayload(drop, { expectedRemovals: gone }) };
  });
  expect(r).toEqual({ without: "refused:drop-guard", withNamed: "applied" });
  await expect.poll(async () => (await readServer(clients.request, a.uid)).tasks.filter(t => !t.isDeleted).length).toBe(0);
});

test("#680 harness: an observer that throws is told once and the write still lands", async ({ clients }) => {
  const a = await openHarness(clients);
  const r = await a.page.evaluate(ten => {
    let calls = 0;
    const outcome = window.__h.api.savePayload(p => ({ ...p, tasks: [...p.tasks, ten] }), { onLocalOutcome: () => { calls += 1; throw new Error("observer"); } });
    return { outcome, calls };
  }, task("h10", "Harness ten"));
  expect(r).toEqual({ outcome: "applied", calls: 1 });
  await expect.poll(() => serverUuids(clients, a)).toContain("h10");
});

test("#680 harness: async refusals reject (never throw at the call), and two coalesced saves settle after the server has both", async ({ clients }) => {
  const a = await openHarness(clients);
  const r = await a.page.evaluate(async ([eleven, twelve]) => {
    const { api } = window.__h;
    let threwSync = false;
    let invalid;
    try { invalid = api.savePayloadAsync(() => ({})); } catch { threwSync = true; }
    const invalidOutcome = await invalid.then(() => "resolved", e => e.outcome);
    const both = [api.savePayloadAsync(p => ({ ...p, tasks: [...p.tasks, eleven] })), api.savePayloadAsync(p => ({ ...p, tasks: [...p.tasks, twelve] }))];
    await Promise.all(both);
    return { threwSync, invalidOutcome };
  }, [task("h11", "Harness eleven"), task("h12", "Harness twelve")]);
  expect(r).toEqual({ threwSync: false, invalidOutcome: "refused:invalid" });
  expect(await serverUuids(clients, a)).toEqual(expect.arrayContaining(["h11", "h12"])); // already there when both resolved
});

test("#680 harness: a no-op or refusal while a write is pending does not delay it (no debounce reset)", async ({ clients }) => {
  const a = await openHarness(clients);
  const started = Date.now();
  await a.page.evaluate(t13 => window.__h.api.savePayload(p => ({ ...p, tasks: [...p.tasks, t13] })), task("h13", "Harness thirteen"));
  // Just before the 1.5 s debounce fires: a reset here would move the write to about 2.9 s.
  await a.page.waitForTimeout(1400);
  await a.page.evaluate(() => { const { api } = window.__h; api.savePayload(() => null); api.savePayload(() => ({})); api.savePayload(() => { throw new Error("x"); }); });
  await expect.poll(() => serverUuids(clients, a), { intervals: [100] }).toContain("h13");
  // Unreset it lands at ~1.5 s + one round trip; the bound sits between the two.
  expect(Date.now() - started).toBeLessThan(2700);
});
