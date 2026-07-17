import { describe, it, expect, vi, beforeEach } from "vitest";

const scheduleMock = vi.fn();
const cancelMock = vi.fn();
const getPendingMock = vi.fn();
const removeAllDeliveredMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    schedule: (...args) => scheduleMock(...args),
    cancel: (...args) => cancelMock(...args),
    getPending: (...args) => getPendingMock(...args),
    removeAllDeliveredNotifications: (...args) => removeAllDeliveredMock(...args),
  },
}));

import { nativeReschedule, nativeReconcileReminders, nativeCancel, nativeScheduleAt, nativeClearDelivered } from "./nativeNotifs";

// Regression coverage for a Codex finding: this app doesn't request Android's
// exact-alarm permission (see README_ANDROID.md), so without allowWhileIdle a
// scheduled alarm can be deferred well past its target once the device enters
// Doze — allowWhileIdle uses the wake-while-idle alarm path instead.
describe("nativeScheduleAt schedules with allowWhileIdle", () => {
  beforeEach(() => {
    scheduleMock.mockReset();
    scheduleMock.mockResolvedValue();
  });

  it("passes allowWhileIdle: true so the OS can wake the device to deliver it", async () => {
    await nativeScheduleAt(7, { title: "t", body: "b", at: new Date() });

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const [{ notifications }] = scheduleMock.mock.calls[0];
    expect(notifications[0].schedule.allowWhileIdle).toBe(true);
  });
});

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

// Regression coverage for a code-review finding: nativeReconcileReminders
// used to call LN.cancel() directly with a batch of stale ids, bypassing the
// per-id serializeById queue every other mutating call goes through — so a
// reconcile racing a concurrent nativeScheduleAt/nativeCancel for the same id
// could settle out of order and leave the OS holding a stale alarm.
describe("nativeReconcileReminders per-id serialization", () => {
  beforeEach(() => {
    scheduleMock.mockReset();
    cancelMock.mockReset();
    cancelMock.mockResolvedValue();
    getPendingMock.mockReset();
  });

  it("cancels each stale id through its own queue slot, not a single batched call", async () => {
    getPendingMock.mockResolvedValue({
      notifications: [
        { id: 1, extra: { uuid: "stale-1" } },
        { id: 2, extra: { uuid: "active" } },
        { id: 3, extra: { uuid: "stale-2" } },
      ],
    });

    await nativeReconcileReminders(new Set(["active"]));

    expect(cancelMock).toHaveBeenCalledTimes(2);
    expect(cancelMock).toHaveBeenCalledWith({ notifications: [{ id: 1 }] });
    expect(cancelMock).toHaveBeenCalledWith({ notifications: [{ id: 3 }] });
  });

  it("a reconcile racing a concurrent nativeCancel for the same id still issues exactly one cancel for that id", async () => {
    getPendingMock.mockResolvedValue({ notifications: [{ id: 5, extra: { uuid: "stale" } }] });

    await Promise.all([nativeCancel(5), nativeReconcileReminders(new Set())]);

    expect(cancelMock).toHaveBeenCalledTimes(2); // once from nativeCancel(5), once from the reconcile's own id-5 cancel — both serialized, neither dropped
    expect(cancelMock).toHaveBeenCalledWith({ notifications: [{ id: 5 }] });
  });
});

// Regression coverage for a Codex finding: LN.cancel() only removes PENDING
// notifications — a reminder/check-in that already fired is sitting in the
// Android notification shade as a DELIVERED notification, which needs this
// separate removal call.
describe("nativeClearDelivered", () => {
  beforeEach(() => {
    removeAllDeliveredMock.mockReset();
    removeAllDeliveredMock.mockResolvedValue();
  });

  it("removes all delivered notifications", async () => {
    await nativeClearDelivered();
    expect(removeAllDeliveredMock).toHaveBeenCalledTimes(1);
  });
});
