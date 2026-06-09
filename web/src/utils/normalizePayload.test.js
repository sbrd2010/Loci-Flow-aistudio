import { describe, it, expect } from "vitest";
import { BRAIN_DUMP_LIMIT, normalizePayload, mergeRemotePayload, prepareBrainDumpForSave, isTaskCountDropSuspicious } from "./normalizePayload";

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
    const sharedUuid = "task-abc";
    // Local was from 2 days ago but stamped with Date.now() by a premature savePayload
    const staleLocal = {
      tasks: [{ uuid: sharedUuid, title: "2-day-old version", lastUpdated: fakeNow - 172_800_000 }],
      config: { visitStreakCount: 1 },
      brainDump: [],
      timestamp: fakeNow, // fake-fresh — set by premature savePayload
    };
    // RTDB has the real current version of the same task edited on another device
    const freshRtdb = {
      tasks: [{ uuid: sharedUuid, title: "real current version", lastUpdated: fakeNow - 3_600_000 }],
      config: { visitStreakCount: 7 },
      brainDump: [],
      timestamp: fakeNow - 3_600_000,
    };
    const result = mergeRemotePayload(freshRtdb, staleLocal);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("real current version");
    expect(result.config.visitStreakCount).toBe(7);
    expect(result.timestamp).toBe(fakeNow - 3_600_000);
  });

  it("preserves local-only tasks not present in RTDB (unsynced additions from another device)", () => {
    const fakeNow = 1_700_000_000_000;
    // RTDB has 6 tasks; another device added 2 more but they haven't reached RTDB yet
    const rtdb = {
      tasks: [
        { uuid: "t1", title: "Task 1", isDeleted: false },
        { uuid: "t2", title: "Task 2", isDeleted: false },
      ],
      config: {},
      brainDump: [],
      timestamp: fakeNow,
    };
    const localWithUnsynced = {
      tasks: [
        { uuid: "t1", title: "Task 1", isDeleted: false },
        { uuid: "t2", title: "Task 2", isDeleted: false },
        { uuid: "t3", title: "Unsynced Task A", isDeleted: false },
        { uuid: "t4", title: "Unsynced Task B", isDeleted: false },
      ],
      config: {},
      brainDump: [],
      timestamp: fakeNow - 5_000,
    };
    const result = mergeRemotePayload(rtdb, localWithUnsynced);
    expect(result.tasks).toHaveLength(4);
    const uuids = result.tasks.map(t => t.uuid);
    expect(uuids).toContain("t3");
    expect(uuids).toContain("t4");
  });

  it("does not preserve local-only tasks that are soft-deleted", () => {
    const fakeNow = 1_700_000_000_000;
    const rtdb = {
      tasks: [{ uuid: "t1", title: "Task 1", isDeleted: false }],
      config: {},
      brainDump: [],
      timestamp: fakeNow,
    };
    const local = {
      tasks: [
        { uuid: "t1", title: "Task 1", isDeleted: false },
        { uuid: "t2", title: "Deleted local task", isDeleted: true },
      ],
      config: {},
      brainDump: [],
      timestamp: fakeNow - 5_000,
    };
    const result = mergeRemotePayload(rtdb, local);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].uuid).toBe("t1");
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

describe("mergeRemotePayload - task-level conflict resolution", () => {
  const base = { config: {}, brainDump: [], timestamp: 1000 };
  const task = (uuid, overrides = {}) => ({ uuid, title: uuid, isDeleted: false, ...overrides });

  it("1. remote-only task is kept", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("r1")] },
      { ...base, tasks: [] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].uuid).toBe("r1");
  });

  it("2. local-only non-deleted task is preserved", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [] },
      { ...base, tasks: [task("l1", { lastUpdated: 100 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].uuid).toBe("l1");
  });

  it("3. local-only soft-deleted task is not resurrected", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [] },
      { ...base, tasks: [task("l1", { isDeleted: true, lastUpdated: 100 })] }
    );
    expect(result.tasks).toHaveLength(0);
  });

  it("4. same UUID: newer local task beats older remote task", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { title: "Old remote", lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { title: "New local", lastUpdated: 200 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("New local");
  });

  it("5. same UUID: newer remote task beats older local task", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { title: "New remote", lastUpdated: 200 })] },
      { ...base, tasks: [task("t1", { title: "Old local", lastUpdated: 100 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("New remote");
  });

  it("6. same UUID: completed local task with newer lastUpdated is preserved", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { isCompleted: false, lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { isCompleted: true, lastUpdated: 200 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].isCompleted).toBe(true);
  });

  it("7. same UUID: parked local task with newer lastUpdated is preserved", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { isParked: false, lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { isParked: true, lastUpdated: 200 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].isParked).toBe(true);
  });

  it("8a. same UUID: newer remote-deleted beats older local-active", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { isDeleted: true, lastUpdated: 200 })] },
      { ...base, tasks: [task("t1", { isDeleted: false, lastUpdated: 100 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].isDeleted).toBe(true);
  });

  it("8b. same UUID: newer local-deleted beats older remote-active", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { isDeleted: false, lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { isDeleted: true, lastUpdated: 200 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].isDeleted).toBe(true);
  });

  it("9. same UUID: equal timestamps prefer remote", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { title: "Remote version", lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { title: "Local version", lastUpdated: 100 })] }
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("Remote version");
  });

  it("10. missing/invalid lastUpdated does not crash, falls back to 0 (remote wins on tie)", () => {
    expect(() => mergeRemotePayload(
      { ...base, tasks: [task("t1", { title: "Remote" })] },
      { ...base, tasks: [task("t1", { title: "Local", lastUpdated: "bad" })] }
    )).not.toThrow();
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1", { title: "Remote" })] },
      { ...base, tasks: [task("t1", { title: "Local", lastUpdated: null })] }
    );
    expect(result.tasks[0].title).toBe("Remote");
  });

  it("11. no duplicate UUIDs in merged output", () => {
    const result = mergeRemotePayload(
      { ...base, tasks: [task("t1"), task("t2")] },
      { ...base, tasks: [task("t1", { lastUpdated: 999 }), task("t3")] }
    );
    const uuids = result.tasks.map(t => t.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
    expect(uuids).toContain("t1");
    expect(uuids).toContain("t2");
    expect(uuids).toContain("t3");
  });
});

describe("isTaskCountDropSuspicious", () => {
  const active = (n) => Array.from({ length: n }, (_, i) => ({ uuid: `t${i}`, isDeleted: false }));
  const deleted = (n) => Array.from({ length: n }, (_, i) => ({ uuid: `d${i}`, isDeleted: true }));

  it("returns false when task count stays the same", () => {
    expect(isTaskCountDropSuspicious(active(5), active(5))).toBe(false);
  });

  it("returns false when task count increases", () => {
    expect(isTaskCountDropSuspicious(active(8), active(5))).toBe(false);
  });

  it("returns false when active count drops by 1", () => {
    expect(isTaskCountDropSuspicious(active(4), active(5))).toBe(false);
  });

  it("returns false when active count drops by 2", () => {
    expect(isTaskCountDropSuspicious(active(3), active(5))).toBe(false);
  });

  it("returns true when active count drops by exactly the threshold (3)", () => {
    expect(isTaskCountDropSuspicious(active(2), active(5))).toBe(true);
  });

  it("returns true when active count drops by more than the threshold", () => {
    expect(isTaskCountDropSuspicious(active(1), active(10))).toBe(true);
  });

  it("returns false when current active count is below the threshold (new/empty state)", () => {
    expect(isTaskCountDropSuspicious([], active(2))).toBe(false);
  });

  it("counts completed but non-deleted tasks as active", () => {
    const current = [
      { uuid: "t1", isDeleted: false, isCompleted: false },
      { uuid: "t2", isDeleted: false, isCompleted: true },
      { uuid: "t3", isDeleted: false, isCompleted: true },
      { uuid: "t4", isDeleted: false, isCompleted: true },
      { uuid: "t5", isDeleted: false, isCompleted: false },
    ];
    // Drop from 5 active (completed but not deleted count) to 1 → suspicious
    expect(isTaskCountDropSuspicious([{ uuid: "t1", isDeleted: false }], current)).toBe(true);
  });

  it("counts parked but non-deleted tasks as active", () => {
    const current = [
      { uuid: "t1", isDeleted: false, isParked: false },
      { uuid: "t2", isDeleted: false, isParked: true },
      { uuid: "t3", isDeleted: false, isParked: true },
      { uuid: "t4", isDeleted: false, isParked: true },
      { uuid: "t5", isDeleted: false, isParked: false },
    ];
    expect(isTaskCountDropSuspicious([{ uuid: "t1", isDeleted: false }], current)).toBe(true);
  });

  it("does not count deleted tasks in either direction", () => {
    // Current: 2 active + 10 deleted. Next: 2 active + 0 deleted.
    // Drop of 0 active tasks → not suspicious.
    const current = [...active(2), ...deleted(10)];
    const next = active(2);
    expect(isTaskCountDropSuspicious(next, current)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isTaskCountDropSuspicious(active(3), active(5), 2)).toBe(true);
    expect(isTaskCountDropSuspicious(active(4), active(5), 2)).toBe(false);
  });

  it("handles null/undefined task arrays without throwing", () => {
    expect(isTaskCountDropSuspicious(null, active(5))).toBe(true);
    expect(isTaskCountDropSuspicious(undefined, active(5))).toBe(true);
    expect(isTaskCountDropSuspicious(active(5), null)).toBe(false);
    expect(isTaskCountDropSuspicious(active(5), undefined)).toBe(false);
  });
});
