import { describe, expect, it } from "vitest";
import {
  getCoachNudge,
  buildCoachNudgeClearedConfig,
  buildPendingCoachNudge,
  isPendingCoachNudgeStale,
  shouldDeliverPendingCoachNudge,
} from "./coachNudge";

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

  it("returns null when already cleared today", () => {
    const payload = { tasks: [task({ isNowFocus: true })], config: { coachNudgeClearedDate: "2026-06-13" } };
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

  // Default focus windows (7am-2am, overnight) put the early-morning hours
  // before 2am in the PREVIOUS Loci day — so the once-per-day gate must use
  // getLociDayStr, not the calendar date, or a nudge cleared late on June 13
  // would wrongly reappear at 1am on June 14.
  it("uses the Loci day, not the calendar date, for the once-per-day gate", () => {
    const earlyMorning = new Date(2026, 5, 14, 1, 0); // 1am June 14 → still June 13's Loci day
    const payload = { tasks: [task({ isNowFocus: true })], config: { coachNudgeClearedDate: "2026-06-13" } };
    expect(getCoachNudge(payload, earlyMorning)).toBeNull();
  });

  it("allows a new nudge once the Loci day actually rolls over", () => {
    const morning = new Date(2026, 5, 14, 8, 0); // 8am June 14 → new Loci day
    const payload = { tasks: [task({ isNowFocus: true })], config: { coachNudgeClearedDate: "2026-06-13" } };
    expect(getCoachNudge(payload, morning)).not.toBeNull();
  });
});

describe("buildCoachNudgeClearedConfig", () => {
  it("stamps today's Loci day", () => {
    const date = new Date(2026, 5, 13, 10, 0);
    expect(buildCoachNudgeClearedConfig({ config: {} }, date)).toEqual({ coachNudgeClearedDate: "2026-06-13" });
  });

  it("stamps the previous Loci day in the early-morning tail of an overnight window", () => {
    const earlyMorning = new Date(2026, 5, 14, 1, 0); // 1am June 14 → Loci day "2026-06-13"
    expect(buildCoachNudgeClearedConfig({ config: {} }, earlyMorning)).toEqual({ coachNudgeClearedDate: "2026-06-13" });
  });
});

describe("buildPendingCoachNudge", () => {
  const signal = { shouldShow: true, level: "anchor", reason: "now_focus_active", title: "Stay with the pinned task", body: "Open Task and do only the next tiny step.", primaryTaskUuid: "abc-123" };

  it("extracts the fields CoachTab needs from a signal and stamps the Loci day", () => {
    const date = new Date(2026, 5, 13, 10, 0);
    expect(buildPendingCoachNudge(signal, { config: {} }, date)).toEqual({
      reason: "now_focus_active",
      title: "Stay with the pinned task",
      body: "Open Task and do only the next tiny step.",
      primaryTaskUuid: "abc-123",
      lociDayStr: "2026-06-13",
    });
  });

  it("defaults primaryTaskUuid to null when absent", () => {
    const minimalSignal = { reason: "x", title: "t", body: "b" };
    expect(buildPendingCoachNudge(minimalSignal, { config: {} }).primaryTaskUuid).toBeNull();
  });
});

describe("isPendingCoachNudgeStale", () => {
  const date = new Date(2026, 5, 13, 10, 0);

  it("returns false for a nudge stamped with today's Loci day", () => {
    const nudge = { reason: "x", title: "t", body: "b", lociDayStr: "2026-06-13" };
    expect(isPendingCoachNudgeStale(nudge, { config: {} }, date)).toBe(false);
  });

  it("returns true for a nudge stamped on a previous Loci day", () => {
    const nudge = { reason: "x", title: "t", body: "b", lociDayStr: "2026-06-12" };
    expect(isPendingCoachNudgeStale(nudge, { config: {} }, date)).toBe(true);
  });

  it("returns true when there is no pending nudge", () => {
    expect(isPendingCoachNudgeStale(null, { config: {} }, date)).toBe(true);
  });
});

describe("shouldDeliverPendingCoachNudge", () => {
  it("returns true for a new nudge that hasn't been delivered yet", () => {
    const nudge = { reason: "x" };
    expect(shouldDeliverPendingCoachNudge(nudge, null)).toBe(true);
  });

  it("returns false for the same nudge object already delivered (StrictMode double-invoke)", () => {
    const nudge = { reason: "x" };
    expect(shouldDeliverPendingCoachNudge(nudge, nudge)).toBe(false);
  });

  it("returns false when there is no pending nudge", () => {
    expect(shouldDeliverPendingCoachNudge(null, null)).toBe(false);
  });
});
