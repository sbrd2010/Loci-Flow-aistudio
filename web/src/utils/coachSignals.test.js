import { describe, expect, it } from "vitest";
import { buildExecutionCoachSignal, getDeadlineMissStreak } from "./coachSignals";

function task(overrides = {}) {
  return {
    uuid: Math.random().toString(36).slice(2),
    title: "Task",
    horizonLevel: "today",
    priority: "P3",
    timeEstimateMinutes: 25,
    isCompleted: false,
    isDeleted: false,
    isParked: false,
    orderIndex: 0,
    ...overrides
  };
}

describe("getDeadlineMissStreak", () => {
  it("counts consecutive missed deadline moves before today", () => {
    const date = new Date(2026, 5, 7, 12, 0);
    const streak = getDeadlineMissStreak({
      deadlineMoveHistory: {
        "2026-06-06": "missed",
        "2026-06-05": "missed",
        "2026-06-04": "missed",
        "2026-06-03": "done"
      }
    }, date);

    expect(streak).toBe(3);
  });

  it("stops when the previous day was done", () => {
    const date = new Date(2026, 5, 7, 12, 0);
    const streak = getDeadlineMissStreak({
      deadlineMoveHistory: {
        "2026-06-06": "done",
        "2026-06-05": "missed"
      }
    }, date);

    expect(streak).toBe(0);
  });
});

describe("buildExecutionCoachSignal", () => {
  it("raises a mirror signal after three missed deadline moves", () => {
    const signal = buildExecutionCoachSignal({
      config: {
        deadlineLabel: "Job contract by September",
        deadlineAction: "Apply to one job today",
        deadlineMoveHistory: {
          "2026-06-06": "missed",
          "2026-06-05": "missed",
          "2026-06-04": "missed"
        }
      },
      tasks: [task({ title: "Send CV", uuid: "t1" })]
    }, new Date(2026, 5, 7, 12, 0));

    expect(signal.shouldShow).toBe(true);
    expect(signal.level).toBe("mirror");
    expect(signal.reason).toBe("deadline_missed_three_days");
    expect(signal.body).toContain("Apply to one job today");
  });

  it("anchors to Now Focus before generic deadline nudges", () => {
    const signal = buildExecutionCoachSignal({
      config: { deadlineLabel: "Job contract", deadlineAction: "Apply today" },
      tasks: [task({ title: "Write cover letter", uuid: "focus-1", isNowFocus: true })]
    }, new Date(2026, 5, 7, 10, 0));

    expect(signal.reason).toBe("now_focus_active");
    expect(signal.primaryTaskUuid).toBe("focus-1");
    expect(signal.body).toContain("Write cover letter");
  });

  it("uses Day Map next task when no Now Focus is pinned", () => {
    const signal = buildExecutionCoachSignal({
      config: {},
      tasks: [
        task({ title: "Later", uuid: "later", dayMapDate: "2026-06-07", dayMapOrder: 2 }),
        task({ title: "First route task", uuid: "first", dayMapDate: "2026-06-07", dayMapOrder: 1 })
      ]
    }, new Date(2026, 5, 7, 10, 0));

    expect(signal.reason).toBe("day_map_next_task");
    expect(signal.primaryTaskUuid).toBe("first");
  });

  it("does not count parked or deleted tasks as active today", () => {
    const signal = buildExecutionCoachSignal({
      config: {},
      tasks: [
        task({ title: "Parked", isParked: true }),
        task({ title: "Deleted", isDeleted: true })
      ]
    }, new Date(2026, 5, 7, 10, 0));

    expect(signal.shouldShow).toBe(false);
    expect(signal.reason).toBe("no_active_today_tasks");
  });

  it("detects too many open tasks when nothing is completed today", () => {
    const tasks = Array.from({ length: 8 }, (_, index) => task({ title: `Task ${index + 1}`, orderIndex: index }));
    const signal = buildExecutionCoachSignal({ config: {}, tasks }, new Date(2026, 5, 7, 10, 0));

    expect(signal.level).toBe("mirror");
    expect(signal.reason).toBe("too_many_today_none_done");
  });

  it("counts a task completed on the current Loci day toward completedToday during an overnight focus window", () => {
    // 2026-06-12 at 1:00 AM with focusWindows 22:00-04:00 -> Loci day is 2026-06-11.
    const date = new Date(2026, 5, 12, 1, 0);
    const activeTasks = Array.from({ length: 8 }, (_, index) => task({ title: `Task ${index + 1}`, orderIndex: index }));
    const completedTask = task({ title: "Done earlier", uuid: "done-1", isCompleted: true, dateCompletedString: "2026-06-11" });
    const signal = buildExecutionCoachSignal({
      config: { focusWindows: [{ start: "22:00", end: "04:00" }] },
      tasks: [...activeTasks, completedTask]
    }, date);

    expect(signal.reason).not.toBe("too_many_today_none_done");
  });

  it("treats deadlineDailyDoneDate as done for the current Loci day (not calendar day) during an overnight focus window", () => {
    // 2026-06-12 at 1:00 AM with focusWindows 22:00-04:00 -> Loci day is 2026-06-11.
    const date = new Date(2026, 5, 12, 1, 0);
    const signal = buildExecutionCoachSignal({
      config: {
        focusWindows: [{ start: "22:00", end: "04:00" }],
        deadlineLabel: "Visa deadline",
        deadlineAction: "Send one email",
        deadlineDailyDoneDate: "2026-06-11",
      },
      tasks: [task({ title: "Write CV", uuid: "t1" })]
    }, date);

    expect(signal.reason).not.toBe("deadline_move_open_today");
    expect(signal.reason).toBe("next_task_available");
  });
});
