import { describe, it, expect } from "vitest";
import { computeUserProfile, profileToCoachContext } from "./userProfile";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides = {}) {
  return {
    uuid: Math.random().toString(36).slice(2),
    title: "Test task",
    horizonLevel: "today",
    priority: "P3",
    timeEstimateMinutes: 25,
    isCompleted: false,
    isDeleted: false,
    dateCompletedString: null,
    ...overrides
  };
}

function makePayload(overrides = {}) {
  return {
    tasks: [],
    contributions: [],
    brainDump: [],
    config: {},
    ...overrides
  };
}

// ── computeUserProfile ─────────────────────────────────────────────────────

describe("computeUserProfile", () => {
  it("handles empty payload gracefully", () => {
    const profile = computeUserProfile(makePayload());
    expect(profile.totalTasks).toBe(0);
    expect(profile.totalCompleted).toBe(0);
    expect(profile.totalActive).toBe(0);
    expect(profile.completionRate).toBe(0);
    expect(profile.brainDumpPending).toBe(0);
  });

  it("computes completion rate correctly", () => {
    const tasks = [
      makeTask({ isCompleted: true, dateCompletedString: "2024-06-10" }),
      makeTask({ isCompleted: true, dateCompletedString: "2024-06-11" }),
      makeTask({ isCompleted: false }),
      makeTask({ isCompleted: false }),
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    expect(profile.totalTasks).toBe(4);
    expect(profile.totalCompleted).toBe(2);
    expect(profile.totalActive).toBe(2);
    expect(profile.completionRate).toBe(0.5);
  });

  it("excludes deleted tasks from totals", () => {
    const tasks = [
      makeTask({ isDeleted: true }),
      makeTask({ isDeleted: true }),
      makeTask({ isCompleted: false }),
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    expect(profile.totalTasks).toBe(1);
  });

  it("computes dominant horizon from active tasks", () => {
    const tasks = [
      makeTask({ horizonLevel: "today" }),
      makeTask({ horizonLevel: "today" }),
      makeTask({ horizonLevel: "week" }),
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    expect(profile.dominantHorizon).toBe("today");
  });

  it("computes average estimate only from tasks that have one", () => {
    const tasks = [
      makeTask({ timeEstimateMinutes: 30 }),
      makeTask({ timeEstimateMinutes: 60 }),
      makeTask({ timeEstimateMinutes: 0 }),  // no estimate
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    expect(profile.avgEstimateMinutes).toBe(45); // (30+60)/2
  });

  it("counts brain dump pending correctly", () => {
    const brainDump = [
      { id: "1", text: "idea one", createdAt: Date.now() },
      { id: "2", text: "idea two", createdAt: Date.now() },
    ];
    const profile = computeUserProfile(makePayload({ brainDump }));
    expect(profile.brainDumpPending).toBe(2);
  });

  it("does NOT mutate the input payload", () => {
    const tasks = [makeTask(), makeTask({ isCompleted: true, dateCompletedString: "2024-06-10" })];
    const brainDump = [{ id: "1", text: "thought", createdAt: Date.now() }];
    const payload = makePayload({ tasks, brainDump });
    const tasksBefore = JSON.stringify(payload.tasks);
    const brainDumpBefore = JSON.stringify(payload.brainDump);

    computeUserProfile(payload);

    expect(JSON.stringify(payload.tasks)).toBe(tasksBefore);
    expect(JSON.stringify(payload.brainDump)).toBe(brainDumpBefore);
  });

  it("brain dump items are preserved and not affected by profile computation", () => {
    const brainDump = [
      { id: "bd1", text: "call the dentist", createdAt: Date.now() },
      { id: "bd2", text: "fix the bug", createdAt: Date.now() },
      { id: "bd3", text: "read the report", createdAt: Date.now() },
    ];
    const tasks = Array.from({ length: 10 }, () => makeTask());
    const payload = makePayload({ tasks, brainDump });

    computeUserProfile(payload);

    expect(payload.brainDump).toHaveLength(3);
    expect(payload.brainDump[0].text).toBe("call the dentist");
    expect(payload.brainDump[2].text).toBe("read the report");
  });

  it("tasks array is untouched after profile computation", () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ title: `Task ${i}`, horizonLevel: i < 3 ? "today" : "week" })
    );
    const payload = makePayload({ tasks });
    const originalTitles = payload.tasks.map(t => t.title);

    computeUserProfile(payload);

    expect(payload.tasks.map(t => t.title)).toEqual(originalTitles);
  });

  it("computes best completion day from dateCompletedString", () => {
    // 2024-06-11 is a Tuesday
    const tasks = [
      makeTask({ isCompleted: true, dateCompletedString: "2024-06-11" }),
      makeTask({ isCompleted: true, dateCompletedString: "2024-06-11" }),
      makeTask({ isCompleted: true, dateCompletedString: "2024-06-10" }), // Monday
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    expect(profile.completionsByDay["Tue"]).toBe(2);
    expect(profile.completionsByDay["Mon"]).toBe(1);
    expect(profile.bestCompletionDay).toBe("Tue");
  });

  it("does not include lastProfiledAt or profileVersion (not persisted)", () => {
    const profile = computeUserProfile(makePayload());
    expect(profile.lastProfiledAt).toBeUndefined();
    expect(profile.profileVersion).toBeUndefined();
  });
});

// ── profileToCoachContext ──────────────────────────────────────────────────

describe("profileToCoachContext", () => {
  it("returns empty string for null profile", () => {
    expect(profileToCoachContext(null)).toBe("");
  });

  it("returns empty string for undefined profile", () => {
    expect(profileToCoachContext(undefined)).toBe("");
  });

  it("returns empty string when totalTasks < 5", () => {
    const tasks = Array.from({ length: 4 }, () => makeTask());
    const profile = computeUserProfile(makePayload({ tasks }));
    expect(profile.totalTasks).toBe(4);
    expect(profileToCoachContext(profile)).toBe("");
  });

  it("activates at exactly 5 tasks", () => {
    const tasks = Array.from({ length: 5 }, () => makeTask());
    const profile = computeUserProfile(makePayload({ tasks }));
    expect(profile.totalTasks).toBe(5);
    expect(profileToCoachContext(profile)).not.toBe("");
  });

  it("includes completion rate in the output", () => {
    const tasks = [
      ...Array.from({ length: 6 }, () => makeTask({ isCompleted: true, dateCompletedString: "2024-06-10" })),
      ...Array.from({ length: 4 }, () => makeTask()),
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    const context = profileToCoachContext(profile);
    expect(context).toContain("60%");
  });

  it("flags over-planning when completion rate < 40%", () => {
    const tasks = [
      makeTask({ isCompleted: true, dateCompletedString: "2024-06-10" }),
      ...Array.from({ length: 9 }, () => makeTask()),
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    const context = profileToCoachContext(profile);
    expect(context).toContain("over-planning");
  });

  it("flags high executor when completion rate > 80%", () => {
    const tasks = [
      ...Array.from({ length: 9 }, () => makeTask({ isCompleted: true, dateCompletedString: "2024-06-10" })),
      makeTask(),
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    const context = profileToCoachContext(profile);
    expect(context).toContain("high executor");
  });

  it("flags P1 inflation when > 35% of tasks are P1", () => {
    const tasks = [
      ...Array.from({ length: 4 }, () => makeTask({ priority: "P1" })),
      makeTask({ priority: "P2" }),
      makeTask({ priority: "P3" }),
    ];
    const profile = computeUserProfile(makePayload({ tasks }));
    const context = profileToCoachContext(profile);
    expect(context).toContain("P1");
    expect(context).toContain("overusing urgency");
  });

  it("includes brain dump count when pending > 0", () => {
    const tasks = Array.from({ length: 5 }, () => makeTask());
    const brainDump = [{ id: "1", text: "idea", createdAt: Date.now() }];
    const profile = computeUserProfile(makePayload({ tasks, brainDump }));
    const context = profileToCoachContext(profile);
    expect(context).toContain("Brain dump backlog: 1");
  });

  it("does not include brain dump line when pending is 0", () => {
    const tasks = Array.from({ length: 5 }, () => makeTask());
    const profile = computeUserProfile(makePayload({ tasks }));
    const context = profileToCoachContext(profile);
    expect(context).not.toContain("Brain dump");
  });
});
