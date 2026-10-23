import { describe, expect, it } from "vitest";
import { buildDayMap, buildMindBox, buildPlan, buildSettings, buildStuck, buildToday, buildWeek } from "../src/pages.js";
import { buildOverview } from "../src/overview.js";

const IST = "Asia/Kolkata";
const NOW = Date.UTC(2026, 9, 22, 4, 30, 0); // 2026-10-22 10:00 in India
const DAY = 86400000;
const HOUR = 3600000;

let n = 0;
const t = (title, over = {}) => ({
  id: 1000 + n, uuid: `u-${++n}`, userId: "u1", title, concreteStep: "do the first bit", horizonLevel: "today", priority: "P2",
  category: "Work", timeEstimateMinutes: 30, deadlineTimestamp: null, reminderAt: null, isCompleted: false, isParked: false,
  isNowFocus: false, isDeleted: false, orderIndex: 0, dateCompletedString: null, lastUpdated: NOW - HOUR, ...over,
});

function record(over = {}) {
  n = 0;
  const tasks = [
    t("Pinned report", { isNowFocus: true, orderIndex: 2, timeEstimateMinutes: 50, dayMapDate: "2026-10-22", dayMapStartMinutes: 600, dayMapDurationMinutes: 50, dayMapOrder: 0, customField: "kept" }),
    t("Email draft", { orderIndex: 0, dayMapDate: "2026-10-22", dayMapStartMinutes: 660, dayMapDurationMinutes: 30, dayMapOrder: 1 }),
    t("Loose end", { orderIndex: 1, concreteStep: "", timeEstimateMinutes: undefined }),
    t("Moved on", { deferredUntil: "2026-10-23" }),
    t("Finished today", { isCompleted: true, dateCompletedString: "2026-10-22" }),
    t("Set aside", { horizonLevel: "week", isParked: true, parkedAt: NOW - 10 * DAY }),
    t("Methods section", { horizonLevel: "week", frontId: "f1", orderIndex: 1 }),
    t("Big goal", { horizonLevel: "month", priority: "P1" }),
    t("Deleted one", { isDeleted: true }),
    t("Forgotten", { horizonLevel: "week", orderIndex: 0, lastUpdated: NOW - 20 * DAY }),
    t("Wrote intro", { horizonLevel: "week", frontId: "f1", isCompleted: true, dateCompletedString: "2026-10-21" }),
    t("Sprint item", { horizonLevel: "h-custom" }),
    t("Old work", { horizonLevel: "office" }),
    t("Late thing", { horizonLevel: "week", frontId: "f2" }),
  ];
  return {
    userId: "u1",
    tasks,
    config: {
      userId: "u1", userName: "Real Name", mentorName: "Mentor", coachProfileNote: "private coach note",
      dailyAnchors: [{ id: "a", text: "anchor text" }], challengeType: "overplanner", pomodoroDurationMinutes: 25,
      focusWindows: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
      fronts: [
        { id: "f1", name: "Paper", dueAt: "2026-10-30", nextMove: "Write methods" },
        { id: "f2", name: "Old front", dueAt: "2026-10-15" },
      ],
      minimumDay: { date: "2026-10-22", ids: ["u-2"] },
      dayCloseLog: [{ day: "2026-10-21", done: 3, tomorrow: 1, planned: 4, dropped: 0, focusMin: 90, note: "a fair day", at: NOW - DAY }],
      horizons: { week: { name: "This sprint" }, "h-custom": { id: "h-custom", kind: "custom", lengthDays: 10, startDate: "2026-10-20", name: "Ten days" } },
      horizonReviews: { week: { at: NOW - 3 * DAY } },
      ...over.config,
    },
    contributions: [{ dateString: "2026-10-22", count: 2 }, { dateString: "2026-10-21", count: 3 }],
    brainDump: [
      { id: "b1", text: "older thought", createdAt: NOW - 5 * DAY, fmt: 1 },
      { id: "b2", text: "**bold** idea\nsecond line", createdAt: NOW - HOUR, fmt: 1 },
      { id: "b3", text: "2**3 stays", createdAt: NOW - 2 * DAY },
    ],
    chatHistory: [{ text: "secret chat line", isUser: true }],
    ...over.top,
  };
}
const titles = (list) => list.map(x => x.title);

describe("get_today", () => {
  const out = buildToday(record(), NOW, IST);

  it("lists the open tasks pinned-first, then in the user's order", () => {
    expect(titles(out.open)).toEqual(["Pinned report", "Email draft", "Loose end"]);
    expect(out.pinned.title).toBe("Pinned report");
  });

  it("shows moved-to-tomorrow, completed-today and parked tasks, and never a deleted one", () => {
    expect(titles(out.movedToTomorrow)).toEqual(["Moved on"]);
    expect(titles(out.completedToday)).toEqual(["Finished today"]);
    expect(titles(out.parked)).toEqual(["Set aside"]);
    expect(out.parked[0].parkedDays).toBe(10);
    expect(JSON.stringify(out)).not.toContain("Deleted one");
  });

  it("returns whole task records, minus the owner id", () => {
    expect(out.open[0].customField).toBe("kept");
    expect(out.open[0]).not.toHaveProperty("userId");
    expect(out.open[0].dayMapStartMinutes).toBe(600);
  });

  it("carries the Minimum Day and the totals", () => {
    expect(out.minimumDay).toEqual([{ uuid: "u-2", title: "Email draft", isCompleted: false }]);
    expect(out.totals).toEqual({ open: 3, plannedMinutes: 50 + 30 + 25, movedToTomorrow: 1, completedToday: 1, parked: 1 });
  });

  it("reports the day as closed only for today", () => {
    expect(out.dayClose).toBeNull();
    const closed = buildToday(record({ config: { dayClose: { day: "2026-10-22", at: NOW } } }), NOW, IST);
    expect(closed.dayClose.day).toBe("2026-10-22");
    const old = buildToday(record({ config: { dayClose: { day: "2026-10-21", at: NOW - DAY } } }), NOW, IST);
    expect(old.dayClose).toBeNull();
  });
});

describe("get_day_map", () => {
  const out = buildDayMap(record(), NOW, IST);

  it("reads the windows, the gap between them as a break, and the saved route", () => {
    expect(out.focusWindows).toEqual([{ start: "09:00", end: "12:00", minutes: 180 }, { start: "14:00", end: "18:00", minutes: 240 }]);
    expect(out.breaks).toEqual([{ start: "12:00", end: "14:00", minutes: 120, name: "Break", addedByUser: false }]);
    // Laid out as the app does: the pinned task from now, then the next stop after a 5-minute buffer.
    expect(out.route.map(s => [s.title, s.routeStart, s.routeEnd])).toEqual([["Pinned report", "10:00", "10:50"], ["Email draft", "10:55", "11:25"]]);
    expect(titles(out.unscheduled)).toEqual(["Loose end"]);
  });

  it("says whether the plan fits", () => {
    expect(out.fit).toMatchObject({
      openTasksMinutes: 105, capacityMinutes: 420, remainingFocusMinutes: 360, exceedsRemainingFocusByMinutes: 0,
      routeEndsAt: "11:25", dayEndsAt: "18:00", routeOverrunMinutes: 0, wontFit: [],
    });
  });

  it("names the stops that run past the end of the day", () => {
    const rec = record();
    rec.tasks[0] = { ...rec.tasks[0], timeEstimateMinutes: 500 }; // 10:00, across the 12:00-14:00 gap, to 20:20; day ends 18:00
    const late = buildDayMap(rec, NOW, IST);
    expect(late.fit.wontFit.map(s => s.title)).toEqual(["Pinned report", "Email draft"]);
    expect(late.fit.routeOverrunMinutes).toBe(175); // Email draft then ends 20:55
  });

  it("counts the break when a flexible task spans it (Codex, #542): 120 min from 11:30 over a 12:00-14:00 gap ends 15:30, not 13:30", () => {
    const rec = record({ config: { focusWindows: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "15:00" }] } });
    rec.tasks = [rec.tasks[1]]; // Email draft alone
    rec.tasks[0] = { ...rec.tasks[0], isNowFocus: false, timeEstimateMinutes: 120, dayMapStartMinutes: 690, dayMapDurationMinutes: 120, dayMapOrder: 0 };
    const out = buildDayMap(rec, NOW, IST);
    expect(out.route).toHaveLength(1);
    expect(out.route[0]).toMatchObject({ routeStart: "11:30", routeEnd: "15:30", splitByBreak: true });
    expect(out.route[0].parts).toEqual([{ start: "11:30", end: "12:00" }, { start: "14:00", end: "15:30" }]);
    expect(out.fit.routeEndsAt).toBe("15:30");
    expect(out.fit.dayEndsAt).toBe("15:00");
    expect(out.fit.routeOverrunMinutes).toBe(30);
    expect(out.fit.wontFit.map(s => s.title)).toEqual(["Email draft"]);
  });

  it("puts a task on the route the way the app does: a saved day and order are enough, a saved start is not needed", () => {
    const rec = record();
    rec.tasks[2] = { ...rec.tasks[2], dayMapDate: "2026-10-22", dayMapOrder: 2 }; // Loose end: no saved start
    const out = buildDayMap(rec, NOW, IST);
    expect(out.route.map(s => s.title)).toEqual(["Pinned report", "Email draft", "Loose end"]);
    expect(out.unscheduled).toEqual([]);
  });

  it("flags when open work exceeds the focus time left", () => {
    const rec = record();
    rec.tasks[0] = { ...rec.tasks[0], timeEstimateMinutes: 600 };
    expect(buildDayMap(rec, NOW, IST).fit.exceedsRemainingFocusByMinutes).toBe(600 + 30 + 25 - 360);
  });

  it("includes breaks the user added", () => {
    const rec = record({ config: { dayMapBreaks: { date: "2026-10-22", items: [{ id: "x", start: 900, lengthMin: 15 }] } } });
    expect(buildDayMap(rec, NOW, IST).breaks.some(b => b.addedByUser && b.start === "15:00" && b.minutes === 15)).toBe(true);
  });

  it("copes with no route at all", () => {
    const rec = record();
    rec.tasks = rec.tasks.map(({ dayMapDate, dayMapStartMinutes, dayMapDurationMinutes, dayMapOrder, ...rest }) => rest);
    const bare = buildDayMap(rec, NOW, IST);
    expect(bare.route).toEqual([]);
    expect(bare.fit.routeEndsAt).toBeNull();
    expect(bare.unscheduled).toHaveLength(3);
  });
});

describe("get_plan", () => {
  const out = buildPlan(record(), NOW, IST);
  const byId = Object.fromEntries(out.horizons.map(h => [h.id, h]));

  it("lists every horizon with its open tasks, using the user's names, custom horizons and Work · older", () => {
    expect(byId.week.name).toBe("This sprint");
    expect(titles(byId.week.tasks).sort()).toEqual(["Forgotten", "Late thing", "Methods section"]);
    expect(titles(byId.month.tasks)).toEqual(["Big goal"]);
    expect(titles(byId["h-custom"].tasks)).toEqual(["Sprint item"]);
    expect(byId["h-custom"].name).toBe("Ten days");
    expect(titles(byId.office.tasks)).toEqual(["Old work"]);
    expect(byId.office.name).toBe("Work · older");
  });

  it("leaves out parked, completed and deleted tasks, and Today's (see get_today)", () => {
    const all = JSON.stringify(out.horizons);
    for (const gone of ["Set aside", "Wrote intro", "Deleted one", "Pinned report"]) expect(all).not.toContain(gone);
    expect(out.todaySummary).toEqual({ open: 3, movedToTomorrow: 1, see: "get_today" });
  });

  it("shows the period, days left and review of a horizon", () => {
    expect(byId.week.period).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(byId.week.daysLeft).toBe(3);
    expect(byId.week.review).toEqual({ at: NOW - 3 * DAY });
  });

  it("shows fronts with every task on them, progress and days left", () => {
    const paper = out.fronts.find(f => f.name === "Paper");
    expect(titles(paper.tasks).sort()).toEqual(["Methods section", "Wrote intro"]);
    expect(paper).toMatchObject({ daysLeft: 8, status: "upcoming", nextMove: "Write methods", progress: { done: 1, total: 2 } });
    expect(out.fronts.find(f => f.name === "Old front")).toMatchObject({ daysLeft: -7, status: "overdue" });
  });

  it("front tasks are listed in brief, with whether each is done or parked", () => {
    const paper = out.fronts.find(f => f.name === "Paper");
    expect(paper.tasks.find(x => x.title === "Wrote intro")).toMatchObject({ isCompleted: true, isParked: false });
    expect(paper.tasks[0]).not.toHaveProperty("subSteps");
  });

  it("includes what was completed in the last 14 days", () => {
    expect(titles(out.recentlyCompleted)).toEqual(["Finished today", "Wrote intro"]);
  });

  it("can be limited to one horizon, and says so for an unknown one", () => {
    const one = buildPlan(record(), NOW, IST, { horizon: "month" });
    expect(one.horizons.map(h => h.id)).toEqual(["month"]);
    expect(one).not.toHaveProperty("fronts");
    expect(buildPlan(record(), NOW, IST, { horizon: "nope" }).note).toMatch(/No horizon "nope"/);
  });
});

describe("get_mind_box", () => {
  const out = buildMindBox(record(), NOW, IST);

  it("lists every thought newest first with its age", () => {
    expect(out.count).toBe(3);
    expect(out.thoughts.map(x => x.id)).toEqual(["b2", "b3", "b1"]);
    expect(out.thoughts.map(x => x.ageDays)).toEqual([0, 2, 5]);
    expect(out.thoughts[0].created).toBe("2026-10-22 09:00");
  });

  it("shows the text as the user sees it: markers resolved, line breaks kept, older plain text untouched", () => {
    expect(out.thoughts[0].text).toBe("bold idea\nsecond line");
    expect(out.thoughts[1].text).toBe("2**3 stays");
  });

  it("copes with an empty or damaged list", () => {
    expect(buildMindBox({}, NOW, IST).thoughts).toEqual([]);
    expect(buildMindBox({ brainDump: [null, "junk", { id: "x", text: "ok", createdAt: NOW, fmt: 1 }] }, NOW, IST).count).toBe(1);
  });
});

describe("get_week", () => {
  it("gives each day its ticks, completed tasks and Close-the-day record", () => {
    const out = buildWeek(record(), NOW, IST, { days: 3 });
    expect(out.days.map(d => d.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(out.days.map(d => d.ticks)).toEqual([0, 3, 2]);
    expect(titles(out.days[1].completedTasks)).toEqual(["Wrote intro"]);
    expect(out.days[1].dayClose).toMatchObject({ done: 3, focusMin: 90, note: "a fair day" });
    expect(out.days[0].dayClose).toBeNull();
    expect(out.totals).toEqual({ ticks: 5, completedTasks: 2 });
  });

  it("keeps the number of days sensible", () => {
    expect(buildWeek(record(), NOW, IST, { days: 999 }).days).toHaveLength(60);
    expect(buildWeek(record(), NOW, IST, { days: 0 }).days).toHaveLength(14);
    expect(buildWeek(record(), NOW, IST).days).toHaveLength(14);
  });
});

describe("get_stuck", () => {
  const out = buildStuck(record(), NOW, IST);

  it("lists overdue, long-parked, untouched and incomplete tasks with their ages", () => {
    expect(out.overdue).toMatchObject([{ title: "Late thing", due: "2026-10-15", daysOverdue: 7, viaFront: "Old front" }]);
    expect(out.parked).toMatchObject([{ title: "Set aside", parkedDays: 10 }]);
    expect(out.untouched).toMatchObject([{ title: "Forgotten", daysSinceEdited: 20 }]);
    expect(titles(out.noNextStep)).toEqual(["Loose end"]);
    expect(titles(out.noEstimate)).toEqual(["Loose end"]);
  });

  it("uses the thresholds it is given", () => {
    const strict = buildStuck(record(), NOW, IST, { staleDays: 30, parkedDays: 30 });
    expect(strict.untouched).toEqual([]);
    expect(strict.parked).toEqual([]);
    expect(strict.thresholds).toEqual({ staleDays: 30, parkedDays: 30 });
  });
});

describe("get_settings", () => {
  it("returns only the settings that shape a plan", () => {
    const out = buildSettings(record(), NOW, IST);
    expect(out.settings).toMatchObject({ challengeType: "overplanner", pomodoroDurationMinutes: 25 });
    expect(out.effectiveFocusWindows).toHaveLength(2);
    expect(out.settings).not.toHaveProperty("userName");
  });
});

describe("what never leaves", () => {
  it("no tool returns names, anchors, the profile note or chat", () => {
    const all = [buildOverview, buildToday, buildDayMap, buildPlan, buildMindBox, buildWeek, buildStuck, buildSettings]
      .map(build => JSON.stringify(build(record(), NOW, IST))).join("\n");
    for (const leak of ["Real Name", "Mentor", "anchor text", "private coach note", "secret chat line"]) expect(all).not.toContain(leak);
  });
});

describe("damaged timestamps", () => {
  it("read as unknown instead of failing the page", () => {
    const rec = record();
    rec.tasks[5] = { ...rec.tasks[5], parkedAt: 1e20 };
    rec.brainDump[0] = { ...rec.brainDump[0], createdAt: -5 };
    expect(buildToday(rec, NOW, IST).parked[0]).toMatchObject({ title: "Set aside", parkedDays: null });
    expect(buildMindBox(rec, NOW, IST).thoughts.find(x => x.id === "b1")).toMatchObject({ created: null, ageDays: null });
    expect(() => buildStuck(rec, NOW, IST)).not.toThrow();
  });
});

describe("big lists", () => {
  it("cuts a list at 200 and says so", () => {
    const rec = record();
    rec.tasks = Array.from({ length: 250 }, (_, i) => t(`Task ${i}`, { orderIndex: i }));
    const out = buildToday(rec, NOW, IST);
    expect(out.open).toHaveLength(200);
    expect(out.totals.open).toBe(250);
    expect(out.truncated).toEqual([{ list: "open", total: 250, shown: 200 }]);
  });
});

describe("empty record", () => {
  it("every page copes with nothing at all", () => {
    for (const build of [buildOverview, buildToday, buildDayMap, buildPlan, buildMindBox, buildWeek, buildStuck, buildSettings]) {
      expect(() => build(null, NOW, IST)).not.toThrow();
    }
  });
});
