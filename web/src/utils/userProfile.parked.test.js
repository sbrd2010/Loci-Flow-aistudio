import { describe, expect, it } from "vitest";
import { computeUserProfile, profileToCoachContext } from "./userProfile";

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
    dateCompletedString: null,
    ...overrides
  };
}

describe("parked task profile signals", () => {
  it("does not count parked tasks as active workload", () => {
    const profile = computeUserProfile({
      tasks: [
        task({ title: "Active today", horizonLevel: "today" }),
        task({ title: "Parked week", horizonLevel: "week", isParked: true }),
        task({ title: "Parked P1", priority: "P1", isParked: true })
      ]
    });

    expect(profile.totalTasks).toBe(3);
    expect(profile.totalActive).toBe(1);
    expect(profile.horizonMix).toEqual({ today: 1 });
    expect(profile.priorityMix).toEqual({ P3: 1 });
  });

  it("does not warn about P1 urgency inflation from parked tasks", () => {
    const profile = computeUserProfile({
      tasks: [
        task({ isCompleted: true, dateCompletedString: "2026-06-01" }),
        task({ priority: "P3" }),
        task({ priority: "P3" }),
        task({ priority: "P1", isParked: true }),
        task({ priority: "P1", isParked: true }),
        task({ priority: "P1", isParked: true })
      ]
    });

    const context = profileToCoachContext(profile);
    expect(context).not.toContain("overusing urgency");
  });
});
