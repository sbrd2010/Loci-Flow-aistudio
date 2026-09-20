import { describe, it, expect } from "vitest";
import { countCompletedOn } from "./taskOps";

// The wall's "N done" is a claim about today. A completed task keeps the Today
// horizon until something moves it, so counting every completed task there
// reports last week's work as this morning's.
describe("countCompletedOn", () => {
  const tasks = [
    { uuid: "a", isCompleted: true, dateCompletedString: "2024-06-15" },
    { uuid: "b", isCompleted: true, dateCompletedString: "2024-06-14" },
    { uuid: "c", isCompleted: true, dateCompletedString: null },
    { uuid: "d", isCompleted: false, dateCompletedString: null },
  ];

  it("counts only tasks completed on the given day", () => {
    expect(countCompletedOn(tasks, "2024-06-15")).toBe(1);
    expect(countCompletedOn(tasks, "2024-06-14")).toBe(1);
  });

  it("does not count a completed task with no recorded day", () => {
    expect(countCompletedOn(tasks, "2024-06-13")).toBe(0);
  });

  it("returns zero rather than a total when the day is missing", () => {
    expect(countCompletedOn(tasks, null)).toBe(0);
    expect(countCompletedOn(tasks, undefined)).toBe(0);
  });

  it("tolerates a missing or ragged list", () => {
    expect(countCompletedOn(undefined, "2024-06-15")).toBe(0);
    expect(countCompletedOn([null, undefined], "2024-06-15")).toBe(0);
  });
});
