import { describe, it, expect } from "vitest";
import { computeRitualSecondsLeft, nextRitualStep } from "./ritualTimer";

describe("computeRitualSecondsLeft", () => {
  it("returns the full step duration at the moment the step starts", () => {
    const now = 1_000_000;
    expect(computeRitualSecondsLeft(now + 60_000, now)).toBe(60);
  });

  it("decreases based on elapsed wall-clock time", () => {
    const now = 1_000_000;
    const endAt = now + 30_000;
    expect(computeRitualSecondsLeft(endAt, now + 10_000)).toBe(20);
    expect(computeRitualSecondsLeft(endAt, now + 25_000)).toBe(5);
  });

  it("catches up correctly after a background-tab delay", () => {
    const now = 1_000_000;
    const endAt = now + 30_000;
    // Interval was throttled for the full 30s — single tick should show 0
    expect(computeRitualSecondsLeft(endAt, now + 30_000)).toBe(0);
  });

  it("clamps to 0 when the interval fires late (overshoot)", () => {
    const now = 1_000_000;
    const endAt = now + 30_000;
    expect(computeRitualSecondsLeft(endAt, now + 35_000)).toBe(0);
  });

  it("uses ceiling so display shows 1 until the exact end moment", () => {
    const now = 1_000_000;
    const endAt = now + 30_000;
    expect(computeRitualSecondsLeft(endAt, now + 29_001)).toBe(1);
    expect(computeRitualSecondsLeft(endAt, now + 29_999)).toBe(1);
    expect(computeRitualSecondsLeft(endAt, now + 30_000)).toBe(0);
  });
});

describe("nextRitualStep", () => {
  it("advances to the next step when not on the last step", () => {
    expect(nextRitualStep(0, 6)).toEqual({ done: false, nextIndex: 1 });
    expect(nextRitualStep(4, 6)).toEqual({ done: false, nextIndex: 5 });
  });

  it("marks the ritual as done on the final step", () => {
    expect(nextRitualStep(5, 6)).toEqual({ done: true, nextIndex: -1 });
  });

  it("handles a single-step ritual (edge case)", () => {
    expect(nextRitualStep(0, 1)).toEqual({ done: true, nextIndex: -1 });
  });
});
