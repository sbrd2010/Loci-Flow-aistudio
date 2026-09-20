import { describe, it, expect } from "vitest";
import { resolveCoachNudge, buildCoachNudgeDeliveredConfig } from "./coachNudge";

// Both of these cover regressions from PR #380, where the proactive nudge
// moved off Today and Coach became the thing that derives and delivers it.

const payload = { config: { dayStartHour: 6, dayEndHour: 24 } };
const now = new Date("2024-06-15T10:00:00");

const derivedSignal = {
  shouldShow: true,
  level: "nudge",
  reason: "day_map_next_task",
  title: "Follow the route",
  body: "Start there.",
  primaryTaskUuid: "t1",
};

describe("resolveCoachNudge", () => {
  it("delivers a pending hand-off from today", () => {
    const pending = { reason: "handed_off", title: "T", body: "B", lociDayStr: "2024-06-15" };
    const { nudge, pendingIsStale } = resolveCoachNudge({ pending, derived: null, payload, now });
    expect(pendingIsStale).toBe(false);
    expect(nudge).toBe(pending);
  });

  // The bug: a stale hand-off used to win, and the staleness check ran only
  // AFTER the day had been marked cleared — so the day's real nudge was
  // suppressed and nothing was delivered in its place.
  it("does not let a hand-off from a previous day beat today's derived signal", () => {
    const pending = { reason: "handed_off", title: "T", body: "B", lociDayStr: "2024-06-14" };
    const { nudge, pendingIsStale } = resolveCoachNudge({ pending, derived: derivedSignal, payload, now });
    expect(pendingIsStale).toBe(true);
    expect(nudge.reason).toBe("day_map_next_task");
  });

  it("reports a stale hand-off for sweeping even when there is nothing to replace it", () => {
    const pending = { reason: "handed_off", title: "T", body: "B", lociDayStr: "2024-06-14" };
    const { nudge, pendingIsStale } = resolveCoachNudge({ pending, derived: null, payload, now });
    expect(pendingIsStale).toBe(true);
    expect(nudge).toBeNull();
  });

  it("is null when there is neither a hand-off nor a signal", () => {
    expect(resolveCoachNudge({ pending: null, derived: null, payload, now }).nudge).toBeNull();
  });
});

describe("buildCoachNudgeDeliveredConfig", () => {
  it("marks the day spent so the same nudge is not re-delivered on every open", () => {
    const patch = buildCoachNudgeDeliveredConfig(derivedSignal, {}, payload, now);
    expect(patch.coachNudgeClearedDate).toBe("2024-06-15");
  });

  it("clears a pending hand-off only when one exists", () => {
    expect(buildCoachNudgeDeliveredConfig(derivedSignal, {}, payload, now))
      .not.toHaveProperty("pendingCoachNudge");
    expect(buildCoachNudgeDeliveredConfig(derivedSignal, { pendingCoachNudge: { reason: "x" } }, payload, now).pendingCoachNudge)
      .toBeNull();
  });

  // Without this sentinel buildExecutionCoachSignal asks "how did it go?"
  // about the same expired deadline every Loci day, forever.
  it("records that an expired deadline has been asked about", () => {
    const nudge = { reason: "deadline_date_passed_followup" };
    const patch = buildCoachNudgeDeliveredConfig(nudge, { deadlineDate: "2024-06-01" }, payload, now);
    expect(patch.deadlineFollowupAskedFor).toBe("2024-06-01");
  });

  it("records nothing for other reasons, or when there is no deadline", () => {
    expect(buildCoachNudgeDeliveredConfig(derivedSignal, { deadlineDate: "2024-06-01" }, payload, now))
      .not.toHaveProperty("deadlineFollowupAskedFor");
    expect(buildCoachNudgeDeliveredConfig({ reason: "deadline_date_passed_followup" }, {}, payload, now))
      .not.toHaveProperty("deadlineFollowupAskedFor");
  });
});
