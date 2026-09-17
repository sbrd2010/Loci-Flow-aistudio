import { describe, it, expect } from "vitest";
import { BRAIN_DUMP_LIMIT, normalizePayload, mergeRemotePayload, mergeRemotePayloadWithMeta, prepareBrainDumpForSave, isTaskCountDropSuspicious, mergeLocalIntoServer, clampConfigStringsForRules, sanitizeChatHistoryForRules } from "./normalizePayload";

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

  it("preserves chatHistory and unknown fields", () => {
    const history = [{ text: "hi", isUser: true }];
    const result = normalizePayload({ tasks: [], config: {}, chatHistory: history, someFutureField: { a: 1 } });
    expect(result.chatHistory).toEqual(history);
    expect(result.someFutureField).toEqual({ a: 1 });
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

  it("null input returns safe empty payload", () => {
    const result = normalizePayload(null);
    expect(result.tasks).toEqual([]);
    expect(result.config).toEqual({});
    expect(result.contributions).toEqual([]);
    expect(result.brainDump).toEqual([]);
    expect(result.brainDumpUpdatedAt).toBe(0);
  });

  it("undefined input returns safe empty payload", () => {
    const result = normalizePayload(undefined);
    expect(result.tasks).toEqual([]);
    expect(result.config).toEqual({});
    expect(result.contributions).toEqual([]);
    expect(result.brainDump).toEqual([]);
    expect(result.brainDumpUpdatedAt).toBe(0);
  });

  it("numeric input returns safe empty payload", () => {
    const result = normalizePayload(42);
    expect(result.tasks).toEqual([]);
    expect(result.config).toEqual({});
  });

  it("string input returns safe empty payload", () => {
    const result = normalizePayload("bad");
    expect(result.tasks).toEqual([]);
    expect(result.config).toEqual({});
  });

  it("array input returns safe empty payload (not spread with numeric keys)", () => {
    const result = normalizePayload([{ uuid: "t1" }]);
    expect(result.tasks).toEqual([]);
    expect(result.config).toEqual({});
  });

  it("valid payload preserves existing custom fields", () => {
    const result = normalizePayload({ tasks: [], config: {}, customField: "keep me", timestamp: 500 });
    expect(result.customField).toBe("keep me");
    expect(result.timestamp).toBe(500);
  });

  it("missing arrays on a valid object are normalized to empty arrays", () => {
    const result = normalizePayload({ config: {} });
    expect(result.tasks).toEqual([]);
    expect(result.contributions).toEqual([]);
    expect(result.brainDump).toEqual([]);
  });

  it("missing config on a valid object is normalized to {}", () => {
    expect(normalizePayload({ tasks: [] }).config).toEqual({});
  });

  it("valid brainDumpUpdatedAt is preserved", () => {
    const result = normalizePayload({ tasks: [], config: {}, brainDump: [], brainDumpUpdatedAt: 9999 });
    expect(result.brainDumpUpdatedAt).toBe(9999);
  });

  it("invalid brainDumpUpdatedAt safely becomes 0", () => {
    const result = normalizePayload({ tasks: [], config: {}, brainDump: [], brainDumpUpdatedAt: "bad" });
    expect(result.brainDumpUpdatedAt).toBe(0);
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

  it("preserves chatHistory and unknown fields from remote", () => {
    const remote = { tasks: [], config: {}, chatHistory: [{ text: "hi", isUser: true }], someFutureField: 1, timestamp: 100 };
    const merged = mergeRemotePayload(remote, null);
    expect(merged.chatHistory).toEqual([{ text: "hi", isUser: true }]);
    expect(merged.someFutureField).toBe(1);
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
      timestamp: fakeNow, // fake-fresh - set by premature savePayload
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

describe("mergeRemotePayload - config merge (multi-device sync safety)", () => {
  const base = { tasks: [], brainDump: [], timestamp: 1000 };

  it("local keys changed since base win over older remote config", () => {
    const baseConfig = { deadlineLabel: "Remote Sprint", lastUpdated: 100 };
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 100 } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint", lastUpdated: 200 } };
    const result = mergeRemotePayload(remote, local, baseConfig);
    expect(result.config).toEqual({ deadlineLabel: "Local Sprint", lastUpdated: 200 });
  });

  it("newer remote config wins over older local config", () => {
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 200 } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint", lastUpdated: 100 } };
    const result = mergeRemotePayload(remote, local);
    expect(result.config).toEqual({ deadlineLabel: "Remote Sprint", lastUpdated: 200 });
  });

  it("equal config.lastUpdated prefers remote (tie-break, matches mergeTasks)", () => {
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 100 } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint", lastUpdated: 100 } };
    const result = mergeRemotePayload(remote, local);
    expect(result.config.deadlineLabel).toBe("Remote Sprint");
  });

  it("remote config with lastUpdated wins over local config missing lastUpdated", () => {
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 100 } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint" } };
    const result = mergeRemotePayload(remote, local);
    expect(result.config.deadlineLabel).toBe("Remote Sprint");
  });

  it("local config with lastUpdated wins over remote config missing lastUpdated", () => {
    const baseConfig = { deadlineLabel: "Remote Sprint" };
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint" } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint", lastUpdated: 100 } };
    const result = mergeRemotePayload(remote, local, baseConfig);
    expect(result.config.deadlineLabel).toBe("Local Sprint");
  });

  it("neither config has lastUpdated: remote wins (preserves legacy behavior)", () => {
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint" } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint" } };
    const result = mergeRemotePayload(remote, local);
    expect(result.config.deadlineLabel).toBe("Remote Sprint");
  });

  it("flags hasLocalContribution when local config wins, so it is written back to RTDB", () => {
    const baseConfig = { deadlineLabel: "Remote Sprint", lastUpdated: 100 };
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 100 } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint", lastUpdated: 200 } };
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(remote, local, baseConfig);
    expect(hasLocalContribution).toBe(true);
  });

  it("does not flag hasLocalContribution when remote config wins", () => {
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 200 } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint", lastUpdated: 100 } };
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(remote, local);
    expect(hasLocalContribution).toBe(false);
  });

  // The bug this three-way merge exists to prevent: a device bumps
  // config.lastUpdated for its own reasons (the visit-streak effect firing on a
  // laptop resumed from sleep) while still holding a stale copy of every other
  // config field. Whole-object last-write-wins handed that device the entire
  // config, reverting a Key Deadline set on another device that morning — and
  // hasLocalContribution then pushed the stale copy back to RTDB, so the edit
  // was destroyed for every device and survived a refresh.
  it("stale local field does not clobber a newer remote one it never touched", () => {
    const baseConfig = {
      deadlineLabel: "20 Aug: 7+8 jobs apply",
      visitStreakCount: 5, lastVisitDate: "2026-08-20", lastUpdated: 100,
    };
    const remote = { ...base, config: {
      deadlineLabel: "21 Aug: 7+8 jobs apply",   // changed on the home laptop
      visitStreakCount: 5, lastVisitDate: "2026-08-20", lastUpdated: 200,
    } };
    const local = { ...base, config: {
      deadlineLabel: "20 Aug: 7+8 jobs apply",   // never re-synced: still stale
      visitStreakCount: 6, lastVisitDate: "2026-08-21", lastUpdated: 300,
    } };

    const { merged } = mergeRemotePayloadWithMeta(remote, local, baseConfig);

    expect(merged.config.deadlineLabel).toBe("21 Aug: 7+8 jobs apply");
    // ...while the streak keys this device genuinely did change still survive.
    expect(merged.config.visitStreakCount).toBe(6);
    expect(merged.config.lastVisitDate).toBe("2026-08-21");
  });

  // A base can outlive the payload cache it describes (cache evicted under
  // quota, or dropped on sign-out). Reading base's keys as deletions to replay
  // then emptied the whole config — and flagged it as a local contribution, so
  // the wipe was written back to RTDB.
  it("a base with no local payload never deletes config keys", () => {
    const baseConfig = {
      deadlineLabel: "My deadline", deadlineDate: "2026-09-30",
      visitStreakCount: 7, userName: "Rohan", lastUpdated: 100,
    };
    const remote = { ...base, config: {
      deadlineLabel: "My deadline", deadlineDate: "2026-09-30",
      visitStreakCount: 7, userName: "Rohan", lastUpdated: 200,
    } };

    const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(remote, null, baseConfig);

    expect(merged.config.deadlineLabel).toBe("My deadline");
    expect(merged.config.deadlineDate).toBe("2026-09-30");
    expect(merged.config.visitStreakCount).toBe(7);
    expect(merged.config.userName).toBe("Rohan");
    expect(hasLocalContribution).toBe(false);
  });

  it("a key missing locally but present in base is left to remote", () => {
    const baseConfig = { deadlineLabel: "Keep me", userName: "Rohan", lastUpdated: 100 };
    const remote = { ...base, config: { deadlineLabel: "Keep me", userName: "Rohan", lastUpdated: 200 } };
    // Local knows nothing about deadlineLabel — that is absence, not a deletion.
    const local = { ...base, config: { userName: "Renamed", lastUpdated: 300 } };

    const { merged } = mergeRemotePayloadWithMeta(remote, local, baseConfig);

    expect(merged.config.deadlineLabel).toBe("Keep me");
    expect(merged.config.userName).toBe("Renamed");
  });

  it("both sides changed the same key since base: remote wins", () => {
    const baseConfig = { deadlineLabel: "Original", lastUpdated: 100 };
    const remote = { ...base, config: { deadlineLabel: "Remote edit", lastUpdated: 200 } };
    const local = { ...base, config: { deadlineLabel: "Local edit", lastUpdated: 300 } };
    const result = mergeRemotePayload(remote, local, baseConfig);
    expect(result.config.deadlineLabel).toBe("Remote edit");
  });

  it("without a base, remote wins outright and nothing is written back", () => {
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 100 } };
    const local = { ...base, config: { deadlineLabel: "Local Sprint", lastUpdated: 999 } };
    const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(remote, local, null);
    expect(merged.config.deadlineLabel).toBe("Remote Sprint");
    expect(hasLocalContribution).toBe(false);
  });

  it("a preserved local edit carries a timestamp remote cannot silently outrank", () => {
    // If the merged config kept remote's older lastUpdated, the next delivery
    // would read the re-applied key as "nothing new here" and drop it again.
    const baseConfig = { a: 1, deadlineLabel: "Keep me", lastUpdated: 100 };
    const remote = { ...base, config: { a: 2, deadlineLabel: "Keep me", lastUpdated: 200 } };
    const local = { ...base, config: { a: 1, deadlineLabel: "Local edit", lastUpdated: 300 } };
    const result = mergeRemotePayload(remote, local, baseConfig);
    expect(result.config.deadlineLabel).toBe("Local edit");
    expect(result.config.a).toBe(2);
    expect(result.config.lastUpdated).toBe(300);
  });

  it("treats a null/undefined round-trip as unchanged, not as a local edit", () => {
    // RTDB drops keys written as null, so the same logical "unset" comes back
    // as undefined; counting that as an edit would make every device look dirty.
    const baseConfig = { deadlineAction: null, lastUpdated: 100 };
    const remote = { ...base, config: { deadlineLabel: "Remote Sprint", lastUpdated: 200 } };
    const local = { ...base, config: { deadlineAction: null, lastUpdated: 300 } };
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(remote, local, baseConfig);
    expect(hasLocalContribution).toBe(false);
  });

  it("config merge does not interfere with task-level conflict resolution", () => {
    const remote = {
      tasks: [{ uuid: "t1", title: "Old remote task", lastUpdated: 100 }],
      config: { deadlineLabel: "Remote Sprint", lastUpdated: 100 },
      brainDump: [], timestamp: 1000,
    };
    const local = {
      tasks: [{ uuid: "t1", title: "New local task", lastUpdated: 200 }],
      config: { deadlineLabel: "Local Sprint", lastUpdated: 50 },
      brainDump: [], timestamp: 1000,
    };
    const result = mergeRemotePayload(remote, local);
    expect(result.tasks[0].title).toBe("New local task");
    expect(result.config.deadlineLabel).toBe("Remote Sprint");
  });

  it("config merge does not interfere with brainDump metadata merge", () => {
    const remote = {
      tasks: [],
      config: { deadlineLabel: "Remote Sprint", lastUpdated: 200 },
      timestamp: 100,
    };
    const local = {
      tasks: [],
      config: { deadlineLabel: "Local Sprint", lastUpdated: 100 },
      brainDump: [{ id: "bd_1", text: "critical note" }],
      brainDumpUpdatedAt: 90,
      timestamp: 90,
    };
    const result = mergeRemotePayload(remote, local);
    expect(result.brainDump).toEqual([{ id: "bd_1", text: "critical note" }]);
    expect(result.config.deadlineLabel).toBe("Remote Sprint");
  });

  it("both configs empty merge safely to {}", () => {
    const remote = { ...base, config: {} };
    const local = { ...base, config: {} };
    const result = mergeRemotePayload(remote, local);
    expect(result.config).toEqual({});
  });
});

describe("mergeRemotePayloadWithMeta - hasLocalContribution flag (write-back detection)", () => {
  const base = { config: {}, brainDump: [], timestamp: 1000 };
  const task = (uuid, overrides = {}) => ({ uuid, title: uuid, isDeleted: false, ...overrides });

  it("returns false when remote fully wins all same-UUID conflicts", () => {
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1", { title: "New remote", lastUpdated: 200 })] },
      { ...base, tasks: [task("t1", { title: "Old local", lastUpdated: 100 })] }
    );
    expect(hasLocalContribution).toBe(false);
  });

  it("returns false when there are no local tasks at all", () => {
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1")] },
      { ...base, tasks: [] }
    );
    expect(hasLocalContribution).toBe(false);
  });

  it("returns true when a local-newer same-UUID task wins the conflict", () => {
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1", { lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { lastUpdated: 200 })] }
    );
    expect(hasLocalContribution).toBe(true);
  });

  it("returns false for equal timestamps (remote wins tie, no write-back needed)", () => {
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1", { title: "Remote version", lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { title: "Local version", lastUpdated: 100 })] }
    );
    expect(hasLocalContribution).toBe(false);
  });

  it("returns true when a local-only non-deleted task is appended", () => {
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1")] },
      { ...base, tasks: [task("t1"), task("t2", { isDeleted: false })] }
    );
    expect(hasLocalContribution).toBe(true);
  });

  it("returns false when local-only task is soft-deleted (not appended)", () => {
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1")] },
      { ...base, tasks: [task("t1"), task("t2", { isDeleted: true })] }
    );
    expect(hasLocalContribution).toBe(false);
  });

  it("returns true and merged contains local-newer task (write-back carries correct data)", () => {
    const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1", { title: "Old remote", lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { title: "New local", lastUpdated: 200 })] }
    );
    expect(hasLocalContribution).toBe(true);
    expect(merged.tasks[0].title).toBe("New local");
  });

  it("newer deleted task wins and does not cause spurious write-back when remote wins", () => {
    // Remote has the newer delete - remote wins, no write-back
    const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1", { isDeleted: true, lastUpdated: 200 })] },
      { ...base, tasks: [task("t1", { isDeleted: false, lastUpdated: 100 })] }
    );
    expect(hasLocalContribution).toBe(false);
    expect(merged.tasks[0].isDeleted).toBe(true);
  });

  it("newer local delete wins and signals write-back so RTDB gets the deletion", () => {
    // Local has the newer delete - local wins, write-back needed
    const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [task("t1", { isDeleted: false, lastUpdated: 100 })] },
      { ...base, tasks: [task("t1", { isDeleted: true, lastUpdated: 200 })] }
    );
    expect(hasLocalContribution).toBe(true);
    expect(merged.tasks[0].isDeleted).toBe(true);
  });

  it("no write-back when remote has no tasks and local has only deleted tasks", () => {
    const { hasLocalContribution } = mergeRemotePayloadWithMeta(
      { ...base, tasks: [] },
      { ...base, tasks: [task("t1", { isDeleted: true })] }
    );
    expect(hasLocalContribution).toBe(false);
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
    // Drop from 5 active (completed but not deleted count) to 1 -> suspicious
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
    // Drop of 0 active tasks -> not suspicious.
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

describe("mergeLocalIntoServer - outgoing write safety (full-payload save must not erase another device's work)", () => {
  const task = (uuid, overrides = {}) => ({
    id: 1, uuid, userId: "u", title: `Task ${uuid}`, isDeleted: false, lastUpdated: 100, ...overrides,
  });

  it("writes the local payload as-is when the server has nothing yet (first run of the transaction)", () => {
    const local = { userId: "u", tasks: [task("a")], config: { userId: "u" }, timestamp: 500 };
    const result = mergeLocalIntoServer(null, local, null);
    expect(result.tasks.map(t => t.uuid)).toEqual(["a"]);
    expect(result.timestamp).toBe(500);
  });

  it("phone reconnects after offline edits: tasks the laptop added meanwhile survive the phone's save", () => {
    // Phone's stale copy: only task a (ticked off while offline). Laptop added b and c.
    const local = {
      userId: "u",
      tasks: [task("a", { isCompleted: true, lastUpdated: 300 })],
      config: { userId: "u" },
      timestamp: 300,
    };
    const server = {
      userId: "u",
      tasks: [task("a"), task("b", { lastUpdated: 250 }), task("c", { lastUpdated: 260 })],
      config: { userId: "u" },
      timestamp: 260,
    };
    const result = mergeLocalIntoServer(server, local, null);
    expect(result.tasks.map(t => t.uuid).sort()).toEqual(["a", "b", "c"]);
    expect(result.tasks.find(t => t.uuid === "a").isCompleted).toBe(true);
  });

  it("a task edited more recently on the other device keeps that edit", () => {
    const local = { userId: "u", tasks: [task("a", { title: "old title", lastUpdated: 100 })], config: {}, timestamp: 100 };
    const server = { userId: "u", tasks: [task("a", { title: "new title", lastUpdated: 200 })], config: {}, timestamp: 200 };
    const result = mergeLocalIntoServer(server, local, null);
    expect(result.tasks[0].title).toBe("new title");
  });

  it("on an equal task timestamp the local copy wins (it is this device's own write)", () => {
    const local = { userId: "u", tasks: [task("a", { title: "mine", lastUpdated: 100 })], config: {}, timestamp: 100 };
    const server = { userId: "u", tasks: [task("a", { title: "theirs", lastUpdated: 100 })], config: {}, timestamp: 100 };
    expect(mergeLocalIntoServer(server, local, null).tasks[0].title).toBe("mine");
  });

  it("a task deleted more recently on the other device stays deleted, and its tombstone is kept", () => {
    const local = { userId: "u", tasks: [task("a", { lastUpdated: 100 }), task("b", { lastUpdated: 100 })], config: {}, timestamp: 100 };
    const server = { userId: "u", tasks: [task("a", { isDeleted: true, lastUpdated: 200 })], config: {}, timestamp: 200 };
    const result = mergeLocalIntoServer(server, local, null);
    expect(result.tasks.find(t => t.uuid === "a").isDeleted).toBe(true);
    expect(result.tasks.find(t => t.uuid === "b")).toBeTruthy();
  });

  it("local-only new tasks are written (an add on this device is never dropped)", () => {
    const local = { userId: "u", tasks: [task("a"), task("new")], config: {}, timestamp: 100 };
    const server = { userId: "u", tasks: [task("a")], config: {}, timestamp: 100 };
    expect(mergeLocalIntoServer(server, local, null).tasks.map(t => t.uuid)).toEqual(["a", "new"]);
  });

  it("config: a key this device changed since base wins, a key changed elsewhere is not pushed back stale", () => {
    const base = { userId: "u", deadlineLabel: "Thesis", visitStreakCount: 4, lastUpdated: 100 };
    // Laptop resumed from sleep: bumped the streak, still holds the old deadline label.
    const local = { userId: "u", tasks: [], config: { userId: "u", deadlineLabel: "Thesis", visitStreakCount: 5, lastUpdated: 300 }, timestamp: 300 };
    // Phone renamed the deadline this morning.
    const server = { userId: "u", tasks: [], config: { userId: "u", deadlineLabel: "Job offer", visitStreakCount: 4, lastUpdated: 200 }, timestamp: 200 };
    const result = mergeLocalIntoServer(server, local, { config: base, contributions: [] });
    expect(result.config.deadlineLabel).toBe("Job offer");
    expect(result.config.visitStreakCount).toBe(5);
    expect(result.config.lastUpdated).toBe(300);
  });

  it("config: a nudge cleared on the other device (key gone from the server) is not resurrected by a stale save", () => {
    const base = { userId: "u", pendingCoachNudge: { text: "Take a break" }, lastUpdated: 100 };
    const local = { userId: "u", tasks: [], config: { userId: "u", pendingCoachNudge: { text: "Take a break" }, lastUpdated: 100 }, timestamp: 300 };
    const server = { userId: "u", tasks: [], config: { userId: "u", lastUpdated: 200 }, timestamp: 200 };
    const result = mergeLocalIntoServer(server, local, { config: base, contributions: [] });
    expect(result.config).not.toHaveProperty("pendingCoachNudge");
  });

  it("config: with no base, the server's config is authoritative — a key cleared elsewhere is not restored from cache", () => {
    const local = { userId: "u", tasks: [], config: { userId: "u", deadlineLabel: "stale", pendingCoachNudge: { text: "old nudge" } }, timestamp: 300 };
    const server = { userId: "u", tasks: [], config: { userId: "u", deadlineLabel: "fresh" }, timestamp: 200 };
    const result = mergeLocalIntoServer(server, local, null);
    expect(result.config.deadlineLabel).toBe("fresh");
    expect(result.config).not.toHaveProperty("pendingCoachNudge");
  });

  const row = (dateString, count, lastUpdated = 100) => ({ compositeKey: `u_${dateString}`, userId: "u", dateString, count, lastUpdated });
  const withRows = (rows, timestamp) => ({ userId: "u", tasks: [], config: { userId: "u" }, contributions: rows, timestamp });
  const baseOf = (rows) => ({ config: { userId: "u" }, contributions: rows });

  it("contributions: a day both devices completed on keeps the larger count, so this device's own completions are never dropped", () => {
    // Base 3; this device completed two offline (5), the other completed one meanwhile (4).
    const result = mergeLocalIntoServer(withRows([row("d", 4, 200)], 200), withRows([row("d", 5, 150)], 150), baseOf([row("d", 3)]));
    expect(result.contributions[0].count).toBe(5);
    // Idempotent: merging the written result against itself changes nothing (RTDB echoes our own write).
    const echo = withRows(result.contributions, 300);
    expect(mergeLocalIntoServer(echo, echo, baseOf([row("d", 3)])).contributions[0].count).toBe(5);
  });

  it("contributions: a day unchanged here takes the server's count", () => {
    const local = withRows([row("d", 3, 100), row("e", 1, 100)], 150);
    const server = withRows([row("d", 3, 200), row("e", 3, 200)], 200);
    const result = mergeLocalIntoServer(server, local, baseOf([row("d", 3), row("e", 1)]));
    expect(result.contributions.find(c => c.dateString === "d").count).toBe(3);
    expect(result.contributions.find(c => c.dateString === "e").count).toBe(3);
  });

  it("contributions: a reset on the other device stays reset, even after new activity there, while new work here is kept", () => {
    // Base had old days; the other device reset progress and then completed a task today.
    const local = withRows([row("old-1", 2), row("old-2", 1), row("today", 1, 900)], 900);
    const server = withRows([row("today", 1, 800)], 800);
    const result = mergeLocalIntoServer(server, local, baseOf([row("old-1", 2), row("old-2", 1)]));
    expect(result.contributions.map(c => c.dateString)).toEqual(["today"]);
  });

  it("contributions: a reset made here is not undone by rows the server still holds, but a day added there since is kept", () => {
    const local = withRows([], 900);
    const server = withRows([row("old-1", 2), row("new-there", 1, 850)], 850);
    const result = mergeLocalIntoServer(server, local, baseOf([row("old-1", 2)]));
    expect(result.contributions.map(c => c.dateString)).toEqual(["new-there"]);
  });

  it("contributions: with no base the server's rows are authoritative", () => {
    const result = mergeLocalIntoServer(withRows([row("d", 4, 200)], 200), withRows([row("d", 5, 150), row("x", 1)], 150), null);
    expect(result.contributions).toEqual([row("d", 4, 200)]);
  });

  it("tasks: a legacy task without a uuid is matched by id, not duplicated on every save", () => {
    // The local copy was normalized earlier and carries a repaired-* uuid; the server copy never had one.
    const local = { userId: "u", tasks: [{ id: 42, uuid: "repaired-1-0", userId: "u", title: "Legacy", lastUpdated: 200 }], config: {}, timestamp: 200 };
    const server = { userId: "u", tasks: [{ id: 42, userId: "u", title: "Legacy", lastUpdated: 100 }], config: {}, timestamp: 100 };
    const result = mergeLocalIntoServer(server, local, null);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe(42);
  });

  it("incoming merge: with a contribution base, an offline completion not yet on the server survives a newer foreign delivery and is flagged for write-back", () => {
    const base = [row("d", 3)];
    const local = withRows([row("d", 4, 150), row("new-here", 1, 160)], 160);
    // The other device wrote something unrelated later; its rows are still the base's.
    const remote = withRows([row("d", 3, 100)], 900);
    const { merged, hasLocalContribution } = mergeRemotePayloadWithMeta(remote, local, { userId: "u" }, base);
    expect(merged.contributions.find(c => c.dateString === "d").count).toBe(4);
    expect(merged.contributions.find(c => c.dateString === "new-here").count).toBe(1);
    expect(hasLocalContribution).toBe(true);
    // Without a contribution base the remote rows are taken wholesale, as before.
    expect(mergeRemotePayloadWithMeta(remote, local, { userId: "u" }).merged.contributions).toEqual([row("d", 3, 100)]);
  });

  it("tasks: the incoming merge matches a legacy task without a uuid by id too, so cache and server copies stay one task", () => {
    const remote = { userId: "u", tasks: [{ id: 42, userId: "u", title: "Legacy", lastUpdated: 100 }], config: {}, timestamp: 100 };
    const local = { userId: "u", tasks: [{ id: 42, uuid: "repaired-1-0", userId: "u", title: "Legacy", lastUpdated: 100 }], config: {}, timestamp: 100 };
    expect(mergeRemotePayload(remote, local).tasks).toHaveLength(1);
  });

  it("brainDump: the side with the newer brainDumpUpdatedAt wins", () => {
    const local = { userId: "u", tasks: [], config: {}, brainDump: [{ id: 1, text: "old" }], brainDumpUpdatedAt: 100, timestamp: 100 };
    const server = { userId: "u", tasks: [], config: {}, brainDump: [{ id: 2, text: "new" }], brainDumpUpdatedAt: 200, timestamp: 200 };
    const result = mergeLocalIntoServer(server, local, null);
    expect(result.brainDump).toEqual([{ id: 2, text: "new" }]);
    expect(result.brainDumpUpdatedAt).toBe(200);
    const flipped = mergeLocalIntoServer(local, server, null);
    expect(flipped.brainDump).toEqual([{ id: 2, text: "new" }]);
  });

  it("the written timestamp is the max of both sides so neither device reads the write as stale", () => {
    const local = { userId: "u", tasks: [], config: {}, timestamp: 100 };
    const server = { userId: "u", tasks: [], config: {}, timestamp: 900 };
    expect(mergeLocalIntoServer(server, local, null).timestamp).toBe(900);
    expect(mergeLocalIntoServer(local, server, null).timestamp).toBe(900);
  });
});

describe("rule caps on config strings and chat messages (one over-long value must not break every later save)", () => {
  it("normalizePayload clamps userName/mentorName/deadlineLabel to 100 and intentionMessage to 500", () => {
    const long = "x".repeat(700);
    const result = normalizePayload({ userId: "u", tasks: [], config: { userId: "u", userName: long, mentorName: long, deadlineLabel: long, intentionMessage: long } });
    expect(result.config.userName).toHaveLength(100);
    expect(result.config.mentorName).toHaveLength(100);
    expect(result.config.deadlineLabel).toHaveLength(100);
    expect(result.config.intentionMessage).toHaveLength(500);
  });

  it("clampConfigStringsForRules returns the same object when nothing is over the cap, and leaves other keys alone", () => {
    const patch = { userName: "Rohan", visitStreakCount: 3, coachMemory: { pinned: [] } };
    expect(clampConfigStringsForRules(patch)).toBe(patch);
    const clamped = clampConfigStringsForRules({ userName: "y".repeat(150), visitStreakCount: 3 });
    expect(clamped.userName).toHaveLength(100);
    expect(clamped.visitStreakCount).toBe(3);
  });

  it("clampConfigStringsForRules coerces a non-string value (the rule accepts only a string or nothing) and keeps null", () => {
    expect(clampConfigStringsForRules({ userName: 42 }).userName).toBe("42");
    expect(clampConfigStringsForRules({ deadlineLabel: null }).deadlineLabel).toBeNull();
  });

  it("a Coach reply over 5000 characters is cut to the cap, and messages keep only text/isUser/actions", () => {
    const history = [
      { text: "hi", isUser: true, id: "extra-key-the-rules-reject" },
      { text: "r".repeat(6000), isUser: false, actions: [{ matched: true }] },
    ];
    const result = sanitizeChatHistoryForRules(history);
    expect(result[0]).toEqual({ text: "hi", isUser: true });
    expect(result[1].text).toHaveLength(5000);
    expect(result[1].isUser).toBe(false);
    expect(result[1].actions).toEqual([{ matched: true }]);
  });

  it("chat messages with a missing or non-string text are coerced to a string, and non-objects are dropped", () => {
    const result = sanitizeChatHistoryForRules([{ isUser: false }, null, "junk", { text: 7, isUser: true }]);
    expect(result).toEqual([{ text: "", isUser: false }, { text: "7", isUser: true }]);
  });

  it("normalizePayload sanitizes chatHistory when present and leaves the key absent when it is not", () => {
    const withChat = normalizePayload({ userId: "u", tasks: [], config: {}, chatHistory: [{ text: "a".repeat(5001), isUser: false }] });
    expect(withChat.chatHistory[0].text).toHaveLength(5000);
    expect(normalizePayload({ userId: "u", tasks: [], config: {} })).not.toHaveProperty("chatHistory");
    expect(sanitizeChatHistoryForRules(null)).toBeNull();
  });
});
