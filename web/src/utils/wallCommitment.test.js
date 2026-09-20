import { describe, it, expect } from "vitest";
import { buildWallCommitmentSave, committedTaskIdsForDay } from "./dailyCoachCheckins";
import { deriveCommitmentDeadlineMove } from "./deadlineCountdown";

// PR #380 deleted the morning check-in, which was the only writer of the
// daily-commitment fields, and the Key Deadline strip, which was the only
// writer of deadlineDailyDoneDate. Their readers all survived. These cover
// the two paths that now record what those prompts used to.

const TODAY = "2024-06-15";
const YESTERDAY = "2024-06-14";

describe("buildWallCommitmentSave", () => {
  it("records the pinned task as today's commitment", () => {
    const patch = buildWallCommitmentSave({}, "t1", TODAY, 1000);
    expect(patch.dailyCommitmentDate).toBe(TODAY);
    expect(patch.dailyCommitmentTaskIds).toEqual(["t1"]);
    expect(patch.dailyCommitmentSource).toBe("wall");
  });

  it("appends a second commitment made the same day", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"], dailyCommitmentCreatedAt: 500 };
    const patch = buildWallCommitmentSave(config, "t2", TODAY, 1000);
    expect(patch.dailyCommitmentTaskIds).toEqual(["t1", "t2"]);
    // The day's first commitment is when the day's commitment began.
    expect(patch.dailyCommitmentCreatedAt).toBe(500);
  });

  it("starts over when the recorded day has rolled past", () => {
    const config = { dailyCommitmentDate: YESTERDAY, dailyCommitmentTaskIds: ["old"] };
    expect(buildWallCommitmentSave(config, "t1", TODAY, 1000).dailyCommitmentTaskIds).toEqual(["t1"]);
  });

  it("keeps at most three, dropping the oldest", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["a", "b", "c"] };
    expect(buildWallCommitmentSave(config, "d", TODAY, 1000).dailyCommitmentTaskIds).toEqual(["b", "c", "d"]);
  });

  it("writes nothing when the task is already recorded, or there is nothing to record", () => {
    const config = { dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };
    expect(buildWallCommitmentSave(config, "t1", TODAY, 1000)).toBeNull();
    expect(buildWallCommitmentSave({}, null, TODAY)).toBeNull();
    expect(buildWallCommitmentSave({}, "t1", null)).toBeNull();
  });
});

describe("committedTaskIdsForDay", () => {
  it("returns today's ids, and nothing once the day has rolled over", () => {
    expect(committedTaskIdsForDay({ dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] }, TODAY)).toEqual(["t1"]);
    expect(committedTaskIdsForDay({ dailyCommitmentDate: YESTERDAY, dailyCommitmentTaskIds: ["t1"] }, TODAY)).toEqual([]);
    expect(committedTaskIdsForDay({}, TODAY)).toEqual([]);
  });
});

describe("deriveCommitmentDeadlineMove", () => {
  const withDeadline = { deadlineLabel: "Thesis", deadlineDate: "2024-07-01", dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] };

  it("is done when the commitment is complete", () => {
    expect(deriveCommitmentDeadlineMove(withDeadline, [{ uuid: "t1", isCompleted: true }], TODAY)).toBe(TODAY);
  });

  it("is open when it is not", () => {
    expect(deriveCommitmentDeadlineMove(withDeadline, [{ uuid: "t1", isCompleted: false }], TODAY)).toBeNull();
  });

  // Reopening one commitment must not clear a move another already made.
  it("stays done while another of today's commitments stands", () => {
    const config = { ...withDeadline, dailyCommitmentTaskIds: ["t1", "t2"] };
    const tasks = [{ uuid: "t1", isCompleted: false }, { uuid: "t2", isCompleted: true }];
    expect(deriveCommitmentDeadlineMove(config, tasks, TODAY)).toBe(TODAY);
  });

  it("ignores a deleted task", () => {
    const tasks = [{ uuid: "t1", isCompleted: true, isDeleted: true }];
    expect(deriveCommitmentDeadlineMove(withDeadline, tasks, TODAY)).toBeNull();
  });

  // undefined means "no opinion" — the observer in App writes nothing, rather
  // than clearing a field it has no business touching.
  it("has no opinion without a key deadline, or with nothing committed today", () => {
    const tasks = [{ uuid: "t1", isCompleted: true }];
    expect(deriveCommitmentDeadlineMove({ dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] }, tasks, TODAY)).toBeUndefined();
    expect(deriveCommitmentDeadlineMove({ deadlineLabel: "Thesis" }, tasks, TODAY)).toBeUndefined();
    expect(deriveCommitmentDeadlineMove({ ...withDeadline, dailyCommitmentDate: YESTERDAY }, tasks, TODAY)).toBeUndefined();
    expect(deriveCommitmentDeadlineMove(withDeadline, tasks, null)).toBeUndefined();
  });
});
