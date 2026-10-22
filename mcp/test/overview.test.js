import { describe, expect, it } from "vitest";
import { buildOverview } from "../src/overview.js";

const IST = "Asia/Kolkata";
// 2026-10-22 01:00 in India, which is still 2026-10-21 in UTC.
const NOW = Date.UTC(2026, 9, 21, 19, 30, 0);

const task = (over) => ({
  id: Math.random(), userId: "u1", uuid: `t-${Math.random()}`, title: "Sample task", concreteStep: "",
  horizonLevel: "today", priority: "P2", category: "Work", timeEstimateMinutes: 30,
  deadlineTimestamp: null, isCompleted: false, isParked: false, isNowFocus: false, isDeleted: false,
  orderIndex: 0, dateCompletedString: null, lastUpdated: 1, ...over,
});
// Midday in India on the given date, so the deadline's calendar day is unambiguous.
const noonIst = (y, m, d) => Date.UTC(y, m - 1, d, 6, 30, 0);

const payload = (tasks, config = {}, extra = {}) => ({ userId: "u1", tasks, config: { userId: "u1", ...config }, timestamp: 1, ...extra });

describe("buildOverview", () => {
  it("reads 'today' in the user's zone, not UTC", () => {
    const out = buildOverview(payload([]), NOW, IST);
    expect(out.today).toBe("2026-10-22");
    expect(out.timeZone).toBe(IST);
  });

  it("counts open work per horizon and keeps deferred 'today' tasks out of Today", () => {
    const out = buildOverview(payload([
      task({ title: "A" }),
      task({ title: "B", deferredUntil: "2026-10-23" }),
      task({ title: "C", horizonLevel: "week" }),
      task({ title: "D", horizonLevel: "week", isParked: true }),
      task({ title: "E", isDeleted: true }),
    ]), NOW, IST);
    expect(out.horizons).toEqual({ today: 1, tomorrow: 1, week: 1 });
    expect(out.todayList.tasks.map(t => t.title)).toEqual(["A"]);
  });

  it("totals planned minutes and today's completions", () => {
    const out = buildOverview(payload([
      task({ timeEstimateMinutes: 45 }),
      task({ timeEstimateMinutes: 15 }),
      task({ isCompleted: true, dateCompletedString: "2026-10-22" }),
      task({ isCompleted: true, dateCompletedString: "2026-10-21" }),
    ]), NOW, IST);
    expect(out.todayList.plannedMinutes).toBe(60);
    expect(out.todayList.completedCount).toBe(1);
  });

  it("splits task deadlines into overdue, due today and upcoming by calendar day", () => {
    const out = buildOverview(payload([
      task({ title: "late", deadlineTimestamp: noonIst(2026, 10, 20) }),
      task({ title: "today", deadlineTimestamp: noonIst(2026, 10, 22) }),
      task({ title: "soon", horizonLevel: "week", deadlineTimestamp: noonIst(2026, 10, 25) }),
      task({ title: "far", horizonLevel: "month", deadlineTimestamp: noonIst(2026, 12, 25) }),
      task({ title: "done late", deadlineTimestamp: noonIst(2026, 10, 1), isCompleted: true }),
    ]), NOW, IST);
    expect(out.taskDeadlines.overdue).toEqual([{ title: "late", horizon: "today", due: "2026-10-20", daysLeft: -2 }]);
    expect(out.taskDeadlines.dueToday.map(d => d.title)).toEqual(["today"]);
    expect(out.taskDeadlines.upcoming.map(d => d.title)).toEqual(["soon"]);
  });

  it("a deadline later today in India is due today even when UTC is still the day before", () => {
    const out = buildOverview(payload([task({ title: "x", deadlineTimestamp: Date.UTC(2026, 9, 22, 12, 0, 0) })]), NOW, IST);
    expect(out.taskDeadlines.dueToday.map(d => d.title)).toEqual(["x"]);
  });

  it("projects the key deadline and stored fronts with days left and status", () => {
    const out = buildOverview(payload(
      [task({ frontId: "f1" }), task({ frontId: "f1", isCompleted: true })],
      { deadlineLabel: "Thesis draft", deadlineDate: "2026-10-20", fronts: [{ id: "f1", name: "Paper", dueAt: "2026-11-01", nextMove: "Write methods" }] },
    ), NOW, IST);
    expect(out.fronts.map(f => [f.name, f.daysLeft, f.status])).toEqual([["Thesis draft", -2, "overdue"], ["Paper", 10, "upcoming"]]);
    expect(out.fronts[1].tasks).toEqual({ open: 1, done: 1 });
    expect(out.fronts[1].nextMove).toBe("Write methods");
  });

  it("lists the last seven days, oldest first, from contributions", () => {
    const out = buildOverview(payload([], {}, { contributions: [{ dateString: "2026-10-22", count: 3 }, { dateString: "2026-10-20", count: 1 }] }), NOW, IST);
    expect(out.last7Days.map(d => d.date)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(out.last7Days.map(d => d.completed)).toEqual([0, 0, 0, 0, 1, 0, 3]);
  });

  describe("a day that runs past midnight (window 07:00-02:00), asked at 01:00 on the 23rd", () => {
    // 01:00 IST on 2026-10-23: the calendar says the 23rd, the user's Loci day is still the 22nd.
    const LATE = Date.UTC(2026, 9, 22, 19, 30, 0);
    const late = (tasks, config = {}, extra = {}) => payload(tasks, { focusWindows: [{ start: "07:00", end: "02:00" }], ...config }, extra);

    it("reports both days: the calendar date for 'today', the Loci day for the Today list", () => {
      const out = buildOverview(late([]), LATE, IST);
      expect(out.today).toBe("2026-10-23");
      expect(out.lociDay).toBe("2026-10-22");
    });

    it("measures deadlines from the calendar date, as the app's front countdown does", () => {
      const out = buildOverview(late(
        [task({ title: "due 23rd", deadlineTimestamp: noonIst(2026, 10, 23) }), task({ title: "due 22nd", deadlineTimestamp: noonIst(2026, 10, 22) })],
        { fronts: [{ id: "f1", name: "Paper", dueAt: "2026-10-23" }] },
      ), LATE, IST);
      expect(out.fronts[0]).toMatchObject({ name: "Paper", daysLeft: 0, status: "due today" });
      expect(out.taskDeadlines.dueToday.map(d => d.title)).toEqual(["due 23rd"]);
      expect(out.taskDeadlines.overdue.map(d => d.title)).toEqual(["due 22nd"]);
    });

    it("keys the last seven days by calendar date, as contributions are stored", () => {
      const out = buildOverview(late([], {}, { contributions: [{ dateString: "2026-10-23", count: 2 }] }), LATE, IST);
      expect(out.last7Days.at(-1)).toEqual({ date: "2026-10-23", completed: 2 });
    });

    it("keeps the Loci day for the Today list: yesterday's completions count, 'tomorrow' tasks stay out", () => {
      const out = buildOverview(late([
        task({ title: "done in the small hours", isCompleted: true, dateCompletedString: "2026-10-22" }),
        task({ title: "later", deferredUntil: "2026-10-23" }),
        task({ title: "now" }),
      ]), LATE, IST);
      expect(out.todayList.completedCount).toBe(1);
      expect(out.todayList.tasks.map(t => t.title)).toEqual(["now"]);
      expect(out.horizons.tomorrow).toBe(1);
    });
  });

  it("keeps the pinned task and the user's order when the Today list is cut", () => {
    const many = Array.from({ length: 45 }, (_, i) => task({ title: `T${i}`, orderIndex: 45 - i })); // stored in reverse of the user's order
    many[44].isNowFocus = true; // the last one stored, pinned
    const out = buildOverview(payload(many), NOW, IST);
    const titles = out.todayList.tasks.map(t => t.title);
    expect(titles[0]).toBe("T44"); // pinned first
    expect(titles.slice(1, 4)).toEqual(["T43", "T42", "T41"]); // then lowest orderIndex first
    expect(titles).toHaveLength(40);
  });

  describe("task deadlines", () => {
    it("a task with no date of its own takes its front's, and says so", () => {
      const out = buildOverview(payload(
        [task({ title: "own date", frontId: "f1", deadlineTimestamp: noonIst(2026, 10, 24) }), task({ title: "inherited", frontId: "f1" }), task({ title: "no front" })],
        { fronts: [{ id: "f1", name: "Paper", dueAt: "2026-10-30" }] },
      ), NOW, IST);
      expect(out.taskDeadlines.upcoming).toEqual([
        { title: "own date", horizon: "today", due: "2026-10-24", daysLeft: 2 },
        { title: "inherited", horizon: "today", due: "2026-10-30", daysLeft: 8, viaFront: "Paper" },
      ]);
    });

    it("a task on an overdue front is overdue, and a parked front's date is ignored", () => {
      const out = buildOverview(payload(
        [task({ title: "late", frontId: "f1" }), task({ title: "parked", frontId: "f2" })],
        { fronts: [{ id: "f1", name: "Old", dueAt: "2026-10-15" }, { id: "f2", name: "Shelved", dueAt: "2026-10-15", parked: true }] },
      ), NOW, IST);
      expect(out.taskDeadlines.overdue.map(d => d.title)).toEqual(["late"]);
    });

    it("treats 0, negative and absurd timestamps as no date, without failing", () => {
      for (const bad of [0, -5, 1e20, Infinity, "soon"]) {
        const out = buildOverview(payload([task({ title: "x", deadlineTimestamp: bad })]), NOW, IST);
        expect(out.taskDeadlines).toEqual({ overdue: [], dueToday: [], upcoming: [] });
      }
    });
  });

  it("copes with holes in the contributions list", () => {
    const out = buildOverview(payload([], {}, { contributions: [null, { dateString: "2026-10-22", count: 2 }, undefined, "junk"] }), NOW, IST);
    expect(out.last7Days.at(-1)).toEqual({ date: "2026-10-22", completed: 2 });
  });

  it("never returns private fields", () => {
    const out = JSON.stringify(buildOverview(payload([task()], { userName: "Real Name", mentorName: "Mentor", dailyAnchors: [{ id: "a", text: "anchor text" }] }, {
      chatHistory: [{ text: "secret chat", isUser: true }],
      brainDump: [{ id: "b", text: "secret thought" }],
    }), NOW, IST));
    for (const leak of ["Real Name", "Mentor", "anchor text", "secret chat", "secret thought"]) expect(out).not.toContain(leak);
  });

  it("handles an empty or missing record", () => {
    expect(buildOverview(null, NOW, IST).todayList.openCount).toBe(0);
    expect(buildOverview({}, NOW, IST).fronts).toEqual([]);
  });

  it("caps the Today list and says so", () => {
    const many = Array.from({ length: 45 }, (_, i) => task({ title: `T${i}` }));
    const out = buildOverview(payload(many), NOW, IST);
    expect(out.todayList.openCount).toBe(45);
    expect(out.todayList.tasks).toHaveLength(40);
    expect(out.todayList.truncated).toBe(true);
  });
});
