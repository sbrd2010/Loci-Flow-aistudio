import { describe, expect, it } from "vitest";
import { addCompletionTick, removeCompletionTick, takeBackTick } from "./completionTicks";

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

  it("ignores a missing day instead of matching a row that has none", () => {
    const input = [{ count: 3 }, { dateString: "d", count: 1 }];
    expect(removeCompletionTick(input, undefined)).toEqual(input);
    expect(removeCompletionTick(input, null)).toEqual(input);
  });
});

describe("takeBackTick (reopen and Undo)", () => {
  const rows = () => [
    { compositeKey: "u_2024-06-14", userId: "u", dateString: "2024-06-14", count: 3, lastUpdated: 1 },
    { compositeKey: "u_2024-06-15", userId: "u", dateString: "2024-06-15", count: 1, lastUpdated: 1 },
  ];

  it("takes the tick from the day the task was finished on, not from the fallback day", () => {
    const out = takeBackTick(rows(), { dateCompletedString: "2024-06-14" }, "2024-06-15");
    expect(out.map(c => [c.dateString, c.count])).toEqual([["2024-06-14", 2], ["2024-06-15", 1]]);
  });

  it("uses the fallback day for a task with no stamp", () => {
    const out = takeBackTick(rows(), { dateCompletedString: null }, "2024-06-15");
    expect(out.map(c => [c.dateString, c.count])).toEqual([["2024-06-14", 3], ["2024-06-15", 0]]);
  });

  it("changes nothing when there is neither a stamp nor a fallback", () => {
    expect(takeBackTick(rows(), {}, undefined)).toEqual(rows());
    expect(takeBackTick(rows(), undefined, null)).toEqual(rows());
  });

  it("never goes below zero, so a second reopen cannot take a tick that was never there", () => {
    const once = takeBackTick(rows(), { dateCompletedString: "2024-06-15" });
    const twice = takeBackTick(once, { dateCompletedString: "2024-06-15" });
    expect(twice.find(c => c.dateString === "2024-06-15").count).toBe(0);
  });
});
