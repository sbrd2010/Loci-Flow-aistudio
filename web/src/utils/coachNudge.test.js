import { describe, expect, it } from "vitest";
import { getCoachNudge, buildCoachNudgeShownConfig, buildPendingCoachNudge } from "./coachNudge";

function task(overrides = {}) {
  return {
    uuid: Math.random().toString(36).slice(2),
    title: "Task",
    horizonLevel: "today",
    priority: "P3",
    timeEstimateMinutes: 25,
    isCompleted: false,
    isDeleted: false,
    isParked: false,
    orderIndex: 0,
    ...overrides,
  };
}

describe("getCoachNudge", () => {
  const date = new Date(2026, 5, 13, 10, 0); // 10:00, well clear of Evening Guard

  it("returns the signal when an active task gives a non-quiet signal", () => {
    const payload = { tasks: [task({ priority: "P1", isNowFocus: true })], config: {} };
    const nudge = getCoachNudge(payload, date);
    expect(nudge).not.toBeNull();
    expect(nudge.level).toBe("anchor");
    expect(nudge.reason).toBe("now_focus_active");
  });

  it("returns null when coachNudgesEnabled is false", () => {
    const payload = { tasks: [task({ isNowFocus: true })], config: { coachNudgesEnabled: false } };
    expect(getCoachNudge(payload, date)).toBeNull();
  });

  it("returns null when Low Energy Mode is on", () => {
    const payload = { tasks: [task({ isNowFocus: true })], config: { isLowEnergyMode: true } };
    expect(getCoachNudge(payload, date)).toBeNull();
  });

  it("returns null during the Evening Guard window", () => {
    const evening = new Date(2026, 5, 13, 21, 0); // 21:00
    const payload = { tasks: [task({ isNowFocus: true })], config: { eveningGuardWindowActive: true } };
    expect(getCoachNudge(payload, evening)).toBeNull();
  });

  it("allows nudges before the Evening Guard cutoff even if the window is active", () => {
    const payload = { tasks: [task({ isNowFocus: true })], config: { eveningGuardWindowActive: true } };
    expect(getCoachNudge(payload, date)).not.toBeNull();
  });

  it("returns null when already shown today", () => {
    const payload = { tasks: [task({ isNowFocus: true })], config: { coachNudgeShownDate: "2026-06-13" } };
    expect(getCoachNudge(payload, date)).toBeNull();
  });

  it("returns null when the underlying signal is quiet-level", () => {
    // No deadline, no now-focus, no day-map task, normal load → "quiet" level
    const payload = { tasks: [task()], config: {} };
    const signal = getCoachNudge(payload, date);
    expect(signal).toBeNull();
  });

  it("returns null when the underlying signal has nothing to show", () => {
    const payload = { tasks: [], config: {} };
    expect(getCoachNudge(payload, date)).toBeNull();
  });
});

describe("buildCoachNudgeShownConfig", () => {
  it("stamps today's local date", () => {
    const date = new Date(2026, 5, 13, 10, 0);
    expect(buildCoachNudgeShownConfig(date)).toEqual({ coachNudgeShownDate: "2026-06-13" });
  });
});

describe("buildPendingCoachNudge", () => {
  it("extracts the fields CoachTab needs from a signal", () => {
    const signal = { shouldShow: true, level: "anchor", reason: "now_focus_active", title: "Stay with the pinned task", body: "Open Task and do only the next tiny step.", primaryTaskUuid: "abc-123" };
    expect(buildPendingCoachNudge(signal)).toEqual({
      reason: "now_focus_active",
      title: "Stay with the pinned task",
      body: "Open Task and do only the next tiny step.",
      primaryTaskUuid: "abc-123",
    });
  });

  it("defaults primaryTaskUuid to null when absent", () => {
    const signal = { reason: "x", title: "t", body: "b" };
    expect(buildPendingCoachNudge(signal).primaryTaskUuid).toBeNull();
  });
});
