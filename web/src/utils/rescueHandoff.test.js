import { describe, expect, it } from "vitest";
import { buildRescueHandoffContext, buildRescueHandoffSummary } from "./rescueHandoff";

describe("rescueHandoff", () => {
  it("does not summarize non-chat rescue sessions", () => {
    expect(buildRescueHandoffSummary({ reason: "anxious", chatted: false })).toBeNull();
  });

  it("builds a lightweight natural handoff summary without storing transcript text", () => {
    const summary = buildRescueHandoffSummary({
      reason: "anxious",
      task: { title: "Write grant draft" },
      entryPoint: "deep_focus",
      outcome: "dismissed",
      chatted: true,
      now: new Date("2026-07-06T10:00:00Z"),
      config: {},
    });

    expect(summary.text).toBe('Used Rescue Mode from Deep Focus earlier today (anxious while stuck on "Write grant draft") and left without resolving it.');
    expect(summary.taskTitle).toBe("Write grant draft");
    expect(summary.lociDay).toBe("2026-07-06");
    expect(summary).not.toHaveProperty("messages");
    expect(summary).not.toHaveProperty("transcript");
  });

  it("surfaces only unconsumed same-day summaries to the Coach prompt", () => {
    const summary = buildRescueHandoffSummary({
      reason: "tired",
      entryPoint: "today",
      outcome: "accepted",
      chatted: true,
      now: new Date("2026-07-06T10:00:00Z"),
      config: {},
    });

    expect(buildRescueHandoffContext(summary, { now: new Date("2026-07-06T12:00:00Z"), config: {} })).toContain("RECENT RESCUE MODE HANDOFF");
    expect(buildRescueHandoffContext({ ...summary, consumedAt: Date.now() }, { now: new Date("2026-07-06T12:00:00Z"), config: {} })).toBe("");
    expect(buildRescueHandoffContext(summary, { now: new Date("2026-07-07T12:00:00Z"), config: {} })).toBe("");
  });
});
