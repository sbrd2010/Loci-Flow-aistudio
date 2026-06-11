import { describe, it, expect } from "vitest";
import { normalizePayload, sanitizeTaskForRules, sanitizeTasksForRules } from "./normalizePayload";

describe("sanitizeTaskForRules", () => {
  it("repairs a task with non-string title and concreteStep", () => {
    const task = sanitizeTaskForRules({
      id: 1,
      userId: "user-a",
      uuid: "task-1",
      title: ["bad", "title"],
      concreteStep: ["bad", "step"],
      horizonLevel: "month",
    }, 0, "user-a", 1000);

    expect(task.title).toBe("Untitled task");
    expect(task.concreteStep).toBe("Do first tiny step");
    expect(task.horizonLevel).toBe("month");
    expect(task.uuid).toBe("task-1");
  });

  it("caps oversized title and concreteStep to Firebase rule limits", () => {
    const task = sanitizeTaskForRules({
      id: 1,
      userId: "user-a",
      title: "T".repeat(400),
      concreteStep: "S".repeat(400),
    }, 0, "user-a", 1000);

    expect(task.title).toHaveLength(300);
    expect(task.concreteStep).toHaveLength(300);
  });

  it("fills required id, userId, title, and uuid when missing", () => {
    const task = sanitizeTaskForRules({ horizonLevel: "month" }, 2, "fallback-user", 5000);

    expect(task.id).toBe(5002);
    expect(task.userId).toBe("fallback-user");
    expect(task.title).toBe("Untitled task");
    expect(task.uuid).toBe("repaired-5000-2");
    expect(task.horizonLevel).toBe("month");
  });

  it("turns a non-object task array entry into a hidden recovered item instead of crashing sync", () => {
    const task = sanitizeTaskForRules("bad task", 1, "user-a", 7000);

    expect(task.id).toBe(7001);
    expect(task.userId).toBe("user-a");
    expect(task.title).toBe("Recovered invalid task");
    expect(task.isDeleted).toBe(true);
  });

  it("strips undefined-valued keys that would crash Firebase's set()", () => {
    const task = sanitizeTaskForRules({
      id: 1,
      userId: "user-a",
      uuid: "task-1",
      title: "Edited task",
      subSteps: undefined,
    }, 0, "user-a", 1000);

    expect(task).not.toHaveProperty("subSteps");
  });
});

describe("sanitizeTasksForRules", () => {
  it("repairs every malformed task in an existing local payload", () => {
    const tasks = sanitizeTasksForRules([
      { id: 1, userId: "user-a", title: "Good task", concreteStep: "Open file" },
      { id: 2, title: 123, concreteStep: { bad: true } },
    ], "user-a", 9000);

    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("Good task");
    expect(tasks[1].userId).toBe("user-a");
    expect(tasks[1].title).toBe("Untitled task");
    expect(tasks[1].concreteStep).toBe("Do first tiny step");
  });
});

describe("normalizePayload task repair", () => {
  it("repairs old malformed cached tasks before savePayload can write them to Firebase", () => {
    const normalized = normalizePayload({
      userId: "user-a",
      config: { userId: "user-a" },
      tasks: [
        {
          id: 1,
          userId: "user-a",
          uuid: "old-bad-task",
          title: ["old", "bad", "title"],
          concreteStep: ["old", "bad", "step"],
          horizonLevel: "month",
          priority: "P3",
        },
      ],
      brainDump: [{ id: "dump-1", text: "new idea" }],
    });

    expect(normalized.tasks).toHaveLength(1);
    expect(normalized.tasks[0].uuid).toBe("old-bad-task");
    expect(normalized.tasks[0].title).toBe("Untitled task");
    expect(normalized.tasks[0].concreteStep).toBe("Do first tiny step");
    expect(normalized.brainDump).toHaveLength(1);
  });

  it("uses config.userId as fallback when root userId is missing", () => {
    const normalized = normalizePayload({
      config: { userId: "config-user" },
      tasks: [{ id: 1, title: "Task without userId" }],
    });

    expect(normalized.tasks[0].userId).toBe("config-user");
  });
});
