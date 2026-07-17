import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFocusWindows } from "./focusWindows";

const scheduleAtMock = vi.fn();
const cancelMock = vi.fn();
const reconcileMock = vi.fn();

// scheduleDailyCheckins is the native-only glue between computeDailyCheckinTimes
// and the shouldShowX predicates — isolated here (rather than in
// reminders.test.js) so isNativeApp() can be forced true without affecting
// that file's existing web-path tests, which rely on the real (web-fallback)
// isNativeApp() returning false.
vi.mock("./nativeNotifs", () => ({
  isNativeApp: () => true,
  notifPermissionGranted: () => true,
  idFromString: (s) => {
    // Deterministic, collision-free-enough stand-in for the real hash — tests
    // only need distinct ids per distinct input, not the real algorithm.
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return h;
  },
  nativeScheduleAt: (...args) => scheduleAtMock(...args),
  nativeShowNow: vi.fn(),
  nativeCancel: (...args) => cancelMock(...args),
  nativeReschedule: vi.fn(),
  nativeReconcileReminders: (...args) => reconcileMock(...args),
}));

const { scheduleDailyCheckins, cancelDailyCheckins, cancelAllNativeScheduling } = await import("./reminders");

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);
const TODAY = "2024-06-15";

describe("scheduleDailyCheckins (native pre-scheduling glue)", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] }); // midpoint 13:00, reflection 16:30
  let localStorageStore;

  beforeEach(() => {
    scheduleAtMock.mockReset();
    cancelMock.mockReset();
    reconcileMock.mockReset();
    localStorageStore = {};
    vi.stubGlobal("localStorage", {
      getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
      setItem: (k, v) => { localStorageStore[k] = String(v); },
      removeItem: (k) => { delete localStorageStore[k]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("schedules morning and reflection, but not midday, before any commitment exists", () => {
    // Morning Ritual already dismissed today, so it isn't blocking Morning Commitment.
    scheduleDailyCheckins({ morningRitualShownDate: TODAY }, windows, dt(8, 0));

    const scheduledSlots = scheduleAtMock.mock.calls.map(([, opts]) => opts.extra.slot);
    expect(scheduledSlots).toContain("morning");
    expect(scheduledSlots).toContain("reflection");
    expect(scheduledSlots).not.toContain("midday");
    // Midday's target is still in the future (13:00) but ineligible (no commitment
    // yet) — it must be actively cancelled, not just silently skipped, in case a
    // prior run had already scheduled it (e.g. after a since-reverted commitment).
    expect(cancelMock).toHaveBeenCalled();
  });

  it("schedules midday once a same-day commitment exists (re-run after the commitment save, same as the app does)", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };
    scheduleDailyCheckins(config, windows, dt(8, 0));

    const middayCall = scheduleAtMock.mock.calls.find(([, opts]) => opts.extra.slot === "midday");
    expect(middayCall).toBeDefined();
    expect(middayCall[1].at).toEqual(new Date(2024, 5, 15, 13, 0));
  });

  it("cancels (does not schedule) a slot already completed today", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"], dailyMiddayCheckDate: TODAY };
    scheduleDailyCheckins(config, windows, dt(8, 0));

    const scheduledSlots = scheduleAtMock.mock.calls.map(([, opts]) => opts.extra.slot);
    expect(scheduledSlots).not.toContain("midday");
  });

  it("cancels all three slots and schedules nothing when dailyCheckinsEnabled is false", () => {
    scheduleDailyCheckins({ dailyCheckinsEnabled: false }, windows, dt(8, 0));

    expect(scheduleAtMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledTimes(3);
  });

  it("does not schedule anything once a Loci day is fully over with nothing ever made eligible", () => {
    // At 18:00: morning explicitly skipped, midday never eligible (no
    // commitment ever made) — legitimately ineligible, no retarget needed.
    // Reflection has no such gate (eligible indefinitely once its window
    // closes), so it's the one case that reaches the retarget-to-now
    // fallback; mark it already-notified to prove that path is checked too.
    const key = `reflection-anon-${TODAY}`;
    localStorageStore["loci_notified_daily_checkins"] = JSON.stringify([key]);

    scheduleDailyCheckins({ dailyCommitmentSkippedDate: TODAY }, windows, dt(18, 0));

    expect(scheduleAtMock).not.toHaveBeenCalled();
  });

  it("gives each slot a distinct notification id", () => {
    scheduleDailyCheckins({ dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] }, windows, dt(8, 0));

    const ids = scheduleAtMock.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Regression coverage for a Codex finding: a slot's originally-computed
  // target (a single fixed instant with no notion of snooze) has no way to
  // represent "eligible again later" on its own once that instant passes.
  it("retargets a snoozed slot to the snooze expiry once the original target has passed", () => {
    const config = {
      dailyCommitmentDate: TODAY,
      dailyCommitmentTaskIds: ["t1"],
      // Midday's target (13:00) already passed; snoozed until 14:30.
      dailyMiddayCheckSnoozeUntil: dt(14, 30).getTime(),
    };
    scheduleDailyCheckins(config, windows, dt(14, 0)); // "now" is between the original target and the snooze expiry

    const middayCall = scheduleAtMock.mock.calls.find(([, opts]) => opts.extra.slot === "midday");
    expect(middayCall).toBeDefined();
    expect(middayCall[1].at).toEqual(dt(14, 30));
  });

  // Regression coverage for a second Codex finding on the same PR: a slot
  // that becomes eligible only *after* its own computed target already
  // passed — with no snooze involved at all — was still being silently
  // dropped (e.g. the commitment saved at 14:00, after midday's 13:00
  // midpoint already passed). The web poll would notify immediately since
  // the predicate is true right now; native must retarget to "now" too.
  it("retargets to 'now' when a slot becomes eligible only after its own target passed, with no snooze involved", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] }; // no snooze field at all
    scheduleDailyCheckins(config, windows, dt(14, 0)); // midday's 13:00 target already passed

    const middayCall = scheduleAtMock.mock.calls.find(([, opts]) => opts.extra.slot === "midday");
    expect(middayCall).toBeDefined();
    expect(middayCall[1].at).toEqual(new Date(dt(14, 0).getTime() + 1000));
  });

  it("does not repeatedly re-fire the 'now' retarget on every rerun once already notified today", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };
    // First run: midday retargets to "now" and gets marked notified.
    scheduleDailyCheckins(config, windows, dt(14, 0));
    expect(scheduleAtMock.mock.calls.some(([, opts]) => opts.extra.slot === "midday")).toBe(true);

    scheduleAtMock.mockClear();
    // A later rerun (e.g. an unrelated config field changing) must not
    // re-fire the same "now" alarm again — the dedup key from the first
    // run is still valid for the same Loci day.
    scheduleDailyCheckins(config, windows, dt(15, 0));
    expect(scheduleAtMock.mock.calls.some(([, opts]) => opts.extra.slot === "midday")).toBe(false);
    expect(cancelMock).toHaveBeenCalled();
  });

  // Regression coverage for a Codex finding on the immediate-fire dedup
  // write: it used to mark the slot "notified" before nativeScheduleAt()
  // resolved, so a failed schedule (e.g. Android 13+ permission not yet
  // granted on a fresh install) would still get marked done, permanently
  // losing the slot for the day even after the permission-grant retry fires.
  it("releases the dedup mark if the native schedule call actually fails, so a later retry isn't blocked", async () => {
    scheduleAtMock.mockImplementation(() => Promise.resolve(false)); // simulates e.g. permission not yet granted
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };

    await scheduleDailyCheckins(config, windows, dt(14, 0));

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).not.toContain(`midday-anon-${TODAY}`);
  });

  it("keeps the dedup mark when the native schedule call actually succeeds", async () => {
    scheduleAtMock.mockImplementation(() => Promise.resolve(true));
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };

    await scheduleDailyCheckins(config, windows, dt(14, 0));

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).toContain(`midday-anon-${TODAY}`);
  });

  it("does not retarget to an already-expired snooze — falls through to the 'now' retarget instead", () => {
    const config = {
      dailyCommitmentDate: TODAY,
      dailyCommitmentTaskIds: ["t1"],
      dailyMiddayCheckSnoozeUntil: dt(13, 30).getTime(), // snooze itself already in the past too
    };
    scheduleDailyCheckins(config, windows, dt(14, 0));

    // Not retargeted to the (already-past) snooze time — but still eligible
    // right now with no snooze blocking it, so it correctly falls through
    // to the "now" retarget rather than being silently dropped.
    const middayCall = scheduleAtMock.mock.calls.find(([, opts]) => opts.extra.slot === "midday");
    expect(middayCall).toBeDefined();
    expect(middayCall[1].at).toEqual(new Date(dt(14, 0).getTime() + 1000));
  });
});

describe("cancelDailyCheckins", () => {
  beforeEach(() => {
    cancelMock.mockReset();
  });

  it("cancels all three daily check-in slots", () => {
    cancelDailyCheckins();
    expect(cancelMock).toHaveBeenCalledTimes(3);
  });
});

describe("cancelAllNativeScheduling", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    reconcileMock.mockReset();
  });

  it("clears task reminders (via an empty active-uuid set), the coach check-in, and all daily check-ins", () => {
    cancelAllNativeScheduling();

    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock.mock.calls[0][0]).toEqual(new Set());
    // 1 coach check-in + 3 daily check-in slots
    expect(cancelMock).toHaveBeenCalledTimes(4);
  });
});
