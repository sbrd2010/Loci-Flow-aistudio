import { describe, it, expect } from "vitest";
import { BRAIN_DUMP_LIMIT, normalizePayload, mergeRemotePayload, prepareBrainDumpForSave } from "./normalizePayload";

describe("normalizePayload", () => {
  it("fills missing brainDump with []", () => {
    expect(normalizePayload({ tasks: [], config: {} }).brainDump).toEqual([]);
  });

  it("fills missing tasks with []", () => {
    expect(normalizePayload({ config: {}, brainDump: [] }).tasks).toEqual([]);
  });

  it("fills missing contributions with []", () => {
    expect(normalizePayload({ tasks: [], config: {} }).contributions).toEqual([]);
  });

  it("fills missing config with {}", () => {
    expect(normalizePayload({ tasks: [], brainDump: [] }).config).toEqual({});
  });

  it("rejects invalid collection shapes instead of preserving truthy bad values", () => {
    const result = normalizePayload({ tasks: {}, config: [], contributions: "oops", brainDump: 42 });
    expect(result.tasks).toEqual([]);
    expect(result.config).toEqual({});
    expect(result.contributions).toEqual([]);
    expect(result.brainDump).toEqual([]);
  });

  it("preserves existing brainDump items", () => {
    const items = [{ id: "bd_1", text: "buy oat milk" }];
    expect(normalizePayload({ tasks: [], config: {}, brainDump: items }).brainDump).toEqual(items);
  });

  it("preserves unknown fields like chatHistory", () => {
    const history = [{ role: "user", content: "hi" }];
    const result = normalizePayload({ tasks: [], config: {}, chatHistory: history });
    expect(result.chatHistory).toEqual(history);
  });

  it("preserves timestamp", () => {
    expect(normalizePayload({ tasks: [], config: {}, timestamp: 99999 }).timestamp).toBe(99999);
  });

  it("infers legacy brainDumpUpdatedAt from timestamp when items exist", () => {
    const result = normalizePayload({ tasks: [], config: {}, brainDump: [{ id: "bd_1" }], timestamp: 123 });
    expect(result.brainDumpUpdatedAt).toBe(123);
  });

  it("uses explicit brainDumpUpdatedAt when present", () => {
    const result = normalizePayload({ tasks: [], config: {}, brainDump: [{ id: "bd_1" }], timestamp: 123, brainDumpUpdatedAt: 456 });
    expect(result.brainDumpUpdatedAt).toBe(456);
  });

  it("exports the shared Brain Dump limit", () => {
    expect(BRAIN_DUMP_LIMIT).toBe(50);
  });

  it("returns the raw value unchanged for non-objects", () => {
    expect(normalizePayload(null)).toBeNull();
    expect(normalizePayload(undefined)).toBeUndefined();
  });
});

describe("prepareBrainDumpForSave", () => {
  it("preserves current Brain Dump when a save does not touch Brain Dump", () => {
    const current = { brainDump: [{ id: "bd_1", text: "keep me" }], brainDumpUpdatedAt: 100 };
    expect(prepareBrainDumpForSave({ tasks: [] }, current, 200)).toEqual({
      brainDump: [{ id: "bd_1", text: "keep me" }],
      brainDumpUpdatedAt: 100,
    });
  });

  it("stamps brainDumpUpdatedAt when Brain Dump is intentionally cleared", () => {
    const current = { brainDump: [{ id: "bd_1", text: "clear me" }], brainDumpUpdatedAt: 100 };
    expect(prepareBrainDumpForSave({ brainDump: [] }, current, 200)).toEqual({
      brainDump: [],
      brainDumpUpdatedAt: 200,
    });
  });

  it("rejects Focus Mode item 51 when Brain Dump is already full", () => {
    const currentDump = Array.from({ length: BRAIN_DUMP_LIMIT }, (_, i) => ({ id: `bd_${i}`, text: `item ${i}` }));
    const attemptedDump = [...currentDump, { id: "bd_51", text: "too much" }];
    expect(prepareBrainDumpForSave({ brainDump: attemptedDump }, { brainDump: currentDump, brainDumpUpdatedAt: 100 }, 200)).toEqual({
      brainDump: currentDump,
      brainDumpUpdatedAt: 100,
    });
  });

  it("caps oversized batch updates to the shared limit", () => {
    const oversized = Array.from({ length: BRAIN_DUMP_LIMIT + 2 }, (_, i) => ({ id: `bd_${i}`, text: `item ${i}` }));
    const result = prepareBrainDumpForSave({ brainDump: oversized }, { brainDump: [], brainDumpUpdatedAt: 100 }, 200);
    expect(result.brainDump).toHaveLength(BRAIN_DUMP_LIMIT);
    expect(result.brainDumpUpdatedAt).toBe(200);
  });
});

describe("mergeRemotePayload", () => {
  it("preserves local brainDump for legacy remote payloads that lack the key and metadata", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    const local = {
      tasks: [],
      config: {},
      brainDump: [{ id: "bd_1", text: "critical note" }],
      brainDumpUpdatedAt: 90,
      timestamp: 90,
    };
    const result = mergeRemotePayload(remote, local);
    expect(result.brainDump).toEqual([{ id: "bd_1", text: "critical note" }]);
  });

  it("treats newer remote missing brainDump as an intentional clear", () => {
    const remote = { tasks: [], config: {}, timestamp: 200, brainDumpUpdatedAt: 200 };
    const local = {
      tasks: [],
      config: {},
      brainDump: [{ id: "bd_1", text: "stale local note" }],
      brainDumpUpdatedAt: 100,
      timestamp: 100,
    };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([]);
  });

  it("preserves newer local brainDump when remote clear metadata is older", () => {
    const remote = { tasks: [], config: {}, timestamp: 200, brainDumpUpdatedAt: 100 };
    const local = {
      tasks: [],
      config: {},
      brainDump: [{ id: "bd_1", text: "new unsynced local note" }],
      brainDumpUpdatedAt: 250,
      timestamp: 250,
    };
    const result = mergeRemotePayload(remote, local);
    expect(result.brainDump).toEqual([{ id: "bd_1", text: "new unsynced local note" }]);
    expect(result.brainDumpUpdatedAt).toBe(250);
  });

  it("uses remote brainDump when remote explicitly provides items", () => {
    const remote = { tasks: [], config: {}, brainDump: [{ id: "r1", text: "from remote" }], brainDumpUpdatedAt: 100, timestamp: 100 };
    const local = { tasks: [], config: {}, brainDump: [{ id: "l1", text: "old local" }], brainDumpUpdatedAt: 90, timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([{ id: "r1", text: "from remote" }]);
  });

  it("uses remote empty brainDump when remote explicitly has the key set to []", () => {
    const remote = { tasks: [], config: {}, brainDump: [], brainDumpUpdatedAt: 100, timestamp: 100 };
    const local = { tasks: [], config: {}, brainDump: [{ id: "l1", text: "local item" }], brainDumpUpdatedAt: 90, timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([]);
  });

  it("returns [] when both remote and local have no brainDump", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    const local = { tasks: [], config: {}, timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([]);
  });

  it("returns [] when remote lacks key and local brainDump is empty", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    const local = { tasks: [], config: {}, brainDump: [], timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([]);
  });

  it("returns [] when remote lacks key and local is null", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    expect(mergeRemotePayload(remote, null).brainDump).toEqual([]);
  });

  it("normalizes all standard fields from remote", () => {
    const remote = { config: {}, timestamp: 100 };
    const result = mergeRemotePayload(remote, null);
    expect(result.tasks).toEqual([]);
    expect(result.contributions).toEqual([]);
    expect(result.brainDump).toEqual([]);
  });

  it("preserves unknown fields from remote", () => {
    const remote = { tasks: [], config: {}, chatHistory: [{ role: "user", content: "hi" }], timestamp: 100 };
    expect(mergeRemotePayload(remote, null).chatHistory).toEqual([{ role: "user", content: "hi" }]);
  });

  // Sync safety: stale-cache rollback prevention.
  // When useSync detects a premature savePayload (localWriteBeforeFirstRtdbRef),
  // it calls mergeRemotePayload(rtdbData, staleLocal) and discards the pending
  // debounce. These tests verify the data-correctness of that decision.
  it("RTDB tasks win over stale local tasks even when local has a fake-fresh timestamp", () => {
    const fakeNow = 1_700_000_000_000;
    // Local was from 2 days ago but stamped with Date.now() by a premature savePayload
    const staleLocal = {
      tasks: [{ uuid: "stale", title: "2-day-old task", lastUpdated: fakeNow - 172_800_000 }],
      config: { visitStreakCount: 1 },
      brainDump: [],
      timestamp: fakeNow, // fake-fresh — set by premature savePayload
    };
    // RTDB has real current data; its timestamp is 1 hour before fakeNow
    const freshRtdb = {
      tasks: [{ uuid: "fresh", title: "real current task", lastUpdated: fakeNow - 3_600_000 }],
      config: { visitStreakCount: 7 },
      brainDump: [],
      timestamp: fakeNow - 3_600_000,
    };
    const result = mergeRemotePayload(freshRtdb, staleLocal);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].uuid).toBe("fresh");
    expect(result.config.visitStreakCount).toBe(7);
    expect(result.timestamp).toBe(fakeNow - 3_600_000);
  });

  it("RTDB config wins over stale local config on first load", () => {
    const staleLocal = {
      tasks: [],
      config: { deadlineLabel: "Old Sprint", visitStreakCount: 2 },
      brainDump: [],
      timestamp: Date.now(), // fake-fresh
    };
    const freshRtdb = {
      tasks: [],
      config: { deadlineLabel: "New Sprint", visitStreakCount: 10 },
      brainDump: [],
      timestamp: Date.now() - 3_600_000,
    };
    const result = mergeRemotePayload(freshRtdb, staleLocal);
    expect(result.config.deadlineLabel).toBe("New Sprint");
    expect(result.config.visitStreakCount).toBe(10);
  });
});
