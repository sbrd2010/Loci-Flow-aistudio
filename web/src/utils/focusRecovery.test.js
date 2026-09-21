import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildFocusSnapshot, bellMomentFor, recoverableFocusEntry,
  readFocusSnapshot, writeFocusSnapshot, clearFocusSnapshot, focusSnapshotKey,
} from "./focusRecovery";
import { getFocusWindows } from "./focusWindows";

const windows = getFocusWindows({ dayStartHour: 7, dayEndHour: 26 });
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const task = { uuid: "task-1", category: "Career", priority: "P1", horizonLevel: "today" };

const snap = (over = {}) => buildFocusSnapshot({
  uid: "uid1",
  focusSessionId: "session-1",
  focusStartedAt: at(2026, 7, 10, 21, 35),
  focusInitialPlannedSeconds: 1500,
  accumulatedElapsedSeconds: 0,
  accumulatedPlannedSeconds: 0,
  blockPlannedSeconds: 1500,
  deadlineAt: at(2026, 7, 10, 22, 0),
  bellAt: null,
  running: true,
  rang: false,
  task,
  ...over,
});

describe("buildFocusSnapshot", () => {
  it("refuses to build without the identity a recovery would need", () => {
    expect(buildFocusSnapshot({ uid: null, focusSessionId: "s", task })).toBeNull();
    expect(buildFocusSnapshot({ uid: "uid1", focusSessionId: null, task })).toBeNull();
    expect(buildFocusSnapshot({ uid: "uid1", focusSessionId: "s", task: {} })).toBeNull();
  });

  it("keeps only the task fields the ledger records, never free text", () => {
    const s = snap({ task: { ...task, title: "Something private", notes: "and more" } });
    expect(s.task).toEqual({ uuid: "task-1", category: "Career", priority: "P1", horizonLevel: "today" });
  });

  it("omits task fields that are absent rather than inventing defaults", () => {
    const s = snap({ task: { uuid: "task-2" } });
    expect(s.task).toEqual({ uuid: "task-2" });
  });
});

describe("bellMomentFor — when the ledger is owed a block", () => {
  it("is null while the block is still running and its deadline is ahead", () => {
    expect(bellMomentFor(snap(), at(2026, 7, 10, 21, 50))).toBeNull();
  });

  it("is the deadline once it has passed unseen — the bell that never fired", () => {
    expect(bellMomentFor(snap(), at(2026, 7, 11, 9, 0))).toBe(at(2026, 7, 10, 22, 0));
  });

  it("is the bell moment when it rang, however long ago", () => {
    const s = snap({ running: false, rang: true, bellAt: at(2026, 7, 10, 22, 0), deadlineAt: null });
    expect(bellMomentFor(s, at(2026, 7, 14, 9, 0))).toBe(at(2026, 7, 10, 22, 0));
  });

  it("is null for a paused session — we cannot know when the process died", () => {
    // The honest answer. Crediting the whole block here would invent minutes
    // for time the user may have spent doing something else entirely.
    expect(bellMomentFor(snap({ running: false, rang: false }), at(2026, 7, 11, 9, 0))).toBeNull();
  });
});

describe("recoverableFocusEntry", () => {
  const opts = (over = {}) => ({ uid: "uid1", now: at(2026, 7, 11, 9, 0), windows, ...over });

  it("owes nothing while the block is still running", () => {
    expect(recoverableFocusEntry(snap(), opts({ now: at(2026, 7, 10, 21, 50) }))).toBeNull();
  });

  it("credits the whole block once its deadline has passed", () => {
    const r = recoverableFocusEntry(snap(), opts());
    expect(r.options.focusElapsedSeconds).toBe(1500);
    expect(r.options.focusEndReason).toBe("timer_elapsed_recovered");
    expect(r.task.uuid).toBe("task-1");
  });

  it("adds the block to what earlier blocks already banked", () => {
    // 25m rung, "+20m" taken, then the app died with that block run out too.
    const r = recoverableFocusEntry(
      snap({ accumulatedElapsedSeconds: 1500, accumulatedPlannedSeconds: 1500, blockPlannedSeconds: 1200 }),
      opts()
    );
    expect(r.options.focusElapsedSeconds).toBe(2700);
    expect(r.options.focusFinalPlannedSeconds).toBe(2700);
  });

  it("timestamps at the BELL, not at the recovery", () => {
    // Opened three days later: the minutes still belong to the night they
    // were worked, because every figure downstream buckets by Loci day.
    const r = recoverableFocusEntry(snap(), opts({ now: at(2026, 7, 14, 9, 0) }));
    expect(r.options.now).toBe(at(2026, 7, 10, 22, 0));
    expect(r.options.lociDateString).toBe("2026-07-10");
  });

  it("files a block that ended after midnight on the Loci day it belonged to", () => {
    // dayEndHour 26: the Loci day runs to 02:00, so a 01:50 bell is still
    // the 10th's, not the 11th's.
    const r = recoverableFocusEntry(
      snap({ deadlineAt: at(2026, 7, 11, 1, 50) }),
      opts({ now: at(2026, 7, 11, 9, 0) })
    );
    expect(r.options.lociDateString).toBe("2026-07-10");
  });

  it("reuses the identity the bell pinned, so recovery AMENDS its entry", () => {
    const s = snap({ rang: true, running: false, bellAt: at(2026, 7, 10, 22, 0), entry: { eventId: "evt-held", lociDateString: "2026-07-10" } });
    const r = recoverableFocusEntry(s, opts());
    expect(r.options.eventId).toBe("evt-held");
    expect(r.options.lociDateString).toBe("2026-07-10");
  });

  it("derives a DETERMINISTIC id when no bell ever pinned one", () => {
    // Two recoveries of the same snapshot must land on one path, or the
    // session is credited twice.
    const a = recoverableFocusEntry(snap(), opts());
    const b = recoverableFocusEntry(snap(), opts());
    expect(a.options.eventId).toBe("session-1");
    expect(b.options.eventId).toBe(a.options.eventId);
  });

  it("never recovers one account's session into another's ledger", () => {
    expect(recoverableFocusEntry(snap(), opts({ uid: "uid2" }))).toBeNull();
    expect(recoverableFocusEntry(snap(), opts({ uid: null }))).toBeNull();
  });

  it("ignores a record written by a different version", () => {
    expect(recoverableFocusEntry({ ...snap(), v: 99 }, opts())).toBeNull();
  });

  it("owes nothing for a block with no length to credit", () => {
    expect(recoverableFocusEntry(snap({ blockPlannedSeconds: 0 }), opts())).toBeNull();
  });
});

describe("the stored record", () => {
  // Same in-memory stand-in useSync.test.js uses: this repo's vitest runs in
  // the node environment, which has no localStorage of its own.
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it("round-trips through storage", () => {
    writeFocusSnapshot("uid1", snap());
    expect(readFocusSnapshot("uid1")).toEqual(snap());
  });

  it("is scoped per account", () => {
    writeFocusSnapshot("uid1", snap());
    expect(readFocusSnapshot("uid2")).toBeNull();
    expect(focusSnapshotKey("uid1")).not.toBe(focusSnapshotKey("uid2"));
  });

  it("clears", () => {
    writeFocusSnapshot("uid1", snap());
    clearFocusSnapshot("uid1");
    expect(readFocusSnapshot("uid1")).toBeNull();
  });

  it("treats unreadable or foreign content as absent, never as a crash", () => {
    localStorage.setItem(focusSnapshotKey("uid1"), "{not json");
    expect(readFocusSnapshot("uid1")).toBeNull();
    localStorage.setItem(focusSnapshotKey("uid1"), JSON.stringify({ v: 99 }));
    expect(readFocusSnapshot("uid1")).toBeNull();
  });

  it("does nothing without a uid, rather than writing to a shared key", () => {
    expect(writeFocusSnapshot(null, snap())).toBe(false);
    expect(readFocusSnapshot(null)).toBeNull();
  });

  it("degrades quietly when storage throws — private mode, blocked site data", () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    };
    // A session that cannot be persisted is a session that cannot be
    // recovered, which is the state before this change — never a crash in
    // the middle of someone's focus block.
    expect(writeFocusSnapshot("uid1", snap())).toBe(false);
    expect(readFocusSnapshot("uid1")).toBeNull();
    expect(clearFocusSnapshot("uid1")).toBe(false);
  });

  it("survives a platform with no storage at all", () => {
    delete globalThis.localStorage;
    expect(writeFocusSnapshot("uid1", snap())).toBe(false);
    expect(readFocusSnapshot("uid1")).toBeNull();
  });
});
