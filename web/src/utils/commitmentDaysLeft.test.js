import { describe, it, expect } from "vitest";
import { commitmentDaysLeft } from "./fronts";

// The wall shows "MEMBRANE PAPER · 11d". Before this, the name came from the
// commitment's front while the count came from the legacy config.deadlineDate
// — so one front's days sat beside another front's name, and a front's own
// dueAt was never shown.
const now = new Date("2024-06-15T10:00:00");
const legacy = { deadlineLabel: "Thesis", deadlineDate: "2024-07-01" };

describe("commitmentDaysLeft", () => {
  it("counts the commitment's own front, not the legacy deadline", () => {
    const front = { id: "f1", name: "Membrane paper", dueAt: "2024-06-26" };
    expect(commitmentDaysLeft(front, legacy, now)).toBe(11);
  });

  it("falls back to the legacy key deadline when the task has no front", () => {
    expect(commitmentDaysLeft(null, legacy, now)).toBe(16);
  });

  it("shows no count for a front with no due date, rather than an unrelated one", () => {
    const front = { id: "f1", name: "Reading", dueAt: null };
    expect(commitmentDaysLeft(front, legacy, now)).toBeNull();
  });

  it("treats an overdue deadline as no count, not a negative one", () => {
    expect(commitmentDaysLeft({ id: "f1", name: "Late", dueAt: "2024-06-01" }, legacy, now)).toBeNull();
  });

  it("is zero on the day itself", () => {
    expect(commitmentDaysLeft({ id: "f1", name: "Today", dueAt: "2024-06-15" }, legacy, now)).toBe(0);
  });

  it("shows nothing when there is neither a front deadline nor a legacy one", () => {
    expect(commitmentDaysLeft(null, {}, now)).toBeNull();
  });
});
