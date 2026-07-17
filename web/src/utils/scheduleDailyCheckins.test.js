import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFocusWindows } from "./focusWindows";

const scheduleAtMock = vi.fn();
const cancelMock = vi.fn();
const reconcileMock = vi.fn();
const clearDeliveredMock = vi.fn();

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
  nativeClearDelivered: (...args) => clearDeliveredMock(...args),
}));

const { scheduleDailyCheckins, cancelDailyCheckins, cancelAllNativeScheduling } = await import("./reminders");
const { idFromString } = await import("./nativeNotifs");

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);
const TODAY = "2024-06-15";

describe("scheduleDailyCheckins (native pre-scheduling glue)", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] }); // midpoint 13:00, reflection 16:30
  let localStorageStore;

  beforeEach(() => {
    scheduleAtMock.mockReset();
    scheduleAtMock.mockResolvedValue(true); // every schedule call in this file "succeeds" by default
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

  it("schedules morning and reflection, but not midday, before any commitment exists", async () => {
    // Morning Ritual already dismissed today, so it isn't blocking Morning Commitment.
    await scheduleDailyCheckins({ morningRitualShownDate: TODAY }, windows, dt(8, 0));

    const scheduledSlots = scheduleAtMock.mock.calls.map(([, opts]) => opts.extra.slot);
    expect(scheduledSlots).toContain("morning");
    expect(scheduledSlots).toContain("reflection");
    expect(scheduledSlots).not.toContain("midday");
    // Midday's target is still in the future (13:00) but ineligible (no commitment
    // yet) — it must be actively cancelled, not just silently skipped, in case a
    // prior run had already scheduled it (e.g. after a since-reverted commitment).
    expect(cancelMock).toHaveBeenCalled();
  });

  it("schedules midday once a same-day commitment exists (re-run after the commitment save, same as the app does)", async () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };
    await scheduleDailyCheckins(config, windows, dt(8, 0));

    const middayCall = scheduleAtMock.mock.calls.find(([, opts]) => opts.extra.slot === "midday");
    expect(middayCall).toBeDefined();
    expect(middayCall[1].at).toEqual(new Date(2024, 5, 15, 13, 0));
  });

  it("cancels (does not schedule) a slot already completed today", async () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"], dailyMiddayCheckDate: TODAY };
    await scheduleDailyCheckins(config, windows, dt(8, 0));

    const scheduledSlots = scheduleAtMock.mock.calls.map(([, opts]) => opts.extra.slot);
    expect(scheduledSlots).not.toContain("midday");
  });

  it("cancels all three slots and schedules nothing when dailyCheckinsEnabled is false", async () => {
    await scheduleDailyCheckins({ dailyCheckinsEnabled: false }, windows, dt(8, 0));

    expect(scheduleAtMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledTimes(3);
  });

  it("does not schedule anything once a Loci day is fully over with nothing ever made eligible", async () => {
    // At 18:00: morning explicitly skipped, midday never eligible (no
    // commitment ever made) — legitimately ineligible, no retarget needed.
    // Reflection has no such gate (eligible indefinitely once its window
    // closes), so it's the one case that reaches the retarget-to-now
    // fallback; mark it already-notified to prove that path is checked too.
    const key = `reflection-anon-${TODAY}`;
    localStorageStore["loci_notified_daily_checkins"] = JSON.stringify([key]);

    await scheduleDailyCheckins({ dailyCommitmentSkippedDate: TODAY }, windows, dt(18, 0));

    expect(scheduleAtMock).not.toHaveBeenCalled();
  });

  it("gives each slot a distinct notification id", async () => {
    await scheduleDailyCheckins({ dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] }, windows, dt(8, 0));

    const ids = scheduleAtMock.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Regression coverage for a Codex finding: a slot's originally-computed
  // target (a single fixed instant with no notion of snooze) has no way to
  // represent "eligible again later" on its own once that instant passes.
  it("retargets a snoozed slot to the snooze expiry once the original target has passed", async () => {
    const config = {
      dailyCommitmentDate: TODAY,
      dailyCommitmentTaskIds: ["t1"],
      // Midday's target (13:00) already passed; snoozed until 14:30.
      dailyMiddayCheckSnoozeUntil: dt(14, 30).getTime(),
    };
    await scheduleDailyCheckins(config, windows, dt(14, 0)); // "now" is between the original target and the snooze expiry

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
  it("retargets to 'now' when a slot becomes eligible only after its own target passed, with no snooze involved", async () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] }; // no snooze field at all
    await scheduleDailyCheckins(config, windows, dt(14, 0)); // midday's 13:00 target already passed

    const middayCall = scheduleAtMock.mock.calls.find(([, opts]) => opts.extra.slot === "midday");
    expect(middayCall).toBeDefined();
    expect(middayCall[1].at).toEqual(new Date(dt(14, 0).getTime() + 1000));
  });

  it("does not repeatedly re-fire the 'now' retarget on every rerun once already notified today", async () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };
    // First run: midday retargets to "now" and gets marked notified.
    await scheduleDailyCheckins(config, windows, dt(14, 0));
    expect(scheduleAtMock.mock.calls.some(([, opts]) => opts.extra.slot === "midday")).toBe(true);

    scheduleAtMock.mockClear();
    // A later rerun (e.g. an unrelated config field changing) must not
    // re-fire the same "now" alarm again — the dedup key from the first
    // run is still valid for the same Loci day.
    await scheduleDailyCheckins(config, windows, dt(15, 0));
    expect(scheduleAtMock.mock.calls.some(([, opts]) => opts.extra.slot === "midday")).toBe(false);
    expect(cancelMock).toHaveBeenCalled();
  });

  // Regression coverage for a Codex finding on the fix above: this app
  // intentionally doesn't request exact-alarm permission (see
  // README_ANDROID.md), so Android can legitimately defer a scheduled alarm
  // past its nominal target under Doze. The "already notified, skip
  // rescheduling" branch must NOT cancel that id on the assumption it must
  // have already fired — doing so could kill a still-pending, merely-deferred
  // alarm with no way to retry (the dedup key already reads as claimed).
  it("does not cancel an already-notified slot's id when skipping its 'now' retarget on a later rerun", async () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };
    const middayId = idFromString("daily-checkin-midday");
    await scheduleDailyCheckins(config, windows, dt(14, 0)); // midday marked notified
    scheduleAtMock.mockClear();
    cancelMock.mockClear();

    await scheduleDailyCheckins(config, windows, dt(15, 0)); // rerun hits the already-notified skip branch for midday

    expect(cancelMock.mock.calls.some(([id]) => id === middayId)).toBe(false);
  });

  // Regression coverage for a Codex finding: a normal future-target
  // schedule (not just the immediate-fire retarget) must also mark the
  // dedup key once it succeeds — otherwise, once that alarm's own target
  // time passes, the native branch's 5-minute poll (App.jsx) sees no dedup
  // record and no snooze, treats the slot as newly eligible, and fires a
  // second, duplicate notification for the same already-fired slot.
  it("marks the dedup key for a normal future-target schedule too, not just the immediate-fire retarget", async () => {
    const config = { morningRitualShownDate: TODAY }; // morning target (09:00) still in the future at 08:00
    await scheduleDailyCheckins(config, windows, dt(8, 0));

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).toContain(`morning-anon-${TODAY}`);
  });

  it("does not duplicate-fire a future-target slot once its target time has passed and the poll reruns", async () => {
    const config = { morningRitualShownDate: TODAY };
    // First run at 08:00: morning schedules normally for 09:00 and gets marked notified.
    await scheduleDailyCheckins(config, windows, dt(8, 0));
    expect(scheduleAtMock.mock.calls.some(([, opts]) => opts.extra.slot === "morning")).toBe(true);

    scheduleAtMock.mockClear();
    // Simulates App.jsx's 5-minute native poll rerunning after the 09:00
    // alarm has already fired — must not schedule a second notification.
    await scheduleDailyCheckins(config, windows, dt(9, 5));
    expect(scheduleAtMock.mock.calls.some(([, opts]) => opts.extra.slot === "morning")).toBe(false);
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
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };

    await scheduleDailyCheckins(config, windows, dt(14, 0));

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).toContain(`midday-anon-${TODAY}`);
  });

  it("does not retarget to an already-expired snooze — falls through to the 'now' retarget instead", async () => {
    const config = {
      dailyCommitmentDate: TODAY,
      dailyCommitmentTaskIds: ["t1"],
      dailyMiddayCheckSnoozeUntil: dt(13, 30).getTime(), // snooze itself already in the past too
    };
    await scheduleDailyCheckins(config, windows, dt(14, 0));

    // Not retargeted to the (already-past) snooze time — but still eligible
    // right now with no snooze blocking it, so it correctly falls through
    // to the "now" retarget rather than being silently dropped.
    const middayCall = scheduleAtMock.mock.calls.find(([, opts]) => opts.extra.slot === "midday");
    expect(middayCall).toBeDefined();
    expect(middayCall[1].at).toEqual(new Date(dt(14, 0).getTime() + 1000));
  });
});

describe("cancelDailyCheckins", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
  let localStorageStore;

  beforeEach(() => {
    cancelMock.mockReset();
    scheduleAtMock.mockReset();
    scheduleAtMock.mockResolvedValue(true);
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

  it("cancels all three daily check-in slots", () => {
    cancelDailyCheckins();
    expect(cancelMock).toHaveBeenCalledTimes(3);
  });

  it("with no config/windows args, leaves dedup marks untouched (sign-out/account-switch path)", async () => {
    await scheduleDailyCheckins({ morningRitualShownDate: TODAY }, windows, dt(8, 0));
    const key = `morning-anon-${TODAY}`;
    expect(JSON.parse(localStorageStore["loci_notified_daily_checkins"])).toContain(key);

    cancelDailyCheckins();

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).toContain(key);
  });

  // Regression coverage for a code-review finding: unifying dedup marking
  // onto every successful schedule (not just immediate-fire) meant a
  // genuinely-cancelled future alarm's dedup mark would otherwise survive
  // the cancel, permanently blocking re-notification once the slot becomes
  // eligible again later (e.g. focus mode ends before the original target).
  it("releases a slot's dedup mark when its scheduled alarm was still ahead of 'now' at cancel time", async () => {
    // Morning's target (09:00) is still in the future when scheduled at 08:00.
    await scheduleDailyCheckins({ morningRitualShownDate: TODAY }, windows, dt(8, 0));
    const key = `morning-anon-${TODAY}`;
    expect(JSON.parse(localStorageStore["loci_notified_daily_checkins"])).toContain(key);

    cancelDailyCheckins({}, windows, dt(8, 30)); // cancelled at 08:30 — before the 09:00 target ever fired

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).not.toContain(key);
  });

  it("does NOT release a slot's dedup mark once its scheduled alarm's target has already passed (already fired)", async () => {
    await scheduleDailyCheckins({ morningRitualShownDate: TODAY }, windows, dt(8, 0));
    const key = `morning-anon-${TODAY}`;

    cancelDailyCheckins({}, windows, dt(9, 5)); // cancelled at 09:05 — after the 09:00 target already fired

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).toContain(key);
  });

  it("does not release a different user's dedup mark", async () => {
    await scheduleDailyCheckins({ userId: "u1", morningRitualShownDate: TODAY }, windows, dt(8, 0));
    const key = "morning-u1-" + TODAY;
    expect(JSON.parse(localStorageStore["loci_notified_daily_checkins"])).toContain(key);

    cancelDailyCheckins({ userId: "u2" }, windows, dt(8, 30));

    const notified = JSON.parse(localStorageStore["loci_notified_daily_checkins"] || "[]");
    expect(notified).toContain(key);
  });
});

describe("cancelAllNativeScheduling", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    reconcileMock.mockReset();
    clearDeliveredMock.mockReset();
  });

  it("clears task reminders (via an empty active-uuid set), the coach check-in, and all daily check-ins", () => {
    cancelAllNativeScheduling();

    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock.mock.calls[0][0]).toEqual(new Set());
    // 1 coach check-in + 3 daily check-in slots
    expect(cancelMock).toHaveBeenCalledTimes(4);
  });

  // Regression coverage for a Codex finding: LN.cancel() only removes
  // PENDING notifications, not ones that already fired and are sitting in
  // the Android notification shade — those need a separate removal call so
  // a previous account's already-shown notifications don't linger on a
  // shared/signed-out device.
  it("also clears already-delivered notifications, not just pending ones", () => {
    cancelAllNativeScheduling();

    expect(clearDeliveredMock).toHaveBeenCalledTimes(1);
  });
});
