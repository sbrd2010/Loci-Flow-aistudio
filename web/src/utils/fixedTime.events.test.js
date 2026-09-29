import { describe, expect, it } from "vitest";
import { eventAsks } from "./fixedTime";

describe("Did it happen? (Q36.3, Q36a)", () => {
  const row = (fixedKind) => ({ kind: "stop", fixed: true, start: 720, end: 750, task: { title: "Call", fixedKind } });

  it("asks 5 minutes after a call ends, never while it runs", () => {
    expect(eventAsks(row("event"), 735)).toBe(false);
    expect(eventAsks(row("event"), 754)).toBe(false);
    expect(eventAsks(row("event"), 755)).toBe(true);
  });

  it("only for something at a set time, not a task you fixed", () => {
    expect(eventAsks(row(undefined), 800)).toBe(false);
  });
});
