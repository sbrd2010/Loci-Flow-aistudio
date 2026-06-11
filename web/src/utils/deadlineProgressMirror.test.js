import { describe, expect, it } from "vitest";
import { buildDeadlineProgressMirror } from "./deadlineProgressMirror";

describe("deadlineProgressMirror", () => {
  it("returns a neutral empty mirror when no key deadline exists", () => {
    const mirror = buildDeadlineProgressMirror({}, new Date(2026, 5, 7, 12));

    expect(mirror.hasDeadline).toBe(false);
    expect(mirror.days).toEqual([]);
    expect(mirror.headline).toBe("No key deadline set");
  });

  it("summarizes done, missed, and open daily moves over the last 7 local days", () => {
    const mirror = buildDeadlineProgressMirror({
      deadlineLabel: "Job contract by 30 Sept",
      deadlineAction: "send one job application",
      deadlineMoveHistory: {
        "2026-06-03": "done",
        "2026-06-04": "missed",
        "2026-06-05": "done",
        "2026-06-06": "missed"
      }
    }, new Date(2026, 5, 7, 23, 30));

    expect(mirror.hasDeadline).toBe(true);
    expect(mirror.todayStr).toBe("2026-06-07");
    expect(mirror.days).toHaveLength(7);
    expect(mirror.days.map(day => day.dateStr)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07"
    ]);
    expect(mirror.doneCount).toBe(2);
    expect(mirror.missedCount).toBe(2);
    expect(mirror.todayStatus).toBe("open");
    expect(mirror.tone).toBe("watch");
  });

  it("treats today's saved done date as a done move", () => {
    const mirror = buildDeadlineProgressMirror({
      deadlineLabel: "Visa deadline",
      deadlineAction: "apply to one role",
      deadlineDailyDoneDate: "2026-06-07",
      deadlineMoveHistory: {
        "2026-06-06": "done"
      }
    }, new Date(2026, 5, 7, 9));

    expect(mirror.todayStatus).toBe("done");
    expect(mirror.doneCount).toBe(2);
    expect(mirror.doneRun).toBe(2);
    expect(mirror.tone).toBe("good");
    expect(mirror.headline).toBe("Today is protected");
  });

  it("uses urgent copy when missed moves cluster", () => {
    const mirror = buildDeadlineProgressMirror({
      deadlineLabel: "Key deadline",
      deadlineAction: "send one message",
      deadlineMoveHistory: {
        "2026-06-02": "missed",
        "2026-06-04": "missed",
        "2026-06-06": "missed"
      }
    }, new Date(2026, 5, 7, 10));

    expect(mirror.missedCount).toBe(3);
    expect(mirror.tone).toBe("urgent");
    expect(mirror.headline).toBe("3 missed moves in 7 days");
    expect(mirror.body).toContain("Do send one message");
  });

  it("spans Mon Jun 8 - Sun Jun 14 when today is Thursday June 11 2026", () => {
    const mirror = buildDeadlineProgressMirror({
      deadlineLabel: "Visa deadline",
      deadlineAction: "apply to one role",
      deadlineMoveHistory: {
        "2026-06-08": "done",
        "2026-06-09": "done",
        "2026-06-10": "done",
        "2026-06-11": "done",
      }
    }, new Date(2026, 5, 11, 10)); // Jun 11, 2026 (Thursday)

    expect(mirror.hasDeadline).toBe(true);
    expect(mirror.todayStr).toBe("2026-06-11");
    expect(mirror.days).toHaveLength(7);
    expect(mirror.days.map(d => d.dateStr)).toEqual([
      "2026-06-08", // Mon
      "2026-06-09", // Tue
      "2026-06-10", // Wed
      "2026-06-11", // Thu
      "2026-06-12", // Fri
      "2026-06-13", // Sat
      "2026-06-14"  // Sun
    ]);

    const thu = mirror.days[3];
    expect(thu.isToday).toBe(true);
    expect(thu.dateLabel).toBe("Jun 11");
    expect(thu.label).toBe("Th");

    // doneRun counts backwards from Thursday
    // Mon-Thu are done, so run should be 4
    expect(mirror.doneRun).toBe(4);
  });

  it("handles future days as untracked and counts doneRun backwards from today", () => {
    const mirror = buildDeadlineProgressMirror({
      deadlineLabel: "Visa deadline",
      deadlineAction: "apply to one role",
      deadlineMoveHistory: {
        "2026-06-08": "done",
        "2026-06-09": "done",
        "2026-06-10": "done",
        // Thu 11 is open (not in history)
        "2026-06-12": "done" // future day already marked done (edge case, shouldn't count in today's run)
      }
    }, new Date(2026, 5, 11, 10)); // Jun 11, 2026 (Thursday)

    // Friday (Jun 12), Saturday (Jun 13), Sunday (Jun 14) are future days
    expect(mirror.days[4].status).toBe("done"); // in history but future
    expect(mirror.days[5].status).toBe("untracked"); // untracked fallback
    expect(mirror.days[6].status).toBe("untracked"); // untracked fallback

    expect(mirror.todayStatus).toBe("open");
    // Run counts back from today (Thu), skipping today (open), so Wed (done), Tue (done), Mon (done) -> 3
    expect(mirror.doneRun).toBe(3);
  });

  it("uses the previous calendar day during an overnight focus window at 1:00 AM", () => {
    // 2026-06-12 (Friday) at 1:00 AM.
    // Overnight window configured: 22:00 to 04:00 (1320 mins to 240 mins)
    const config = {
      deadlineLabel: "Visa deadline",
      deadlineAction: "apply to one role",
      focusWindows: [{ start: "22:00", end: "04:00" }]
    };

    const mirror = buildDeadlineProgressMirror(config, new Date(2026, 5, 12, 1, 0));
    
    // It is Friday calendar day, but logically still Thursday Loci day (Jun 11)
    expect(mirror.todayStr).toBe("2026-06-11");
    expect(mirror.days.map(d => d.dateStr)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11", // Thursday (isToday: true)
      "2026-06-12",
      "2026-06-13",
      "2026-06-14"
    ]);
    expect(mirror.days[3].isToday).toBe(true);
  });

  it("handles empty/missing history gracefully when deadline is configured", () => {
    const config = {
      deadlineLabel: "Visa deadline",
      deadlineAction: "apply to one role"
    };

    const mirror = buildDeadlineProgressMirror(config, new Date(2026, 5, 11, 10));

    expect(mirror.hasDeadline).toBe(true);
    expect(mirror.doneCount).toBe(0);
    expect(mirror.missedCount).toBe(0);
    expect(mirror.doneRun).toBe(0);
    expect(mirror.todayStatus).toBe("open");
    expect(mirror.days.filter(d => d.isToday)[0].status).toBe("open");
    expect(mirror.days.filter(d => !d.isToday).every(d => d.status === "untracked")).toBe(true);
  });
});
