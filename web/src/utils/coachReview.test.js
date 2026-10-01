import { describe, it, expect } from "vitest";
import { patternSentence, reviewFacts } from "./coachReview";
import { getFocusWindows } from "./focusWindows";

// The one sentence under the figure. Every branch states something
// demonstrably true of the period's own numbers, so each is worth pinning: a
// wrong claim here is the screen lying to the user about their days.
// (Moved with patternSentence from Mind Box's "The week".)

const day = (date, minutes, moves) => ({ date, minutes, moves });
const summary = (perDay, over = {}) => ({
  perDay,
  totalMinutes: perDay.reduce((n, d) => n + d.minutes, 0),
  totalMoves: perDay.reduce((n, d) => n + d.moves, 0),
  daysMoved: perDay.filter(d => d.moves > 0).length,
  byFront: new Map(),
  ...over,
});
const nameOf = (id) => (id === null ? "work on no front" : `Front ${id}`);
const text = (s) => `${s.before}${s.bold}${s.after}`;

describe("patternSentence", () => {
  it("treats an empty period as a record, not a gap, in the period's words", () => {
    expect(text(patternSentence(summary([day("2026-11-04", 0, 0)]), nameOf, "today"))).toBe("Nothing is logged today. That is a record too, not a gap.");
    expect(text(patternSentence(summary([day("2026-11-04", 0, 0), day("2026-11-05", 0, 0)]), nameOf, "7d"))).toBe("Nothing is logged these 7 days. That is a record too, not a gap.");
  });

  it("names a front only when it really took more than half the time", () => {
    const base = summary([day("2026-11-03", 60, 1), day("2026-11-04", 40, 1)]);
    const over = patternSentence({ ...base, byFront: new Map([["f1", 60], ["f2", 40]]) }, nameOf);
    expect(over.bold).toBe("Front f1");
    expect(over.before).toMatch(/More than half/);
    const even = summary([day("2026-11-03", 50, 1), day("2026-11-04", 50, 1)]);
    expect(patternSentence({ ...even, byFront: new Map([["f1", 50], ["f2", 50]]) }, nameOf).before).not.toMatch(/More than half/);
  });

  it("names work on no front the way 62a does", () => {
    const s = patternSentence({ ...summary([day("2026-11-03", 85, 2), day("2026-11-04", 2, 1)]), byFront: new Map([[null, 85], ["f2", 2]]) }, nameOf);
    expect(text(s)).toBe("More than half of it went to work on no front.");
  });

  it("ranks the busiest day by the same measure it then reports", () => {
    const out = patternSentence(summary([day("2026-11-03", 35, 5), day("2026-11-04", 65, 1)]), nameOf);
    expect(text(out)).toBe("Most of it happened on one day.");
  });

  it("does not claim one day when the days are evenly spread", () => {
    const out = patternSentence(summary([
      day("2026-11-02", 30, 1), day("2026-11-03", 30, 1), day("2026-11-04", 30, 1), day("2026-11-05", 30, 1),
    ]), nameOf);
    expect(out.bold).toBe("4 of the last 4 days");
  });

  it("never claims 'one day' when only one day was worked at all", () => {
    expect(patternSentence(summary([day("2026-11-03", 0, 0), day("2026-11-04", 90, 2)]), nameOf).bold).toBe("1 of the last 2 days");
  });

  it("says nothing about spread for a single day", () => {
    expect(patternSentence(summary([day("2026-11-04", 40, 1)]), nameOf, "today")).toBeNull();
  });
});

describe("reviewFacts", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "07:00", end: "23:00" }] });
  const now = new Date(2026, 9, 1, 10, 0); // Thu 1 Oct, 10:00
  const ev = (date, mins, taskId, frontId = "") => ({ type: "focus_completed", lociDateString: date, focusElapsedSeconds: mins * 60, taskId, taskSnapshot: { frontId } });
  const raw = {
    "2026-09-27": { a: ev("2026-09-27", 58, "t1") },
    "2026-10-01": { b: ev("2026-10-01", 22, "t2", "f1") },
  };
  const tasks = [
    { uuid: "t1", title: "A", horizonLevel: "today", category: "Career", timeEstimateMinutes: 60 },
    { uuid: "t2", title: "B", horizonLevel: "week", category: "Career" },
    { uuid: "t3", title: "C", horizonLevel: "halfyear", category: "Health" },
    { uuid: "t4", title: "D", horizonLevel: "today", category: "Personal", isCompleted: true, dateCompletedString: "2026-09-30" },
    { uuid: "t5", title: "E", horizonLevel: "today", isParked: true },
  ];
  const contributions = [{ dateString: "2026-09-30", count: 2 }, { dateString: "2026-10-01", count: 1 }, { dateString: "2026-09-03", count: 4 }];
  const facts = reviewFacts({ tasks, contributions, focusRaw: raw, period: "7d", now, windows, frontNameOf: nameOf });

  it("sums focus and ticks over the period, one row per day", () => {
    expect(facts.days).toHaveLength(7);
    expect(facts.days[0].date).toBe("2026-09-25");
    expect(facts.focusedMinutes).toBe(80);
    expect(facts.completed).toBe(3);
    expect(facts.daysWithTick).toBe(2);
    expect(facts.days.at(-1)).toEqual({ date: "2026-10-01", minutes: 22, ticks: 1 });
  });

  it("splits the time by front, the largest first", () => {
    expect(facts.byFront.map(f => [f.name, f.minutes])).toEqual([["work on no front", 58], ["Front f1", 22]]);
  });

  it("counts done in the period and open now by category", () => {
    expect(facts.byCategory).toEqual([
      { name: "Career", done: 0, open: 2 },
      { name: "Health", done: 0, open: 1 },
      { name: "Personal", done: 1, open: 0 },
    ]);
  });

  it("reads the best weekday from 30 days of ticks, whatever the period", () => {
    const today = reviewFacts({ tasks, contributions, focusRaw: raw, period: "today", now, windows });
    expect(today.weekday.totalCount).toBe(7);
  });

  it("counts open tasks by horizon; parked and done are not open", () => {
    expect(facts.openNow.total).toBe(3);
    expect(facts.openNow.byHorizon.map(h => h.count)).toEqual([1, 1, 0, 0, 1]);
    expect(facts.openNow.plannedTodayMin).toBe(60);
    expect(facts.openNow.leftMin).toBe(13 * 60);
    expect(facts.openNow.over).toBe(false);
  });

  it("counts a tick made after midnight on its calendar day, inside a late window", () => {
    const late = getFocusWindows({ focusWindows: [{ start: "07:00", end: "02:00" }] });
    const at1am = new Date(2026, 9, 2, 1, 0); // still the 1 Oct Loci day
    const f = reviewFacts({ tasks: [], contributions: [{ dateString: "2026-10-02", count: 1 }], period: "today", now: at1am, windows: late });
    expect(f.days[0].date).toBe("2026-10-01");
    expect(f.completed).toBe(1);
  });

  it("doesn't claim focus figures it couldn't read", () => {
    const blind = reviewFacts({ tasks, contributions, focusRaw: null, period: "7d", now, windows });
    expect(blind.focusedMinutes).toBeNull();
    expect(blind.sentence).toBeNull();
    expect(blind.days[0].minutes).toBeNull();
    expect(blind.completed).toBe(3);
  });
});
