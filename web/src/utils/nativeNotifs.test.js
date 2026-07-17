import { describe, it, expect, vi, beforeEach } from "vitest";

const scheduleMock = vi.fn();
const cancelMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    schedule: (...args) => scheduleMock(...args),
    cancel: (...args) => cancelMock(...args),
  },
}));

import { nativeReschedule } from "./nativeNotifs";

// Regression coverage for a loopcheck/Codex finding on the Android Capacitor
// bridge: nativeReschedule's cancel()+schedule() calls were fire-and-forget,
// so two edits to the same reminder in quick succession (e.g. 9:00 -> 10:00
// -> 11:00) had no guarantee of settling in call order — a slow first call
// could resolve its schedule() after a faster second call's, silently
// leaving the OS holding the earlier (wrong) time.
describe("nativeReschedule per-id serialization", () => {
  beforeEach(() => {
    scheduleMock.mockReset();
    cancelMock.mockReset();
  });

  it("a slower first call cannot let its schedule() land after a faster second call's for the same id", async () => {
    const order = [];
    let resolveFirstCancel;
    cancelMock.mockImplementationOnce(() => new Promise((res) => { resolveFirstCancel = res; }));
    cancelMock.mockResolvedValue();
    scheduleMock.mockImplementation((arg) => {
      order.push(arg.notifications[0].title);
      return Promise.resolve();
    });

    // Second call issued immediately, before the first call's cancel() has
    // resolved — without serialization this is exactly the scenario where
    // call order and settle order can diverge.
    const p1 = nativeReschedule(42, { title: "first", body: "", at: new Date() });
    const p2 = nativeReschedule(42, { title: "second", body: "", at: new Date() });

    // Let the promise chain actually reach the point of invoking cancelMock
    // for call 1 (several microtask hops away) before releasing it.
    await new Promise((r) => setTimeout(r, 0));
    resolveFirstCancel();
    await Promise.all([p1, p2]);

    expect(order).toEqual(["first", "second"]);
    expect(scheduleMock).toHaveBeenCalledTimes(2);
  });
});
