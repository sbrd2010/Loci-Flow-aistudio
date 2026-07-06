import { describe, expect, it } from "vitest";
import { buildRescueHandoffContext, buildRescueHandoffSummary, shouldClearRescueHandoff } from "./rescueHandoff";

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

  describe("shouldClearRescueHandoff", () => {
    it("clears when the latest summary is still the one that was used", () => {
      expect(shouldClearRescueHandoff({ createdAt: 100 }, 100)).toBe(true);
    });

    it("does not clear a newer summary saved while a reply was in flight", () => {
      expect(shouldClearRescueHandoff({ createdAt: 200 }, 100)).toBe(false);
    });

    it("does not clear when no summary was used to build the prompt", () => {
      expect(shouldClearRescueHandoff({ createdAt: 100 }, null)).toBe(false);
    });

    it("does not clear when the summary has since been removed entirely", () => {
      expect(shouldClearRescueHandoff(null, 100)).toBe(false);
    });
  });
});
