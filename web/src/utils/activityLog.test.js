import { describe, it, expect } from "vitest";
import {
  activityEventPath,
  activitySnapshotPath,
  activityMetaPath,
  eventPatch,
  eventsPatch,
  buildTaskMutationEvent,
  buildFocusStartedEvent,
  buildFocusTerminalEvent,
  buildTodaySnapshot,
} from "./activityLog";
import { getFocusWindows } from "./focusWindows";

const dt = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);
const windows = getFocusWindows({ dayStartHour: 7, dayEndHour: 26 });

const task = {
  uuid: "task-1",
  category: "Career",
  priority: "P1",
  horizonLevel: "today",
};

describe("path builders", () => {
  it("builds a per-event path keyed by lociDateString and eventId", () => {
    expect(activityEventPath("uid1", "2026-07-10", "evt1")).toBe(
      "activityLogs/uid1/events/2026-07-10/evt1"
    );
  });

  it("builds a per-day snapshot path", () => {
    expect(activitySnapshotPath("uid1", "2026-07-10")).toBe(
      "activityLogs/uid1/snapshots/2026-07-10"
    );
  });

  it("builds a meta path", () => {
    expect(activityMetaPath("uid1", "instrumentationStartedAt")).toBe(
      "activityLogs/uid1/meta/instrumentationStartedAt"
    );
  });
});

describe("eventPatch / eventsPatch", () => {
  it("wraps a single event as a {path: event} patch keyed by its own lociDateString/eventId", () => {
    const ev = buildTaskMutationEvent("task_created", task, { now: dt(2026, 7, 10, 10), windows });
    const patch = eventPatch("uid1", ev);
    expect(Object.keys(patch)).toEqual([`activityLogs/uid1/events/2026-07-10/${ev.eventId}`]);
    expect(patch[`activityLogs/uid1/events/2026-07-10/${ev.eventId}`]).toBe(ev);
  });

  it("wraps several events as one patch, one key per event, for a single analytics-only update() call", () => {
    const evA = buildTaskMutationEvent("task_parked", { ...task, uuid: "a" }, { now: dt(2026, 7, 10, 10), windows });
    const evB = buildTaskMutationEvent("task_parked", { ...task, uuid: "b" }, { now: dt(2026, 7, 10, 10), windows });
    const patch = eventsPatch("uid1", [evA, evB]);
    expect(Object.keys(patch)).toHaveLength(2);
    expect(patch[`activityLogs/uid1/events/2026-07-10/${evA.eventId}`]).toBe(evA);
    expect(patch[`activityLogs/uid1/events/2026-07-10/${evB.eventId}`]).toBe(evB);
  });

  it("returns an empty patch for an empty event list", () => {
    expect(eventsPatch("uid1", [])).toEqual({});
  });
});

describe("buildTaskMutationEvent", () => {
  it("stamps the base fields and taskSnapshot for a minimal call", () => {
    const ev = buildTaskMutationEvent("task_created", task, { now: dt(2026, 7, 10, 10), windows });
    expect(ev.type).toBe("task_created");
    expect(ev.schemaVersion).toBe(1);
    expect(ev.taskId).toBe("task-1");
    expect(ev.lociDateString).toBe("2026-07-10");
    expect(typeof ev.utcTimestamp).toBe("number");
    expect(ev.source).toBe("user");
    expect(ev.taskSnapshot).toEqual({ category: "Career", priority: "P1", horizonLevel: "today" });
    expect(typeof ev.eventId).toBe("string");
    expect(ev.eventId.length).toBeGreaterThan(0);
  });

  it("omits fromState/toState entirely when not supplied (sparse, not null-padded)", () => {
    const ev = buildTaskMutationEvent("task_completed", task, { now: dt(2026, 7, 10, 10), windows });
    expect("fromState" in ev).toBe(false);
    expect("toState" in ev).toBe(false);
  });

  it("includes fromState/toState only when the caller supplies them", () => {
    const ev = buildTaskMutationEvent("task_moved", task, {
      fromState: { horizonLevel: "week" },
      toState: { horizonLevel: "today" },
      now: dt(2026, 7, 10, 10),
      windows,
    });
    expect(ev.fromState).toEqual({ horizonLevel: "week" });
    expect(ev.toState).toEqual({ horizonLevel: "today" });
  });

  it("generates a distinct eventId on every call (idempotency-key uniqueness)", () => {
    const a = buildTaskMutationEvent("task_created", task, { now: dt(2026, 7, 10, 10), windows });
    const b = buildTaskMutationEvent("task_created", task, { now: dt(2026, 7, 10, 10), windows });
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("respects a caller-supplied source", () => {
    const ev = buildTaskMutationEvent("task_parked", task, { source: "coach_action", now: dt(2026, 7, 10, 10), windows });
    expect(ev.source).toBe("coach_action");
  });

  it("falls back taskSnapshot fields when the task is missing them", () => {
    const bareTask = { uuid: "task-2" };
    const ev = buildTaskMutationEvent("task_created", bareTask, { now: dt(2026, 7, 10, 10), windows });
    expect(ev.taskSnapshot).toEqual({ category: "Personal", priority: "P3", horizonLevel: "today" });
  });

  it("accepts now as an epoch-ms number (not just a Date) without crashing", () => {
    const nowMs = dt(2026, 7, 10, 10).getTime();
    const ev = buildTaskMutationEvent("task_created", task, { now: nowMs, windows });
    expect(ev.utcTimestamp).toBe(nowMs);
    expect(ev.lociDateString).toBe("2026-07-10");
  });

  it("does not crash when windows is omitted (falls back to a default window)", () => {
    const ev = buildTaskMutationEvent("task_created", task, { now: dt(2026, 7, 10, 10) });
    expect(ev.lociDateString).toBe("2026-07-10");
  });
});

describe("buildFocusStartedEvent / buildFocusTerminalEvent", () => {
  it("focus_started carries no fromState/toState — a distinct shape from task-mutation events", () => {
    const ev = buildFocusStartedEvent(task, "session-1", {
      focusInitialPlannedSeconds: 1500,
      now: dt(2026, 7, 10, 10),
      windows,
    });
    expect(ev.type).toBe("focus_started");
    expect(ev.focusSessionId).toBe("session-1");
    expect(ev.focusInitialPlannedSeconds).toBe(1500);
    expect(typeof ev.focusStartedAt).toBe("number");
    expect("fromState" in ev).toBe(false);
    expect("toState" in ev).toBe(false);
  });

  it("terminal event preserves focusStartedAt/focusInitialPlannedSeconds from the start event rather than recomputing them", () => {
    const started = buildFocusStartedEvent(task, "session-1", {
      focusInitialPlannedSeconds: 1500,
      now: dt(2026, 7, 10, 10),
      windows,
    });
    const terminal = buildFocusTerminalEvent("focus_completed", task, "session-1", {
      focusStartedAt: started.focusStartedAt,
      focusInitialPlannedSeconds: started.focusInitialPlannedSeconds,
      focusFinalPlannedSeconds: 1500,
      focusElapsedSeconds: 1490,
      focusEndReason: "completed_task",
      now: dt(2026, 7, 10, 10, 25),
      windows,
    });
    expect(terminal.focusStartedAt).toBe(started.focusStartedAt);
    expect(terminal.focusInitialPlannedSeconds).toBe(started.focusInitialPlannedSeconds);
    expect(terminal.focusEndedAt).toBeGreaterThan(terminal.focusStartedAt);
    expect(terminal.focusEndReason).toBe("completed_task");
    expect(terminal.focusSessionId).toBe("session-1");
  });

  it("supports focus_abandoned as a distinct terminal type from focus_completed", () => {
    const terminal = buildFocusTerminalEvent("focus_abandoned", task, "session-2", {
      focusStartedAt: dt(2026, 7, 10, 10).getTime(),
      focusInitialPlannedSeconds: 1500,
      focusFinalPlannedSeconds: 1500,
      focusElapsedSeconds: 300,
      focusEndReason: "user_abandoned",
      now: dt(2026, 7, 10, 10, 5),
      windows,
    });
    expect(terminal.type).toBe("focus_abandoned");
    expect(terminal.focusEndReason).toBe("user_abandoned");
  });
});

describe("buildTodaySnapshot", () => {
  it("includes only today, incomplete, non-deleted, non-parked tasks", () => {
    const tasks = [
      { uuid: "a", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false },
      { uuid: "b", horizonLevel: "today", isCompleted: true, isDeleted: false, isParked: false },
      { uuid: "c", horizonLevel: "week", isCompleted: false, isDeleted: false, isParked: false },
      { uuid: "d", horizonLevel: "today", isCompleted: false, isDeleted: true, isParked: false },
      { uuid: "e", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: true },
    ];
    const snapshot = buildTodaySnapshot(tasks, { now: dt(2026, 7, 10, 8), windows });
    expect(snapshot.todayTaskIds).toEqual(["a"]);
    expect(snapshot.lociDateString).toBe("2026-07-10");
    expect(snapshot.schemaVersion).toBe(1);
    expect(typeof snapshot.capturedAt).toBe("number");
  });

  it("has a schema separate from activity events — no eventId/taskId/source/fromState/toState", () => {
    const snapshot = buildTodaySnapshot([], { now: dt(2026, 7, 10, 8), windows });
    expect("eventId" in snapshot).toBe(false);
    expect("taskId" in snapshot).toBe(false);
    expect("source" in snapshot).toBe(false);
    expect("fromState" in snapshot).toBe(false);
    expect("toState" in snapshot).toBe(false);
  });

  it("returns an empty todayTaskIds array for an empty/undefined tasks list", () => {
    expect(buildTodaySnapshot(undefined, { now: dt(2026, 7, 10, 8), windows }).todayTaskIds).toEqual([]);
    expect(buildTodaySnapshot([], { now: dt(2026, 7, 10, 8), windows }).todayTaskIds).toEqual([]);
  });
});
