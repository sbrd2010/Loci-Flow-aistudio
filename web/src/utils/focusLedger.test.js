import { describe, it, expect } from "vitest";
import {
  MIN_COUNTABLE_MINUTES,
  eventMinutes,
  isFocusTerminal,
  flattenFocusEvents,
  lociDayWindow,
  dailyTotals,
  minutesByFront,
  formatMinutes,
  weekSummary,
  commonestStartHour,
  sessionsOnDay,
} from "./focusLedger";

const NOW = new Date(2026, 10, 4, 12, 0); // 4 Nov 2026, midday
// dayStartHour 7 / dayEndHour 26 mirrors the app's own demo config, so the
// loci-day boundary in these tests is the one the writes actually use.
const WINDOWS = undefined;

const ev = (over = {}) => ({
  type: "focus_completed",
  taskId: "t1",
  lociDateString: "2026-11-04",
  focusElapsedSeconds: 1500, // 25m
  ...over,
});

describe("eventMinutes", () => {
  it("rounds elapsed seconds to the nearest minute", () => {
    expect(eventMinutes(ev({ focusElapsedSeconds: 1500 }))).toBe(25);
    expect(eventMinutes(ev({ focusElapsedSeconds: 1530 }))).toBe(26); // 25.5 rounds up
    expect(eventMinutes(ev({ focusElapsedSeconds: 89 }))).toBe(1);
  });

  // Math.round alone turned 30-59s into a whole minute, which dailyTotals then
  // counted as a move — a mis-tap could mark a day as "moved".
  it("is 0 below a full minute, not rounded up to one", () => {
    expect(eventMinutes(ev({ focusElapsedSeconds: 30 }))).toBe(0);
    expect(eventMinutes(ev({ focusElapsedSeconds: 45 }))).toBe(0);
    expect(eventMinutes(ev({ focusElapsedSeconds: 59 }))).toBe(0);
    expect(eventMinutes(ev({ focusElapsedSeconds: 60 }))).toBe(1);
  });

  it("is 0 for missing, zero, negative or junk elapsed time", () => {
    for (const bad of [undefined, null, 0, -60, "twenty", NaN]) {
      expect(eventMinutes(ev({ focusElapsedSeconds: bad }))).toBe(0);
    }
    expect(eventMinutes(null)).toBe(0);
  });
});

describe("isFocusTerminal", () => {
  it("counts both completed and abandoned — a partial session is still time spent", () => {
    expect(isFocusTerminal(ev({ type: "focus_completed" }))).toBe(true);
    expect(isFocusTerminal(ev({ type: "focus_abandoned" }))).toBe(true);
  });

  it("ignores starts and unrelated events", () => {
    expect(isFocusTerminal(ev({ type: "focus_started" }))).toBe(false);
    expect(isFocusTerminal(ev({ type: "task_completed" }))).toBe(false);
    expect(isFocusTerminal(null)).toBe(false);
  });
});

describe("flattenFocusEvents", () => {
  it("flattens RTDB's date -> eventId -> event shape", () => {
    const raw = {
      "2026-11-03": { e1: ev({ lociDateString: "2026-11-03" }), e2: ev({ lociDateString: "2026-11-03" }) },
      "2026-11-04": { e3: ev() },
    };
    expect(flattenFocusEvents(raw)).toHaveLength(3);
  });

  it("drops non-terminal events", () => {
    const raw = { "2026-11-04": { e1: ev(), e2: ev({ type: "focus_started" }) } };
    expect(flattenFocusEvents(raw)).toHaveLength(1);
  });

  it("falls back to the bucket key when an event lacks its own date", () => {
    const raw = { "2026-11-04": { e1: ev({ lociDateString: undefined }) } };
    expect(flattenFocusEvents(raw)[0].lociDateString).toBe("2026-11-04");
  });

  it("tolerates every shape of missing data without throwing", () => {
    for (const bad of [null, undefined, "nope", 7, [], {}]) {
      expect(flattenFocusEvents(bad)).toEqual([]);
    }
    expect(flattenFocusEvents({ "2026-11-04": null })).toEqual([]);
    expect(flattenFocusEvents({ "2026-11-04": "junk" })).toEqual([]);
  });
});

describe("lociDayWindow", () => {
  it("returns N days ending today, oldest first", () => {
    const w = lociDayWindow(7, NOW, WINDOWS);
    expect(w).toHaveLength(7);
    expect(w[6]).toBe("2026-11-04");
    expect(w[0]).toBe("2026-10-29");
  });

  it("crosses a month boundary correctly", () => {
    const w = lociDayWindow(5, new Date(2026, 11, 2, 12, 0), WINDOWS);
    expect(w).toEqual(["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
  });
});

describe("dailyTotals", () => {
  it("sums minutes and counts moves per day", () => {
    const events = [
      ev({ lociDateString: "2026-11-04", focusElapsedSeconds: 1500 }),
      ev({ lociDateString: "2026-11-04", focusElapsedSeconds: 600 }),
      ev({ lociDateString: "2026-11-03", focusElapsedSeconds: 3000 }),
    ];
    expect(dailyTotals(events)).toEqual({
      "2026-11-04": { minutes: 35, moves: 2 },
      "2026-11-03": { minutes: 50, moves: 1 },
    });
  });

  it("does not count a sub-minute mis-tap as a move", () => {
    const events = [ev({ focusElapsedSeconds: 8 })];
    expect(dailyTotals(events)["2026-11-04"]).toEqual({ minutes: 0, moves: 0 });
    expect(MIN_COUNTABLE_MINUTES).toBe(1);
  });

  it("does not let a 45-second mis-tap count as a move or a day moved", () => {
    const totals = dailyTotals([ev({ focusElapsedSeconds: 45 })]);
    expect(totals["2026-11-04"]).toEqual({ minutes: 0, moves: 0 });
  });

  it("skips events with no day to file them under", () => {
    expect(dailyTotals([ev({ lociDateString: null })])).toEqual({});
  });
});

describe("minutesByFront", () => {
  const tasks = [
    { uuid: "t1", frontId: "f1" },
    { uuid: "t2", frontId: "f1" },
    { uuid: "t3", frontId: null },
  ];

  it("attributes time to the front the task belongs to now", () => {
    const events = [
      ev({ taskId: "t1", focusElapsedSeconds: 1500 }),
      ev({ taskId: "t2", focusElapsedSeconds: 600 }),
    ];
    expect(minutesByFront(events, tasks).get("f1")).toBe(35);
  });

  it("collects loose work under null rather than inventing a front", () => {
    const out = minutesByFront([ev({ taskId: "t3", focusElapsedSeconds: 1200 })], tasks);
    expect(out.get(null)).toBe(20);
    expect(out.size).toBe(1);
  });

  it("still counts time for a task deleted since the session", () => {
    const out = minutesByFront([ev({ taskId: "gone", focusElapsedSeconds: 1800 })], tasks);
    expect(out.get(null)).toBe(30);
  });

  it("ignores zero-length sessions", () => {
    expect(minutesByFront([ev({ focusElapsedSeconds: 0 })], tasks).size).toBe(0);
  });
});

describe("formatMinutes", () => {
  it("matches the design's figure style", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(105)).toBe("1h45m");
    expect(formatMinutes(545)).toBe("9h05m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(0)).toBe("0m");
  });

  it("never renders a negative or a NaN", () => {
    expect(formatMinutes(-30)).toBe("0m");
    expect(formatMinutes(undefined)).toBe("0m");
    expect(formatMinutes("junk")).toBe("0m");
  });
});

describe("weekSummary", () => {
  const tasks = [{ uuid: "t1", frontId: "f1" }];

  it("summarises a week of real sessions", () => {
    const raw = {
      "2026-11-04": { a: ev({ focusElapsedSeconds: 1500 }), b: ev({ focusElapsedSeconds: 1500 }) },
      "2026-11-02": { c: ev({ lociDateString: "2026-11-02", focusElapsedSeconds: 3600 }) },
    };
    const out = weekSummary(raw, tasks, NOW, WINDOWS);

    expect(out.perDay).toHaveLength(7);
    expect(out.perDay[6]).toEqual({ date: "2026-11-04", minutes: 50, moves: 2 });
    expect(out.totalMinutes).toBe(110);
    expect(out.totalMoves).toBe(3);
    expect(out.byFront.get("f1")).toBe(110);
  });

  it("counts days moved, not tasks completed — a day of work that finished nothing still counts", () => {
    const raw = {
      "2026-11-04": { a: ev({ type: "focus_abandoned", focusElapsedSeconds: 1500 }) },
      "2026-11-03": { b: ev({ lociDateString: "2026-11-03", type: "focus_abandoned", focusElapsedSeconds: 900 }) },
    };
    expect(weekSummary(raw, tasks, NOW, WINDOWS).daysMoved).toBe(2);
  });

  it("is all zeros for an empty ledger — an empty week reads as empty, not as a fallback", () => {
    const out = weekSummary({}, tasks, NOW, WINDOWS);
    expect(out.totalMinutes).toBe(0);
    expect(out.totalMoves).toBe(0);
    expect(out.daysMoved).toBe(0);
    expect(out.perDay).toHaveLength(7);
    expect(out.perDay.every(d => d.minutes === 0 && d.moves === 0)).toBe(true);
  });

  it("is safe with no ledger at all — demo mode has no uid and therefore no events", () => {
    const out = weekSummary(null, [], NOW, WINDOWS);
    expect(out.totalMinutes).toBe(0);
    expect(out.byFront.size).toBe(0);
  });

  // The removed fallback assumed these could differ. They cannot: a move is an
  // event with countable minutes, so no minutes always means no moves.
  it("cannot report moves without minutes", () => {
    const raw = { "2026-11-04": { a: ev({ focusElapsedSeconds: 20 }), b: ev({ focusElapsedSeconds: 5 }) } };
    const out = weekSummary(raw, tasks, NOW, WINDOWS);
    expect(out.totalMinutes).toBe(0);
    expect(out.totalMoves).toBe(0);
  });

  it("ignores sessions older than the window, in the breakdown as well as the total", () => {
    const raw = { "2026-09-01": { a: ev({ lociDateString: "2026-09-01", focusElapsedSeconds: 9000 }) } };
    const out = weekSummary(raw, tasks, NOW, WINDOWS);
    expect(out.totalMinutes).toBe(0);
    // "WHERE IT WENT" sits under the week's own figure — a session from two
    // months ago appearing there would contradict the number above it.
    expect(out.byFront.size).toBe(0);
  });
});

describe("commonestStartHour", () => {
  const at = (hour, over = {}) => ev({
    focusStartedAt: new Date(2026, 10, 4, hour, 0).getTime(),
    ...over,
  });

  it("finds the hour the user actually starts, given enough evidence", () => {
    expect(commonestStartHour([at(8), at(8), at(8), at(14)])).toBe(8);
  });

  it("says nothing when there is too little evidence to claim a pattern", () => {
    expect(commonestStartHour([at(8), at(8)])).toBeNull();
    expect(commonestStartHour([])).toBeNull();
    expect(commonestStartHour(null)).toBeNull();
  });

  it("ignores sessions too short to mean anything", () => {
    expect(commonestStartHour([at(8, { focusElapsedSeconds: 5 }), at(8, { focusElapsedSeconds: 5 }), at(8, { focusElapsedSeconds: 5 })]))
      .toBeNull();
  });

  it("ignores events with no usable start time", () => {
    expect(commonestStartHour([at(8), at(8), at(8), ev({ focusStartedAt: "nope" })])).toBe(8);
  });

  it("breaks a tie toward the earlier hour — that is the one worth defending", () => {
    expect(commonestStartHour([at(8), at(8), at(8), at(16), at(16), at(16)])).toBe(8);
  });
});

// Screen 3's "SESSION N" kicker. The spec says "SESSION 3 OF 4"; there is no
// "of 4" to show, so this counts what actually happened and the screen omits
// the denominator rather than inventing one.
describe("sessionsOnDay", () => {
  const ev = (dateStr, secs, id) => ({
    eventId: id, type: "focus_abandoned", lociDateString: dateStr,
    taskId: "t1", focusElapsedSeconds: secs,
  });
  const raw = (...events) => {
    const out = {};
    for (const e of events) (out[e.lociDateString] ||= {})[e.eventId] = e;
    return out;
  };

  it("counts the day's logged sessions", () => {
    expect(sessionsOnDay(raw(ev("2026-07-10", 1500, "a"), ev("2026-07-10", 300, "b")), "2026-07-10")).toBe(2);
  });

  it("counts only the day asked for", () => {
    expect(sessionsOnDay(raw(ev("2026-07-10", 1500, "a"), ev("2026-07-11", 1500, "b")), "2026-07-10")).toBe(1);
  });

  it("does not let a mis-tap advance the number", () => {
    // Under a minute rounds to zero and is not a session, the same threshold
    // dailyTotals uses for a "move".
    expect(sessionsOnDay(raw(ev("2026-07-10", 40, "a")), "2026-07-10")).toBe(0);
  });

  it("is zero for an empty or unreadable ledger", () => {
    expect(sessionsOnDay(null, "2026-07-10")).toBe(0);
    expect(sessionsOnDay(raw(), "2026-07-10")).toBe(0);
    expect(sessionsOnDay(raw(ev("2026-07-10", 1500, "a")), null)).toBe(0);
  });
});
