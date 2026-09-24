import { describe, expect, it } from "vitest";
import { isDeferred, isOnToday } from "./deferral";

describe("deferral", () => {
  it("hides a task until its date, then lets it back", () => {
    const t = { horizonLevel: "today", deferredUntil: "2026-09-25" };
    expect(isDeferred(t, "2026-09-24")).toBe(true);
    expect(isOnToday(t, "2026-09-24")).toBe(false);
    expect(isDeferred(t, "2026-09-25")).toBe(false);
    expect(isOnToday(t, "2026-09-25")).toBe(true);
    expect(isOnToday(t, "2026-09-30")).toBe(true);
  });
  it("treats a task with no date as not deferred", () => {
    expect(isDeferred({ horizonLevel: "today" }, "2026-09-24")).toBe(false);
    expect(isOnToday({ horizonLevel: "week" }, "2026-09-24")).toBe(false);
  });
});
