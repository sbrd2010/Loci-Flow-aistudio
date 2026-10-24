import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const startAt = vi.fn((v) => ({ startAt: v }));
vi.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  query: (r, ...parts) => ({ r, parts }),
  orderByKey: () => "orderByKey",
  startAt: (v) => startAt(v),
  get: (...args) => get(...args),
}));
vi.mock("../firebase", () => ({ db: {} }));

import { readFocusOnce } from "./readFocusOnce";
import { getFocusWindows } from "./focusWindows";

const NOW = new Date(2026, 9, 24, 10, 0);
const windows = getFocusWindows({});

describe("readFocusOnce", () => {
  beforeEach(() => { get.mockReset(); startAt.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete globalThis.window; });

  it("reads the events from the oldest day of the window on, and returns them", async () => {
    get.mockResolvedValue({ val: () => ({ "2026-10-23": { a: { focusElapsedSeconds: 600 } } }) });
    const raw = await readFocusOnce("u1", 7, windows, { now: NOW });
    expect(raw).toEqual({ "2026-10-23": { a: { focusElapsedSeconds: 600 } } });
    expect(get.mock.calls[0][0].r.path).toBe("activityLogs/u1/events");
    expect(startAt).toHaveBeenCalledWith("2026-10-18");
  });

  it("returns an empty log (not null) when nothing was logged", async () => {
    get.mockResolvedValue({ val: () => null });
    expect(await readFocusOnce("u1", 7, windows, { now: NOW })).toEqual({});
  });

  it("returns null when the read is refused", async () => {
    get.mockRejectedValue(new Error("PERMISSION_DENIED"));
    expect(await readFocusOnce("u1", 7, windows, { now: NOW })).toBeNull();
  });

  it("gives up on a read that takes too long", async () => {
    get.mockReturnValue(new Promise(() => {}));
    const pending = readFocusOnce("u1", 7, windows, { now: NOW, timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toBeNull();
  });

  it("without a user, uses the demo ledger when a test supplied one, else null", async () => {
    expect(await readFocusOnce(null, 7, windows, { now: NOW })).toBeNull();
    globalThis.window = { __LOCI_DEMO_FOCUS__: () => ({ demo: true }) };
    expect(await readFocusOnce(null, 7, windows, { now: NOW })).toEqual({ demo: true });
    expect(get).not.toHaveBeenCalled();
  });
});
