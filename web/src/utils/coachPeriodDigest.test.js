import { describe, expect, it } from "vitest";
import { buildLociPeriodContext, buildLociDeadlinesContext, detectDeadlineIntent, DIGEST_FINISHED_MAX } from "./coachPeriodDigest";

const NOW = new Date(2026, 9, 24, 10, 0); // Sat 24 Oct 2026, 10:00
const DAY = 86400000;
const done = (title, dateCompletedString, over = {}) => ({ uuid: title, title, isCompleted: true, isDeleted: false, dateCompletedString, lastUpdated: NOW.getTime() - 1000, ...over });
const open = (title, over = {}) => ({ uuid: title, title, isCompleted: false, isDeleted: false, isParked: false, lastUpdated: NOW.getTime() - DAY, ...over });
const tick = (dateString, count) => ({ dateString, count });

describe("buildLociPeriodContext", () => {
  it("is never empty: an empty week says so plainly", () => {
    const out = buildLociPeriodContext({ now: NOW });
    expect(out).toContain("PERIOD DIGEST (the last 7 days");
    expect(out).toContain("Finished: 0 tasks on 0 days (the 7 days before: 0).");
    expect(out).not.toContain("Finished tasks still on file");
  });

  it("counts this week, compares with the week before, and lists the days oldest first", () => {
    const contributions = [tick("2026-10-23", 3), tick("2026-10-22", 1), tick("2026-10-15", 5), tick("2026-10-10", 9)];
    const out = buildLociPeriodContext({ now: NOW, contributions });
    expect(out).toContain("Finished: 4 tasks on 2 days (the 7 days before: 5).");
    expect(out).toContain("By day, oldest first: Sun 18 0, Mon 19 0, Tue 20 0, Wed 21 0, Thu 22 1, Fri 23 3, Sat 24 0.");
  });

  it("lists finished titles by the day they are stamped with, not by when they were last edited", () => {
    const tasks = [
      done("Wrote the intro", "2026-10-23"),
      done("Old win", "2026-09-01", { lastUpdated: NOW.getTime() }), // edited today, finished long ago
      done("Fixed figure 2", "2026-10-22"),
    ];
    const out = buildLociPeriodContext({ now: NOW, tasks });
    expect(out).toContain("newest first, with the day each was finished: 'Wrote the intro' (Fri 23), 'Fixed figure 2' (Thu 22).");
    expect(out).not.toContain("Old win");
  });

  it("puts the day on every title, so yesterday's can be told from the rest of the week's", () => {
    const tasks = [done("Yesterday's win", "2026-10-23"), done("Wednesday's win", "2026-10-21"), done("Today's win", "2026-10-24")];
    const out = buildLociPeriodContext({ now: NOW, tasks });
    expect(out).toContain("'Today's win' (Sat 24), 'Yesterday's win' (Fri 23), 'Wednesday's win' (Wed 21)");
  });

  it("leaves out deleted tasks, and caps the list with a count of the rest", () => {
    const tasks = [
      ...Array.from({ length: DIGEST_FINISHED_MAX + 3 }, (_, i) => done(`Task ${i}`, "2026-10-23", { lastUpdated: 1000 + i })),
      done("Deleted one", "2026-10-23", { isDeleted: true }),
    ];
    const out = buildLociPeriodContext({ now: NOW, tasks });
    expect(out).toContain("… +3 more");
    expect(out).not.toContain("Deleted one");
    expect(out.match(/'Task \d+' \(Fri 23\)/g)).toHaveLength(DIGEST_FINISHED_MAX);
  });

  it("clips a very long title", () => {
    const out = buildLociPeriodContext({ now: NOW, tasks: [done("x".repeat(300), "2026-10-23")] });
    expect(out).toContain(`'${"x".repeat(59)}…' (Fri 23)`);
  });

  it("counts by Loci day: at 00:30 in a window that runs to 02:00 the last day is still yesterday", () => {
    const late = { focusWindows: [{ start: "07:00", end: "02:00" }] };
    const lateNight = new Date(2026, 9, 24, 0, 30); // Loci day: Fri 23
    const out = buildLociPeriodContext({ now: lateNight, config: late, contributions: [tick("2026-10-23", 2), tick("2026-10-24", 7)], tasks: [done("Late finish", "2026-10-23")] });
    expect(out).toContain("Finished: 2 tasks on 1 day");
    expect(out).toContain("Fri 23 2");
    expect(out).not.toContain("Sat 24");
    expect(out).toContain("'Late finish' (Fri 23)");
  });

  it("for a month gives the 30-day total and comparison, with no per-day list", () => {
    const out = buildLociPeriodContext({ now: NOW, days: 30, contributions: [tick("2026-10-01", 4), tick("2026-09-10", 6)] });
    expect(out).toContain("the last 30 days");
    expect(out).toContain("Finished: 4 tasks on 1 day (the 30 days before: 6).");
    expect(out).not.toContain("By day");
  });

  describe("focus time", () => {
    const raw = {
      "2026-10-23": { a: { type: "focus_completed", taskId: "t", lociDateString: "2026-10-23", focusElapsedSeconds: 3600 } },
      "2026-10-21": { b: { type: "focus_completed", taskId: "t", lociDateString: "2026-10-21", focusElapsedSeconds: 1500 } },
    };

    it("is included when the focus log was read", () => {
      const out = buildLociPeriodContext({ now: NOW, focusRaw: raw });
      expect(out).toContain("Focus time: 1h25m on 2 days (");
      expect(out).toContain("Fri 23 1h");
    });

    it("says none was logged when the log is empty", () => {
      expect(buildLociPeriodContext({ now: NOW, focusRaw: {} })).toContain("Focus time: none logged in those 7 days.");
    });

    it("tells the model not to guess when the log could not be read", () => {
      expect(buildLociPeriodContext({ now: NOW, focusRaw: null })).toContain("Focus time: not available in this message; do not guess it.");
    });
  });

  describe("last week and last month (offset 1)", () => {
    const contributions = [tick("2026-10-23", 3), tick("2026-10-16", 4), tick("2026-10-12", 2), tick("2026-10-05", 6)];
    const tasks = [done("This week win", "2026-10-23"), done("Last week win", "2026-10-16"), done("Week before win", "2026-10-05")];

    it("covers the period before the current one, with its own dates, and compares with the one before that", () => {
      const out = buildLociPeriodContext({ now: NOW, contributions, tasks, offset: 1 });
      expect(out).toContain("(the 7 days before the last 7 days, 11 Oct to 17 Oct,");
      expect(out).toContain("Finished: 6 tasks on 2 days (the 7 days before that: 6).");
      expect(out).toContain("By day, oldest first: Sun 11 0, Mon 12 2, Tue 13 0, Wed 14 0, Thu 15 0, Fri 16 4, Sat 17 0.");
      expect(out).toContain("'Last week win' (Fri 16)");
      expect(out).not.toContain("This week win");
      expect(out).not.toContain("Week before win");
    });

    it("takes the focus minutes from that period, not the current one", () => {
      const raw = {
        "2026-10-23": { a: { type: "focus_completed", taskId: "t", lociDateString: "2026-10-23", focusElapsedSeconds: 3600 } }, // this week
        "2026-10-16": { b: { type: "focus_completed", taskId: "t", lociDateString: "2026-10-16", focusElapsedSeconds: 1800 } }, // last week
      };
      expect(buildLociPeriodContext({ now: NOW, focusRaw: raw, offset: 1 })).toContain("Focus time: 30m on 1 day (");
      expect(buildLociPeriodContext({ now: NOW, focusRaw: raw, offset: 0 })).toContain("Focus time: 1h on 1 day (");
    });

    it("for 'last month' covers the 30 days before the current 30", () => {
      const out = buildLociPeriodContext({ now: NOW, days: 30, offset: 1, contributions: [tick("2026-10-01", 4), tick("2026-09-10", 6), tick("2026-08-20", 1)] });
      expect(out).toContain("the 30 days before the last 30 days");
      expect(out).toContain("Finished: 6 tasks on 1 day (the 30 days before that: 1).");
    });

    it("says the deadline and open-task lines describe today", () => {
      expect(buildLociPeriodContext({ now: NOW, offset: 1 })).toContain("The deadline and open-task lines below describe today, not that period.");
      expect(buildLociPeriodContext({ now: NOW, offset: 0 })).not.toContain("describe today");
    });
  });

  describe("untouched tasks", () => {
    it("lists open tasks not touched for 14+ days, oldest first, and prints the number it used", () => {
      const tasks = [open("Ancient", { lastUpdated: NOW.getTime() - 40 * DAY }), open("Stale", { lastUpdated: NOW.getTime() - 20 * DAY }), open("Fresh")];
      const out = buildLociPeriodContext({ now: NOW, tasks });
      expect(out).toContain("not touched for 14+ days (2), oldest first: 'Ancient' (40 days), 'Stale' (20 days).");
      expect(out).toContain("14 days is a default, not the user's own rule");
      expect(out).not.toContain("'Fresh'");
    });

    it("ignores parked, finished and deleted tasks, and caps the list", () => {
      const old = NOW.getTime() - 50 * DAY;
      const tasks = [
        open("Parked", { isParked: true, lastUpdated: old }),
        done("Finished", "2026-01-01", { lastUpdated: old }),
        open("Deleted", { isDeleted: true, lastUpdated: old }),
        ...Array.from({ length: 5 }, (_, i) => open(`Stale ${i}`, { lastUpdated: old - i })),
      ];
      const out = buildLociPeriodContext({ now: NOW, tasks });
      expect(out).toContain("(5), oldest first");
      expect(out.match(/'Stale \d'/g)).toHaveLength(3);
      expect(out).not.toMatch(/'(Parked|Finished|Deleted)'/);
    });
  });

  it("stays small however much there is to say", () => {
    const tasks = [
      ...Array.from({ length: 40 }, (_, i) => done(`A fairly long finished task title number ${i} for the week`, "2026-10-23", { lastUpdated: i })),
      ...Array.from({ length: 40 }, (_, i) => open(`A fairly long stale open task title number ${i} nobody touched`, { lastUpdated: 1000 + i })),
    ];
    const config = { fronts: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `Front number ${i} with a longish name`, dueAt: `2026-10-${10 + i}` })) };
    const out = buildLociPeriodContext({ now: NOW, tasks, config, contributions: [tick("2026-10-23", 40)], focusRaw: {} });
    expect(out.length).toBeLessThan(1800); // about 430 tokens, inside the room a typical full_task turn has under Groq's limit
  });
});

describe("buildLociDeadlinesContext", () => {
  const config = { fronts: [{ id: "f1", name: "Paper", dueAt: "2026-10-30" }, { id: "f2", name: "Old front", dueAt: "2026-10-20" }, { id: "f3", name: "Someday" }] };

  it("is empty when no front has a deadline", () => {
    expect(buildLociDeadlinesContext({ now: NOW, config: { fronts: [{ id: "f", name: "No date" }] } })).toBe("");
    expect(buildLociDeadlinesContext({ now: NOW })).toBe("");
  });

  it("lists dated fronts, overdue first, with how far along each is", () => {
    const tasks = [done("a", "2026-10-01", { frontId: "f1" }), open("b", { frontId: "f1" }), open("c", { frontId: "f1" })];
    const out = buildLociDeadlinesContext({ now: NOW, config, tasks });
    expect(out.indexOf("Old front")).toBeLessThan(out.indexOf("Paper"));
    expect(out).toContain("'Old front': due 20 Oct, 4 days overdue; 0 of 0 tasks done.");
    expect(out).toContain("'Paper': due 30 Oct, in 6 days; 1 of 3 tasks done.");
    expect(out).not.toContain("Someday");
  });

  it("says 'due today' on the day", () => {
    expect(buildLociDeadlinesContext({ now: new Date(2026, 9, 30, 9), config })).toContain("due 30 Oct, due today");
  });
});

describe("detectDeadlineIntent", () => {
  it.each(["what's due this week?", "am I on track?", "anything overdue", "when is my deadline", "am I falling behind"])("%s", (q) => {
    expect(detectDeadlineIntent(q)).toBe(true);
  });
  it("is false for other messages", () => {
    expect(detectDeadlineIntent("I feel scattered")).toBe(false);
    expect(detectDeadlineIntent("")).toBe(false);
  });
});
