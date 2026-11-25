import { describe, it, expect, vi } from "vitest";
import { createDemoStore } from "./demoStore";

// #680: demo saves, same contract as useSync's: truthful outcomes, the
// latest live copy, and a session per demo visit.
const payload = () => ({
  userId: "demo", timestamp: 1, contributions: [], brainDump: [],
  tasks: [{ uuid: "d1", title: "Sample demo task", horizonLevel: "today", reviewFrom: { day: "2026-11-01" } }],
  config: { userName: "Sample" },
});
const add = (uuid) => (p) => ({ ...p, tasks: [...p.tasks, { uuid, title: `Sample ${uuid}`, horizonLevel: "week" }] });

describe("demo store (#680)", () => {
  it("a key patch and two functional saves in one go: each function sees everything before it", () => {
    const publish = vi.fn();
    const store = createDemoStore(publish);
    store.enter(payload());
    const token = store.state.session;
    store.saveConfigPatch({ userName: "Sample Renamed" });
    let seen = null;
    expect(store.save(add("d2"), undefined, token)).toBe("applied");
    expect(store.save(p => { seen = { name: p.config.userName, d2: p.tasks.some(t => t.uuid === "d2") }; return add("d3")(p); }, undefined, token)).toBe("applied");
    expect(seen).toEqual({ name: "Sample Renamed", d2: true });
    expect(store.state.live.tasks.map(t => t.uuid)).toEqual(["d1", "d2", "d3"]);
    expect(publish).toHaveBeenLastCalledWith(store.state.live);
  });
  it("reports no-op, throw, invalid and refused truthfully, and changes nothing for them", () => {
    const publish = vi.fn();
    const store = createDemoStore(publish);
    store.enter(payload());
    const token = store.state.session;
    const before = store.state.live;
    const seen = [];
    expect(store.save(() => null, { onLocalOutcome: o => seen.push(o) }, token)).toBe("noop");
    expect(store.save(() => { throw new Error("sample"); }, undefined, token)).toBe("refused:threw");
    expect(store.save(() => ({}), undefined, token)).toBe("refused:invalid");
    expect(store.save(p => ({ ...p, brainDump: null }), undefined, token)).toBe("refused:invalid");
    expect(seen).toEqual(["noop"]);
    expect(store.state.live).toBe(before);
    expect(publish).toHaveBeenCalledTimes(1); // the enter only
  });
  it("a save function from an earlier demo visit is refused, without running", () => {
    const store = createDemoStore(() => {});
    store.enter(payload());
    const old = store.state.session;
    store.exit();
    store.enter(payload());
    const update = vi.fn(add("d9"));
    expect(store.save(update, undefined, old)).toBe("refused:owner");
    expect(update).not.toHaveBeenCalled();
    expect(store.state.live.tasks.map(t => t.uuid)).toEqual(["d1"]);
  });
  it("after exit, nothing is saved and nothing is published", () => {
    const publish = vi.fn();
    const store = createDemoStore(publish);
    store.enter(payload());
    const token = store.state.session;
    store.exit();
    publish.mockClear();
    expect(store.save(add("d4"), undefined, store.state.session)).toBe("refused:owner");
    expect(store.save(add("d4"), undefined, token)).toBe("refused:owner");
    store.saveSubPath("brainDump", []);
    store.saveConfigPatch({ userName: "x" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("an object save keeps its old behaviour, with the review-mark rule applied", () => {
    const store = createDemoStore(() => {});
    store.enter(payload());
    const p = store.state.live;
    expect(store.save({ ...p, tasks: p.tasks.map(t => ({ ...t, horizonLevel: "week" })) }, undefined, 0)).toBe("applied");
    expect(store.state.live.tasks[0].reviewFrom).toBeUndefined();
  });
});
