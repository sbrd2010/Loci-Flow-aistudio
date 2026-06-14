import { describe, it, expect, vi, afterEach } from "vitest";
import { getFocusWindows } from "./focusWindows";
import { getDueDailyCheckins, checkDailyCheckinNotifications } from "./reminders";

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);
const TODAY = "2024-06-15";

describe("getDueDailyCheckins", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });

  it("returns nothing before the first focus window opens", () => {
    expect(getDueDailyCheckins({}, windows, dt(8, 0))).toEqual([]);
  });

  it("returns 'morning' once Morning Ritual is no longer pending", () => {
    const config = { morningRitualShownDate: TODAY };
    expect(getDueDailyCheckins(config, windows, dt(9, 0))).toEqual(["morning"]);
  });

  it("returns 'midday' once the focus midpoint passes, after committing", () => {
    const config = { morningRitualShownDate: TODAY, dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["a"] };
    expect(getDueDailyCheckins(config, windows, dt(13, 0))).toEqual(["midday"]);
  });

  it("can return multiple due check-ins at once", () => {
    const config = { morningRitualShownDate: TODAY };
    expect(getDueDailyCheckins(config, windows, dt(16, 45))).toEqual(["morning", "reflection"]);
  });

  it("returns nothing once all three are completed for the day", () => {
    const config = {
      morningRitualShownDate: TODAY,
      dailyCommitmentDate: TODAY,
      dailyCommitmentTaskIds: ["a"],
      dailyMiddayCheckDate: TODAY,
      dailyReflectionDate: TODAY,
    };
    expect(getDueDailyCheckins(config, windows, dt(16, 45))).toEqual([]);
  });
});

describe("checkDailyCheckinNotifications", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });
  const config = { morningRitualShownDate: TODAY };

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
    vi.setSystemTime(dt(9, 0));

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
    expect(notified.some((k) => k.startsWith("morning-"))).toBe(true);
  });

  it("releases the reservation if the notification could not be shown, so a later poll retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(dt(9, 0));

    const showNotification = vi.fn(() => Promise.reject(new Error("sw failed")));
    const store = stubEnv({ showNotification });
    vi.stubGlobal("Notification", class { constructor() { throw new Error("notification failed"); } static permission = "granted"; });

    await checkDailyCheckinNotifications(config, windows);

    const notified = JSON.parse(store["loci_notified_daily_checkins"] || "[]");
    expect(notified.some((k) => k.startsWith("morning-"))).toBe(false);
  });
});
