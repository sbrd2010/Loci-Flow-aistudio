import { describe, expect, it } from "vitest";
import { addCompletionTick, removeCompletionTick } from "./completionTicks";
import { getLociDayStr } from "./dailyAnchors";
import { getFocusWindows } from "./focusWindows";

describe("completion ticks", () => {
  it("starts a day's tick at 1, keyed by user and day", () => {
    const out = addCompletionTick([], "2024-06-14", { userId: "u1" }, 5);
    expect(out).toEqual([{ compositeKey: "u1_2024-06-14", userId: "u1", dateString: "2024-06-14", count: 1, lastUpdated: 5 }]);
  });

  it("adds to an existing day without touching the others, and does not change its input", () => {
    const input = [
      { compositeKey: "u1_2024-06-13", userId: "u1", dateString: "2024-06-13", count: 4, lastUpdated: 1 },
      { compositeKey: "u1_2024-06-14", userId: "u1", dateString: "2024-06-14", count: 2, lastUpdated: 1 },
    ];
    const copy = JSON.parse(JSON.stringify(input));
    const out = addCompletionTick(input, "2024-06-14", { userId: "u1" }, 9);
    expect(out.map(c => [c.dateString, c.count])).toEqual([["2024-06-13", 4], ["2024-06-14", 3]]);
    expect(input).toEqual(copy);
  });

  it("falls back to the config's user id, then to an empty one", () => {
    expect(addCompletionTick([], "d", { config: { userId: "c1" } })[0].compositeKey).toBe("c1_d");
    expect(addCompletionTick([], "d", {})[0].compositeKey).toBe("_d");
  });

  it("takes a tick back from the named day, and never goes below zero", () => {
    const input = [{ compositeKey: "u_d", userId: "u", dateString: "d", count: 1, lastUpdated: 1 }];
    const once = removeCompletionTick(input, "d", 7);
    expect(once[0]).toMatchObject({ count: 0, lastUpdated: 7 });
    expect(removeCompletionTick(once, "d")[0].count).toBe(0);
  });

  it("leaves everything alone when the day has no tick", () => {
    const input = [{ compositeKey: "u_a", userId: "u", dateString: "a", count: 2, lastUpdated: 1 }];
    expect(removeCompletionTick(input, "b")).toEqual(input);
    expect(removeCompletionTick(undefined, "b")).toEqual([]);
  });

  it("counts a 00:30 finish toward the Loci day it belongs to, the day dateCompletedString names", () => {
    // A day that starts at 07:00 and runs to 02:00 (the default day ends at midnight).
    const lateNight = new Date(2024, 5, 15, 0, 30);
    const lociDay = getLociDayStr(lateNight, getFocusWindows({ focusWindows: [{ start: "07:00", end: "02:00" }] }));
    expect(lociDay).toBe("2024-06-14");
    const out = addCompletionTick([], lociDay, { userId: "u" });
    expect(out[0].dateString).toBe("2024-06-14");
  });
});
