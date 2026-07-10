import { describe, it, expect, vi, beforeEach } from "vitest";

const refMock = vi.fn((db, path) => ({ __path: path }));
const updateMock = vi.fn();
const runTransactionMock = vi.fn();

vi.mock("firebase/database", () => ({
  ref: (...args) => refMock(...args),
  update: (...args) => updateMock(...args),
  runTransaction: (...args) => runTransactionMock(...args),
  onValue: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  goOffline: vi.fn(),
  goOnline: vi.fn(),
}));

vi.mock("./firebase", () => ({
  db: {},
  auth: { currentUser: null },
}));

import { gatePayloadToUid, writeActivityEvents, captureTodaySnapshotIfNeeded } from "./useSync";

// Tests for the uid-isolation gate that prevents a previous user's payload from
// being visible to App-level effects during the render cycle that follows a uid change.
describe("gatePayloadToUid", () => {
  const userAPayload = { tasks: [{ uuid: "t1", title: "Task A" }], config: { userName: "Alice" } };
  const userBPayload = { tasks: [{ uuid: "t2", title: "Task B" }], config: { userName: "Bob" } };

  it("returns payload when payloadUid matches currentUid (normal same-user case)", () => {
    expect(gatePayloadToUid(userAPayload, "uid-a", "uid-a")).toBe(userAPayload);
  });

  it("returns null when payloadUid differs from currentUid (uid-change gap)", () => {
    // uid changed to B but payloadUidRef still holds A's uid — must gate
    expect(gatePayloadToUid(userAPayload, "uid-a", "uid-b")).toBeNull();
  });

  it("returns null when currentUid is null (logged-out state)", () => {
    expect(gatePayloadToUid(userAPayload, "uid-a", null)).toBeNull();
    expect(gatePayloadToUid(userAPayload, "uid-a", undefined)).toBeNull();
  });

  it("returns null when payloadUid is null (payload not yet assigned to any uid)", () => {
    expect(gatePayloadToUid(userBPayload, null, "uid-b")).toBeNull();
  });

  it("returns null when both payload and payloadUid are null", () => {
    expect(gatePayloadToUid(null, null, "uid-b")).toBeNull();
  });

  it("returns null for the payload when payload itself is null but uid matches", () => {
    // payloadUid was cleared when uid changed; uid now set but no data yet
    expect(gatePayloadToUid(null, "uid-b", "uid-b")).toBeNull();
  });

  it("does not allow user A payload to be visible under user B uid", () => {
    // This is the exact cross-contamination scenario from the P0 bug report
    const result = gatePayloadToUid(userAPayload, "uid-a", "uid-b");
    expect(result).toBeNull();
    // Specifically: user B must not see user A's tasks or config
    expect(result?.config?.userName).toBeUndefined();
    expect(result?.tasks).toBeUndefined();
  });

  it("allows user B payload to be visible under user B uid after data loads", () => {
    const result = gatePayloadToUid(userBPayload, "uid-b", "uid-b");
    expect(result).toBe(userBPayload);
    expect(result.config.userName).toBe("Bob");
  });

  it("handles same-user cache reload correctly (uid unchanged, payload refreshed)", () => {
    const freshPayload = { tasks: [{ uuid: "t1" }, { uuid: "t2" }], config: {} };
    expect(gatePayloadToUid(freshPayload, "uid-a", "uid-a")).toBe(freshPayload);
  });
});

// writeActivityEvents/captureTodaySnapshotIfNeeded are the standalone,
// uid-parameterized analytics-write primitives PR A's write-path
// instrumentation sequences after a confirmed core task write. Kept outside
// the useSync hook specifically so they're testable here against mocked
// firebase/database calls without needing to render the hook (this repo has
// no hook-rendering test infra).
describe("writeActivityEvents", () => {
  beforeEach(() => {
    refMock.mockClear();
    updateMock.mockReset();
    runTransactionMock.mockReset();
  });

  it("returns ok:false without calling update() when uid is missing", async () => {
    const result = await writeActivityEvents(null, { "activityLogs/x/events/2026-07-10/e1": { type: "task_created" } });
    expect(result).toEqual({ ok: false, reason: "no-uid" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("resolves ok:true after a single successful update() call with the exact paths given", async () => {
    updateMock.mockResolvedValueOnce(undefined);
    const pathsToValues = { "activityLogs/uid1/events/2026-07-10/e1": { type: "task_created" } };
    const result = await writeActivityEvents("uid1", pathsToValues);
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), pathsToValues);
  });

  it("retries on transient failure and succeeds once a later attempt resolves", async () => {
    updateMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    const result = await writeActivityEvents("uid1", { "activityLogs/uid1/events/2026-07-10/e2": {} }, 2);
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it("fails soft after exhausting retries — resolves { ok:false }, never throws, and logs a missed-event record", async () => {
    const err = new Error("permission-denied");
    updateMock.mockRejectedValue(err);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pathsToValues = { "activityLogs/uid1/events/2026-07-10/e3": {} };

    const result = await writeActivityEvents("uid1", pathsToValues, 2);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("write-failed");
    expect(result.error).toBe(err);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "[Loci activity ledger] Missed event(s) after retries:",
      Object.keys(pathsToValues),
      err
    );
    errorSpy.mockRestore();
  });

  it("fires a write-once instrumentationStartedAt marker after a successful event write, without blocking or affecting the result", async () => {
    updateMock.mockResolvedValueOnce(undefined);
    let capturedPath, capturedUpdateFn;
    runTransactionMock.mockImplementation(async (dbRef, updateFn) => {
      capturedPath = dbRef.__path;
      capturedUpdateFn = updateFn;
      return { committed: true };
    });

    const result = await writeActivityEvents("uid1", { "activityLogs/uid1/events/2026-07-10/e1": {} });
    expect(result).toEqual({ ok: true }); // unaffected by the fire-and-forget marker call

    await Promise.resolve(); // flush the not-awaited markInstrumentationStartedIfNeeded microtask
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(capturedPath).toBe("activityLogs/uid1/meta/instrumentationStartedAt");
    // The write-once guard: abort (return undefined) if already set, only write if null.
    expect(capturedUpdateFn(1700000000000)).toBeUndefined();
    expect(typeof capturedUpdateFn(null)).toBe("number");
  });

  it("does not fire the instrumentationStartedAt marker when the event write ultimately fails", async () => {
    updateMock.mockRejectedValue(new Error("permission-denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await writeActivityEvents("uid1", { "activityLogs/uid1/events/2026-07-10/e1": {} }, 1);
    await Promise.resolve();

    expect(runTransactionMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("captureTodaySnapshotIfNeeded", () => {
  beforeEach(() => {
    refMock.mockClear();
    runTransactionMock.mockReset();
  });

  const windows = [{ startMin: 420, endMin: 1560, overnight: true }]; // 7am-2am
  const tasks = [
    { uuid: "a", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false },
    { uuid: "b", horizonLevel: "today", isCompleted: true, isDeleted: false, isParked: false },
  ];

  it("returns ok:false without calling runTransaction when uid is missing", async () => {
    const result = await captureTodaySnapshotIfNeeded(null, tasks, windows);
    expect(result).toEqual({ ok: false, reason: "no-uid" });
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("commits the snapshot when no value exists yet at that day's path (transaction fn returns the snapshot)", async () => {
    let capturedUpdateFn;
    runTransactionMock.mockImplementation(async (_ref, updateFn) => {
      capturedUpdateFn = updateFn;
      const next = updateFn(null); // simulate: nothing there yet
      return { committed: next !== undefined, snapshot: next };
    });

    const result = await captureTodaySnapshotIfNeeded("uid1", tasks, windows);

    expect(result.ok).toBe(true);
    expect(result.committed).toBe(true);
    // the transaction function must abort (return undefined) if something is already there —
    // verify directly, since this is the multi-device race guard the plan requires.
    expect(capturedUpdateFn({ schemaVersion: 1, todayTaskIds: ["a"] })).toBeUndefined();
  });

  it("does not overwrite an existing snapshot — a second device's transaction sees committed:false", async () => {
    runTransactionMock.mockImplementation(async (_ref, updateFn) => {
      const next = updateFn({ schemaVersion: 1, lociDateString: "2026-07-10", capturedAt: 1, todayTaskIds: ["a"] });
      return { committed: next !== undefined, snapshot: next };
    });

    const result = await captureTodaySnapshotIfNeeded("uid1", tasks, windows);
    expect(result.ok).toBe(true);
    expect(result.committed).toBe(false);
  });

  it("fails soft when the transaction itself rejects — resolves { ok:false }, never throws", async () => {
    const err = new Error("permission-denied");
    runTransactionMock.mockRejectedValue(err);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await captureTodaySnapshotIfNeeded("uid1", tasks, windows);

    expect(result).toEqual({ ok: false, reason: "write-failed", error: err });
    errorSpy.mockRestore();
  });

  it("also fires the write-once instrumentationStartedAt marker after a successful snapshot capture", async () => {
    const seenPaths = [];
    runTransactionMock.mockImplementation(async (dbRef, updateFn) => {
      seenPaths.push(dbRef.__path);
      const next = updateFn(null);
      return { committed: next !== undefined, snapshot: next };
    });

    await captureTodaySnapshotIfNeeded("uid1", tasks, windows);
    await Promise.resolve(); // flush the not-awaited markInstrumentationStartedIfNeeded microtask

    expect(seenPaths).toContain("activityLogs/uid1/meta/instrumentationStartedAt");
  });
});
