import { describe, it, expect } from "vitest";
import { configValuesEqual as eq, mergeLocalIntoServer, mergeRemotePayloadWithMeta, normalizePayload, applyEditsSince } from "./normalizePayload";
import { applyStepsPatch, stepsPatch } from "./taskSteps";
import { clearAllMemory } from "./coachMemory";

// #677: RTDB never stores an empty array or object, nor a container holding
// only such values. A device whose copy holds one (subSteps: [] after the last
// step goes) used to see a local edit the server could never take: every save
// re-stamped the task server + 1, and the device kept its stale copy forever.
// Comparisons now treat any value with nothing stored in it as absent.

// What RTDB keeps of a value: nulls and empty containers, at any depth, go.
const stored = (v) => {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const items = v.map(stored);
    while (items.length && items[items.length - 1] === undefined) items.pop(); // trailing nulls go too
    return items.length ? items.map(x => (x === undefined ? null : x)) : undefined;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v).map(([k, x]) => [k, stored(x)]).filter(([, x]) => x !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return v;
};

const USER = "sample@example.test";
const task = (extra = {}) => ({
  id: 1, uuid: "t1", title: "Sample task", userId: USER, horizonLevel: "week", priority: "P3",
  isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false, orderIndex: 6, lastUpdated: 9000, ...extra,
});
const payload = (tasks, extra = {}) => ({ userId: USER, timestamp: 100, config: {}, contributions: [], brainDump: [], tasks, ...extra });
const baseOf = (p) => {
  const n = normalizePayload(p);
  return { tasks: n.tasks, config: n.config, contributions: n.contributions, brainDump: n.brainDump, chatHistory: [] };
};
const incoming = (remote, local, base) =>
  mergeRemotePayloadWithMeta(remote, local, base.config, base.contributions, base.brainDump, base.chatHistory, base.tasks);
// One full save from `local`: the transaction's result, as the server stores
// it, then the device absorbing that copy (what absorbCommitted does).
const save = (server, local, base) => {
  const committed = stored(mergeLocalIntoServer(server, local, base));
  const { merged, hasLocalContribution } = incoming(committed, local, base);
  return { committed, local: applyEditsSince(merged, local, local), base: baseOf(committed), hasLocalContribution };
};
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

describe("configValuesEqual: a value with nothing stored in it is absent (#677)", () => {
  it("null, undefined, [] and {} are all the same absent value", () => {
    for (const a of [null, undefined, [], {}]) for (const b of [null, undefined, [], {}]) expect(eq(a, b)).toBe(true);
  });
  it("is transitive through objects of absent values", () => {
    expect(eq({}, { a: null })).toBe(true);
    expect(eq({}, undefined)).toBe(true);
    expect(eq({ a: null }, undefined)).toBe(true);
  });
  it("containers holding only absent values are absent, at any depth", () => {
    for (const v of [{ a: [] }, { a: { b: null } }, [null], [[], {}], { a: [{}] }]) {
      expect(eq(v, undefined)).toBe(true);
      expect(eq(undefined, v)).toBe(true);
    }
    expect(eq({ a: 1, b: [] }, { a: 1 })).toBe(true);
  });
  it("false, 0 and \"\" are values, not absence", () => {
    for (const v of [false, 0, ""]) {
      expect(eq(v, undefined)).toBe(false);
      expect(eq(undefined, v)).toBe(false);
      expect(eq([v], [])).toBe(false);
    }
    expect(eq(false, 0)).toBe(false);
    expect(eq("", 0)).toBe(false);
  });
  it("non-empty values keep their order, length and type", () => {
    expect(eq([1, 2], [2, 1])).toBe(false);
    expect(eq([1], [1, 2])).toBe(false);
    expect(eq({ a: 1 }, { a: 2 })).toBe(false);
    expect(eq({ 0: "x" }, ["x"])).toBe(false);
    expect(eq(["x"], { 0: "x" })).toBe(false);
  });
  it("compares every index of a sparse array, the same in both directions", () => {
    // eslint-disable-next-line no-sparse-arrays
    const holed = [, "keep"];
    expect(eq(holed, ["real", "keep"])).toBe(false);
    expect(eq(["real", "keep"], holed)).toBe(false);
    expect(eq(holed, [null, "keep"])).toBe(true);
    expect(eq([null, "keep"], holed)).toBe(true);
    expect(eq(["x", null], ["x"])).toBe(false); // lengths are not normalised (out of scope)
  });
  it("only arrays and plain objects are containers: a Date is never absent", () => {
    expect(eq(new Date(0), undefined)).toBe(false);
    expect(eq(undefined, new Date(0))).toBe(false);
    expect(eq({ at: new Date(0) }, {})).toBe(false);
    expect(eq(Object.create(null), undefined)).toBe(true);
  });
  it("does not change its inputs", () => {
    const a = deepFreeze({ s: [], c: { p: [] }, n: [1, { x: null }] });
    const b = deepFreeze({ n: [1, {}] });
    expect(eq(a, b)).toBe(true);
  });
});

describe("tasks: an empty value the server drops is not an edit (#677)", () => {
  it("the stuck copy converges: the server clock stays put and the device takes it", () => {
    const server = payload([task({ lastUpdated: 9000 })]);
    let local = payload([task({ subSteps: [], lastUpdated: 6000 })]);
    let base = baseOf(server);
    let s = server;
    for (let i = 0; i < 3; i++) {
      const r = save(s, local, base);
      expect(r.committed.tasks[0].lastUpdated).toBe(9000);
      expect(r.local.tasks[0].lastUpdated).toBe(9000);
      expect(r.hasLocalContribution).toBe(false);
      ({ local, base } = r);
      s = r.committed;
    }
  });
  it("a delivery alone heals the stuck copy", () => {
    const remote = payload([task({ lastUpdated: 9000 })]);
    const { merged, hasLocalContribution } = incoming(remote, payload([task({ subSteps: [], lastUpdated: 6000 })]), baseOf(remote));
    expect(merged.tasks[0].lastUpdated).toBe(9000);
    expect(hasLocalContribution).toBe(false);
  });
  it("removing the last step is still an edit, and lands as no steps", () => {
    const before = task({ subSteps: [{ id: "s1", text: "Open the folder", done: false }], concreteStep: "Open the folder" });
    const server = payload([before]);
    const edited = applyStepsPatch(before, stepsPatch(before, []), 9500);
    expect(edited.subSteps).toEqual([]);
    const r = save(server, payload([edited]), baseOf(server));
    expect(r.committed.tasks[0].subSteps).toBeUndefined();
    expect(r.committed.tasks[0].concreteStep).toBeUndefined();
    expect(r.committed.tasks[0].lastUpdated).toBe(9500);
    // and the next save from that device changes nothing
    const again = save(r.committed, r.local, r.base);
    expect(again.committed.tasks[0].lastUpdated).toBe(9500);
    expect(again.hasLocalContribution).toBe(false);
  });
  it("a step added back after a clear is an edit", () => {
    const cleared = task({ lastUpdated: 9500 });
    const server = payload([cleared]);
    const local = payload([applyStepsPatch(task({ subSteps: [] }), stepsPatch(task({ subSteps: [] }), [{ id: "s2", text: "Call the shop", done: false }]), 9600)]);
    const r = save(server, local, baseOf(server));
    expect(r.committed.tasks[0].subSteps).toEqual([{ id: "s2", text: "Call the shop", done: false }]);
  });
  it("a clear made on the other device is taken in", () => {
    const steps = [{ id: "s1", text: "Open the folder", done: false }];
    const base = baseOf(payload([task({ subSteps: steps })]));
    const remote = payload([task({ lastUpdated: 9700 })]);
    const { merged, hasLocalContribution } = incoming(remote, payload([task({ subSteps: steps })]), base);
    expect(merged.tasks[0].subSteps).toBeUndefined();
    expect(hasLocalContribution).toBe(false);
  });
  it("a real edit next to the empty value still wins and lands", () => {
    const server = payload([task({ lastUpdated: 9000 })]);
    const local = payload([task({ subSteps: [], title: "Sample task renamed", lastUpdated: 6000 })]);
    const r = save(server, local, baseOf(server));
    expect(r.committed.tasks[0].title).toBe("Sample task renamed");
    expect(r.committed.tasks[0].lastUpdated).toBe(9001);
  });
  it("a true two-sided conflict resolves the same with or without the empty value", () => {
    const base = baseOf(payload([task({ title: "Base title", lastUpdated: 9000 })]));
    const server = payload([task({ title: "Server title", lastUpdated: 9500 })]);
    for (const [localClock, winner] of [[9600, "Local title"], [9400, "Server title"]]) {
      const plain = task({ title: "Local title", lastUpdated: localClock });
      const noisy = { ...plain, subSteps: [] };
      for (const local of [plain, noisy]) {
        expect(incoming(server, payload([local]), base).merged.tasks[0].title).toBe(winner);
        expect(mergeLocalIntoServer(server, payload([local]), base).tasks[0].title).toBe(winner);
      }
    }
  });
  it("a deletion on the other device is not undone by the empty value", () => {
    const base = baseOf(payload([task({ lastUpdated: 9000 })]));
    const remote = payload([task({ isDeleted: true, lastUpdated: 9800 })]);
    const { merged } = incoming(remote, payload([task({ subSteps: [], lastUpdated: 6000 })]), base);
    expect(merged.tasks[0].isDeleted).toBe(true);
  });
  it("without a base, the newer clock still decides", () => {
    const remote = payload([task({ lastUpdated: 9000 })]);
    const { merged } = mergeRemotePayloadWithMeta(remote, payload([task({ subSteps: [], lastUpdated: 6000 })]));
    expect(merged.tasks[0].lastUpdated).toBe(9000);
  });
});

describe("config: an empty value the server drops is not an edit (#677)", () => {
  const cfg = (config) => payload([], { config });
  it("Coach memory cleared to empty lists: lands once, then stays quiet", () => {
    const server = cfg({ coachMemory: { pinnedFacts: [{ text: "Sample fact", createdAt: 1 }] } });
    const local = cfg({ coachMemory: clearAllMemory(server.config.coachMemory) });
    const r = save(server, local, baseOf(server));
    expect(r.committed?.config?.coachMemory).toBeUndefined();
    const again = save(r.committed, r.local, r.base);
    expect(again.hasLocalContribution).toBe(false);
    expect(again.committed?.config?.coachMemory).toBeUndefined();
  });
  it("a device stuck holding the cleared memory, with the server and base without it, settles", () => {
    const server = cfg({ userName: "Sample" });
    const local = cfg({ userName: "Sample", coachMemory: clearAllMemory({}) });
    const { hasLocalContribution } = incoming(server, local, baseOf(server));
    expect(hasLocalContribution).toBe(false);
  });
  it("clearing a list is an edit; a remote clear is kept", () => {
    const fronts = [{ id: "f1", name: "Sample front" }];
    const server = cfg({ fronts });
    const r = save(server, cfg({ fronts: [] }), baseOf(server));
    expect(r.committed?.config?.fronts).toBeUndefined();
    const { merged, hasLocalContribution } = incoming(cfg({}), cfg({ fronts }), baseOf(cfg({ fronts })));
    expect(merged.config.fronts ?? []).toEqual([]);
    expect(hasLocalContribution).toBe(false);
  });
  it("a key this device simply lacks is not a deletion", () => {
    const server = cfg({ userName: "Sample", fronts: [{ id: "f1", name: "Sample front" }] });
    const r = save(server, cfg({ userName: "Sample" }), baseOf(server));
    expect(r.committed.config.fronts.map(f => f.id)).toEqual(["f1"]);
  });
  it("an empty value here and a real one added on the server: the server's stays", () => {
    const { merged } = incoming(cfg({ fronts: [{ id: "f2", name: "Added elsewhere" }] }), cfg({ fronts: [] }), baseOf(cfg({})));
    expect(merged.config.fronts.map(f => f.id)).toEqual(["f2"]);
  });
});

describe("edits made after a save was sent (applyEditsSince, #677)", () => {
  it("a difference only in shape is not replayed", () => {
    const merged = payload([task({ lastUpdated: 9000 })]);
    const out = applyEditsSince(merged, payload([task({ subSteps: [], lastUpdated: 6000 })]), payload([task({ lastUpdated: 6000 })]));
    expect(out.tasks[0].lastUpdated).toBe(9000);
  });
  it("a real clear made after submit survives the commit: last step, a config list, the last highlight", () => {
    const steps = [{ id: "s1", text: "Open the folder", done: false }];
    const thought = (highlights) => ({ id: "b1", text: "Sample thought", createdAt: 1, highlights });
    const written = payload([task({ subSteps: steps })], { config: { fronts: [{ id: "f1", name: "Sample front" }] }, brainDump: [thought([{ start: 0, end: 6, color: "y" }])] });
    const local = payload([task({ subSteps: [], lastUpdated: 9100 })], { config: { fronts: [] }, brainDump: [thought([])] });
    const out = applyEditsSince(written, local, written);
    expect(out.tasks[0].subSteps).toEqual([]);
    expect(out.config.fronts).toEqual([]);
    expect(out.brainDump[0].highlights).toEqual([]);
  });
});

describe("Brain Dump: an empty highlights list is not an edit (#677)", () => {
  it("does not ask for a write-back on every delivery", () => {
    const remote = payload([], { brainDump: [{ id: "b1", text: "Sample thought", createdAt: 1 }] });
    const local = payload([], { brainDump: [{ id: "b1", text: "Sample thought", createdAt: 1, highlights: [] }] });
    expect(incoming(remote, local, baseOf(remote)).hasLocalContribution).toBe(false);
  });
});
