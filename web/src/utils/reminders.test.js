import { describe, it, expect, vi, afterEach } from "vitest";
import { getFocusWindows } from "./focusWindows";
import { getDueDailyCheckins, checkDailyCheckinNotifications, VISIBLE_HEARTBEAT_KEY } from "./reminders";

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
