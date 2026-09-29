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

  it("uses today's confirmed pick, in today's order, and only open tasks", () => {
    const config = confirmMinimumDay({}, DAY, ["dad", "gone", "cv"]);
    expect(minimumDay({ config, todayStr: DAY, ordered, isGoal })).toEqual({ state: "confirmed", ids: ["cv", "dad"] });
  });

  it("resets daily: yesterday's pick is a suggestion again", () => {
    const config = confirmMinimumDay({}, "2026-09-27", ["dad"]);
    expect(minimumDay({ config, todayStr: DAY, ordered, isGoal })).toEqual({ state: "suggested", ids: ["pharm", "hale", "cv"] });
  });

  it("keeps at most three when confirming", () => {
    expect(confirmMinimumDay({}, DAY, ["a", "b", "c", "d"]).minimumDay).toEqual({ date: DAY, ids: ["a", "b", "c"] });
  });
});
