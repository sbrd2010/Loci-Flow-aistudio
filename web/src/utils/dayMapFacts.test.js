import { describe, it, expect } from "vitest";
import { dayBar, doneToday, factualLine } from "./dayMapFacts";

const DAY = "2026-09-28";
const WINDOWS = [{ startMin: 540, endMin: 1050 }];
const at = (hh, mm) => new Date(2026, 8, 28, hh, mm).getTime();

describe("factualLine (Q33.3, Q34.2)", () => {
  const base = { routeEmpty: false, openTasks: 5, dayEnd: 1050, now: 695, left: { count: 0, minutes: 0 } };

  it("over capacity: done part, then the finish, the overrun in red", () => {
    const line = factualLine({ ...base, doneMinutes: 135, finish: 1090 });
    expect(line.text).toBe("2h15m done so far today. Keep this order and you finish at 18:10, ");
    expect(line.alert).toBe("40 minutes past your day end.");
  });

  it("a day that fits, with nothing done yet", () => {
    expect(factualLine({ ...base, doneMinutes: 0, finish: 1000 }).text).toBe("Nothing done yet. On track: done by 16:40.");
  });

  it("never reports a finish before now (a late fixed stop still open)", () => {
    expect(factualLine({ ...base, doneMinutes: null, finish: 630 }).text).toBe("On track: done by 11:35.");
  });

  it("is all done when every task is ticked done, even with no focus minutes", () => {
    expect(factualLine({ ...base, doneMinutes: 0, doneCount: 3, openTasks: 0, routeEmpty: true }).text).toBe("All done today.");
    expect(factualLine({ ...base, doneMinutes: null, doneCount: 2, openTasks: 0, routeEmpty: true }).text).toBe("All done today.");
  });

  it("leaves the done part out when the ledger can't be read", () => {
    expect(factualLine({ ...base, doneMinutes: null, finish: 1000 }).text).toBe("On track: done by 16:40.");
  });

  it("the whole-line states: empty route, after the day end, all done", () => {
    expect(factualLine({ ...base, doneMinutes: 0, routeEmpty: true }).text).toBe("Nothing on the route.");
    expect(factualLine({ ...base, doneMinutes: 60, now: 1060, finish: 1170, left: { count: 3, minutes: 110 } }).text)
      .toBe("Your day ended at 17:30. 3 tasks left, 1h50m.");
    expect(factualLine({ ...base, doneMinutes: 340, openTasks: 0, routeEmpty: true }).text).toBe("All done: 5h40m today.");
  });
});

describe("dayBar (Q33.2)", () => {
  it("starts at the first window, or an earlier session; ends at the later of DAY ENDS and the finish", () => {
    const bar = dayBar({ windowStart: 540, firstSessionStart: 480, now: 695, dayEnd: 1050, finish: 1090 });
    expect([bar.start, bar.end, bar.over]).toEqual([480, 1090, true]);
    const fits = dayBar({ windowStart: 540, now: 695, dayEnd: 1050, finish: 1000 });
    expect([fits.start, fits.end, fits.over, fits.dayEnd]).toEqual([540, 1050, false, 1]);
  });
});

describe("dayBar after the day end", () => {
  it("runs on to now, so NOW and DAY ENDS each keep their place", () => {
    const bar = dayBar({ windowStart: 540, now: 1140, dayEnd: 1050, finish: 1050 });
    expect(bar.end).toBe(1140);
    expect(bar.now).toBe(1);
    expect(bar.dayEnd).toBeCloseTo(510 / 600);
  });
});

describe("doneToday (59j, 57b answer 5)", () => {
  it("one row per session, oldest first, plus a task marked done without one", () => {
    const raw = {
      [DAY]: {
        b: { type: "focus_completed", lociDateString: DAY, taskId: "cv", focusSessionId: "s2", focusStartedAt: at(10, 20), focusElapsedSeconds: 3600 },
        a: { type: "focus_abandoned", lociDateString: DAY, taskId: "mara", focusSessionId: "s1", focusStartedAt: at(8, 40), focusElapsedSeconds: 1500 },
      },
    };
    const tasks = [
      { uuid: "cv", title: "Prepare CV" },
      { uuid: "mara", title: "Reply to Mara" },
      { uuid: "pharm", title: "Pharmacy", isCompleted: true, dateCompletedString: DAY, lastUpdated: at(9, 0) },
    ];
    const rows = doneToday(raw, tasks, DAY, WINDOWS);
    expect(rows.map(r => [r.kind, r.title, r.start, r.minutes])).toEqual([
      ["session", "Reply to Mara", 520, 25],
      ["marked", "Pharmacy", null, 0],
      ["session", "Prepare CV", 620, 60],
    ]);
  });
});
