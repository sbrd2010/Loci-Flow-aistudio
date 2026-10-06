import { describe, it, expect } from "vitest";
import { confirmMinimumDay, minimumDay, suggestMinimumDay } from "./minimumDay";

const DAY = "2026-09-28";
const task = (uuid, extra = {}) => ({ uuid, title: uuid, ...extra });
const goalIds = new Set(["cv", "prince"]);
const isGoal = (t) => goalIds.has(t.uuid);

describe("minimum day (56a–b, 57b answer 6)", () => {
  const ordered = [task("cv"), task("pharm", { isMVD: true }), task("dad"), task("hale", { isMVD: true }), task("prince")];

  it("suggests must-dos first, then goal tasks, in today's order, at most three", () => {
    expect(suggestMinimumDay(ordered, isGoal)).toEqual(["pharm", "hale", "cv"]);
  });

  it("never suggests something at a set time (Q36.3)", () => {
    const call = task("call", { isMVD: true, fixedKind: "event", dayMapFixedMinutes: 750 });
    expect(suggestMinimumDay([call, ...ordered], isGoal)).toEqual(["pharm", "hale", "cv"]);
  });

  // Turn 76 (d): only tasks that fit before the day ends, so maybe fewer than
  // three. Fit is judged on the minimum day itself: the optional tasks are
  // what you'd drop, so a must-do behind a long optional one still counts
  // (loopcheck #495).
  const mins = { pharm: 25, hale: 90, cv: 120, prince: 30, dad: 180 };
  const minutesOf = (t) => mins[t.uuid];

  it("takes must-dos, then goal tasks, while their minutes fit in the time left", () => {
    // 2h left: pharm 25 + hale 90 = 1h55m; cv (2h) is skipped; prince (30m) no longer fits.
    expect(minimumDay({ config: {}, todayStr: DAY, ordered, isGoal, budget: 120, minutesOf })).toEqual({ state: "suggested", ids: ["pharm", "hale"], unfit: 2 });
    // 1h left: pharm 25; hale (1h30m) and cv (2h) skipped; prince 30 fits after them.
    expect(suggestMinimumDay(ordered, isGoal, { budget: 60, minutesOf })).toEqual(["pharm", "prince"]);
  });

  it("ignores the optional tasks: a must-do behind a 3h optional task still fits", () => {
    const day = [task("a", { isMVD: true }), task("dad"), task("c", { isMVD: true })];
    const m = { a: 25, dad: 180, c: 25 };
    expect(suggestMinimumDay(day, isGoal, { budget: 90, minutesOf: (t) => m[t.uuid] })).toEqual(["a", "c"]);
  });

  // With none that fit, the page says why rather than "do these 3".
  it("counts the must-dos and goal tasks left out for time", () => {
    expect(minimumDay({ config: {}, todayStr: DAY, ordered, isGoal, budget: 10, minutesOf })).toEqual({ state: "suggested", ids: [], unfit: 4 });
    expect(minimumDay({ config: {}, todayStr: DAY, ordered: [task("dad")], isGoal, budget: 10, minutesOf })).toEqual({ state: "suggested", ids: [], unfit: 0 });
  });

  it("keeps a confirmed pick even if it no longer fits: it's your choice", () => {
    const config = confirmMinimumDay({}, DAY, ["hale"]);
    expect(minimumDay({ config, todayStr: DAY, ordered, isGoal, budget: 0, minutesOf })).toEqual({ state: "confirmed", ids: ["hale"] });
  });

  it("uses today's confirmed pick, in today's order, and only open tasks", () => {
    const config = confirmMinimumDay({}, DAY, ["dad", "gone", "cv"]);
    expect(minimumDay({ config, todayStr: DAY, ordered, isGoal })).toEqual({ state: "confirmed", ids: ["cv", "dad"] });
  });

  it("resets daily: yesterday's pick is a suggestion again", () => {
    const config = confirmMinimumDay({}, "2026-09-27", ["dad"]);
    expect(minimumDay({ config, todayStr: DAY, ordered, isGoal })).toEqual({ state: "suggested", ids: ["pharm", "hale", "cv"], unfit: 0 });
  });

  it("keeps at most three when confirming", () => {
    expect(confirmMinimumDay({}, DAY, ["a", "b", "c", "d"]).minimumDay).toEqual({ date: DAY, ids: ["a", "b", "c"] });
  });
});
