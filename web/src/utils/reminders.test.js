import { describe, it, expect, vi, afterEach } from "vitest";
import { getFocusWindows } from "./focusWindows";
import { getDueDailyCheckins, checkDailyCheckinNotifications, VISIBLE_HEARTBEAT_KEY, scheduleReminder, scheduleCoachCheckin, cancelAllNativeScheduling } from "./reminders";

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);
const TODAY = "2024-06-15";

describe("getDueDailyCheckins", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });

  it("returns nothing before the first focus window opens", () => {
    expect(getDueDailyCheckins({}, windows, dt(8, 0))).toEqual([]);
  });

  // Addendum B: the morning commitment and the midday progress check are gone,
  // and their notifications went with them — a push that opens the app to a
  // prompt that no longer exists is worse than the prompt was. Day Close is the
  // one scheduled interruption left.
  it("never returns the deleted morning or midday slots", () => {
    const config = { morningRitualShownDate: TODAY, dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["a"] };
    for (const hour of [9, 11, 13, 15]) {
      expect(getDueDailyCheckins(config, windows, dt(hour, 0))).not.toContain("morning");
      expect(getDueDailyCheckins(config, windows, dt(hour, 0))).not.toContain("midday");
    }
  });

  it("returns 'reflection' near the end of the focus window", () => {
    expect(getDueDailyCheckins({}, windows, dt(16, 45))).toEqual(["reflection"]);
  });

  it("returns nothing once the reflection is done for the day", () => {
    expect(getDueDailyCheckins({ dailyReflectionDate: TODAY }, windows, dt(16, 45))).toEqual([]);
  });
});

describe("checkDailyCheckinNotifications", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
  const config = {};
  // 16:45 — Day Close is the only slot left, so every test of the dedupe and
  // heartbeat machinery runs against it rather than against the deleted
  // morning one it used to use.
  const DUE = () => dt(16, 45);

  function stubEnv({ showNotification } = {}) {
    const store = {};
    vi.stubGlobal("localStorage", {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ showNotification: showNotification || vi.fn(() => Promise.resolve()) }) },
    });
    return store;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reserves the dedupe key before the notification resolves, so a concurrent poll skips the same slot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DUE());

    // The reservation write happens synchronously before the first `await` inside
    // checkDailyCheckinNotifications, so p2 (called right after p1, before p1's
    // microtasks run) already sees the slot as claimed.
    const showNotification = vi.fn(() => Promise.resolve());
    const store = stubEnv({ showNotification });

    const p1 = checkDailyCheckinNotifications(config, windows);
    const p2 = checkDailyCheckinNotifications(config, windows);

    await Promise.all([p1, p2]);

    expect(showNotification).toHaveBeenCalledTimes(1);
    const notified = JSON.parse(store["loci_notified_daily_checkins"]);
    expect(notified.some((k) => k.startsWith("reflection-"))).toBe(true);
  });

  it("releases the reservation if the notification could not be shown, so a later poll retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DUE());

    const showNotification = vi.fn(() => Promise.reject(new Error("sw failed")));
    const store = stubEnv({ showNotification });
    vi.stubGlobal("Notification", class { constructor() { throw new Error("notification failed"); } static permission = "granted"; });

    await checkDailyCheckinNotifications(config, windows);

    const notified = JSON.parse(store["loci_notified_daily_checkins"] || "[]");
    expect(notified.some((k) => k.startsWith("reflection-"))).toBe(false);
  });

  it("does not notify when another Loci tab heartbeated as visible recently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DUE());

    const showNotification = vi.fn(() => Promise.resolve());
    const store = stubEnv({ showNotification });
    store[VISIBLE_HEARTBEAT_KEY] = String(Date.now());

    await checkDailyCheckinNotifications(config, windows);

    expect(showNotification).not.toHaveBeenCalled();
    expect(store["loci_notified_daily_checkins"]).toBeUndefined();
  });

  it("notifies when the other tab's visibility heartbeat is stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DUE());

    const showNotification = vi.fn(() => Promise.resolve());
    const store = stubEnv({ showNotification });
    store[VISIBLE_HEARTBEAT_KEY] = String(Date.now() - 20_000); // older than the 15s staleness window

    await checkDailyCheckinNotifications(config, windows);

    expect(showNotification).toHaveBeenCalledTimes(1);
  });
});

// #664: sign-out (and leaving demo) doesn't reload the tab. A reminder armed
// for the account that just left must never show its task title afterwards.
describe("sign-out clears this tab's web reminders (#664)", () => {
  const TITLE = "Invented task title";
  let showNotification, ready, getNotifications, closed;

  function stubWeb({ readyPromise } = {}) {
    showNotification = vi.fn(() => Promise.resolve());
    closed = vi.fn();
    getNotifications = vi.fn(() => Promise.resolve([{ close: closed }]));
    const reg = { showNotification, getNotifications };
    ready = readyPromise || Promise.resolve(reg);
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { serviceWorker: { ready, getRegistration: () => Promise.resolve(reg) } });
    return reg;
  }
  const task = () => ({ uuid: "t-664", title: TITLE, reminderAt: Date.now() + 60_000 });
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  afterEach(() => {
    cancelAllNativeScheduling();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("control: without sign-out, a due reminder shows its title", async () => {
    vi.useFakeTimers();
    stubWeb();
    scheduleReminder(task());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification.mock.calls[0][1].body).toBe(TITLE);
  });

  it("a pending task reminder and Coach check-in never show after sign-out", async () => {
    vi.useFakeTimers();
    stubWeb();
    scheduleReminder(task());
    scheduleCoachCheckin({ fireAt: Date.now() + 60_000, note: TITLE });
    cancelAllNativeScheduling();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("a reminder already firing (waiting on the service worker) shows nothing after sign-out", async () => {
    vi.useFakeTimers();
    let resolveReady;
    const reg = stubWeb({ readyPromise: new Promise(r => { resolveReady = r; }) });
    scheduleReminder(task());
    await vi.advanceTimersByTimeAsync(61_000); // the timer has fired and is awaiting `ready`
    cancelAllNativeScheduling();
    resolveReady(reg);
    await flush();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("closes Loci notifications already shown in this browser", async () => {
    stubWeb();
    cancelAllNativeScheduling();
    await flush();
    expect(getNotifications).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it("closes an already-shown fallback notification (no service worker)", async () => {
    vi.useFakeTimers();
    const instances = [];
    function FakeNotification(title, opts) { this.title = title; this.opts = opts; this.close = vi.fn(); instances.push(this); }
    FakeNotification.permission = "granted";
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { focus() {}, dispatchEvent() {} });
    scheduleReminder(task());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(instances).toHaveLength(1);
    cancelAllNativeScheduling();
    expect(instances[0].close).toHaveBeenCalled();
  });
});
