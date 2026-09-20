import { describe, it, expect } from "vitest";
import { commitmentDaysLeft, commitmentKickerFront } from "./fronts";

// The wall shows "MEMBRANE PAPER · 11d". Before this, the name came from the
// commitment's front while the count came from the legacy config.deadlineDate
// — so one front's days sat beside another front's name, and a front's own
// dueAt was never shown.
const now = new Date("2024-06-15T10:00:00");
const legacy = { deadlineLabel: "Thesis", deadlineDate: "2024-07-01" };

describe("commitmentKickerFront", () => {
  const front = { id: "f1", name: "Membrane paper", dueAt: "2024-06-26" };

  it("names the commitment's own front first", () => {
    expect(commitmentKickerFront(front, legacy).name).toBe("Membrane paper");
  });

  // L1: "a committed task never suppresses a countdown the user has already
  // set". K1's "no kicker, no day count" was written against the first-launch
  // task, where no Key Deadline exists either.
  it("falls back to the Key Deadline's own label when there is no front", () => {
    expect(commitmentKickerFront(null, legacy).name).toBe("Thesis");
  });

  it("is nothing at all when there is neither — no kicker, not a bare label", () => {
    expect(commitmentKickerFront(null, {})).toBeNull();
    expect(commitmentKickerFront(null, { deadlineDate: "2024-07-01" })).toBeNull();
  });
});

describe("commitmentDaysLeft", () => {
  it("counts the front it is given", () => {
    expect(commitmentDaysLeft({ id: "f1", name: "Membrane paper", dueAt: "2024-06-26" }, now)).toBe(11);
  });

  it("counts the Key Deadline when that is what the kicker resolved to", () => {
    expect(commitmentDaysLeft(commitmentKickerFront(null, legacy), now)).toBe(16);
  });

  it("shows no count for a front with no due date, rather than an unrelated one", () => {
    expect(commitmentDaysLeft({ id: "f1", name: "Reading", dueAt: null }, now)).toBeNull();
  });

  it("treats an overdue deadline as no count, not a negative one", () => {
    expect(commitmentDaysLeft({ id: "f1", name: "Late", dueAt: "2024-06-01" }, now)).toBeNull();
  });

  it("is zero on the day itself", () => {
    expect(commitmentDaysLeft({ id: "f1", name: "Today", dueAt: "2024-06-15" }, now)).toBe(0);
  });

  it("shows nothing when the kicker resolved to nothing", () => {
    expect(commitmentDaysLeft(null, now)).toBeNull();
  });
});
