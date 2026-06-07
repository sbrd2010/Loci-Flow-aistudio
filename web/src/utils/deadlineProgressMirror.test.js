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
});
