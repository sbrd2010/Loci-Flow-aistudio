import { describe, it, expect } from "vitest";
import { buildWallCommitmentSave, committedTaskIdsForDay } from "./dailyCoachCheckins";
import { deriveCommitmentDeadlineMove } from "./deadlineCountdown";
import { minutesFromSeconds, eventMinutes } from "./focusLedger";

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
    expect(deriveCommitmentDeadlineMove(withDeadline, [{ uuid: "t1", isCompleted: true, horizonLevel: "today" }], TODAY)).toBe(TODAY);
  });

  it("is open when it is not", () => {
    expect(deriveCommitmentDeadlineMove(withDeadline, [{ uuid: "t1", isCompleted: false, horizonLevel: "today" }], TODAY)).toBeNull();
  });

  // Reopening one commitment must not clear a move another already made.
  it("stays done while another of today's commitments stands", () => {
    const config = { ...withDeadline, dailyCommitmentTaskIds: ["t1", "t2"] };
    const tasks = [{ uuid: "t1", isCompleted: false, horizonLevel: "today" }, { uuid: "t2", isCompleted: true, horizonLevel: "today" }];
    expect(deriveCommitmentDeadlineMove(config, tasks, TODAY)).toBe(TODAY);
  });

  // Two readers of one field must agree on what counts: a recorded commitment
  // moved to Week and completed there is dropped by getValidCommittedTaskIds,
  // so Day Close omits it — this must omit it too.
  it("ignores a commitment completed after being moved off Today", () => {
    const tasks = [{ uuid: "t1", isCompleted: true, horizonLevel: "week" }];
    expect(deriveCommitmentDeadlineMove(withDeadline, tasks, TODAY)).toBeNull();
  });

  it("ignores a deleted task", () => {
    const tasks = [{ uuid: "t1", isCompleted: true, isDeleted: true, horizonLevel: "today" }];
    expect(deriveCommitmentDeadlineMove(withDeadline, tasks, TODAY)).toBeNull();
  });

  // undefined means "no opinion" — the observer in App writes nothing, rather
  // than clearing a field it has no business touching.
  it("has no opinion without a key deadline, or with nothing committed today", () => {
    const tasks = [{ uuid: "t1", isCompleted: true, horizonLevel: "today" }];
    expect(deriveCommitmentDeadlineMove({ dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["t1"] }, tasks, TODAY)).toBeUndefined();
    expect(deriveCommitmentDeadlineMove({ deadlineLabel: "Thesis" }, tasks, TODAY)).toBeUndefined();
    expect(deriveCommitmentDeadlineMove({ ...withDeadline, dailyCommitmentDate: YESTERDAY }, tasks, TODAY)).toBeUndefined();
    expect(deriveCommitmentDeadlineMove(withDeadline, tasks, null)).toBeUndefined();
  });
});

// Third Codex round: the label that tells the user how many minutes an action
// will log has to use the ledger's own conversion, not a reimplementation.
describe("minutesFromSeconds", () => {
  it("rounds the way the ledger credits, rather than flooring", () => {
    expect(minutesFromSeconds(90)).toBe(2);   // a floor here read "log 1m" and booked 2
    expect(minutesFromSeconds(110)).toBe(2);
    expect(minutesFromSeconds(60)).toBe(1);
  });

  it("counts nothing under a minute, so a mis-tap is not a move", () => {
    expect(minutesFromSeconds(59)).toBe(0);
    expect(minutesFromSeconds(0)).toBe(0);
  });

  it("is what eventMinutes uses", () => {
    expect(eventMinutes({ focusElapsedSeconds: 90 })).toBe(minutesFromSeconds(90));
    expect(eventMinutes({})).toBe(0);
  });
});
