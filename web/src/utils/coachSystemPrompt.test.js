import { describe, expect, it } from "vitest";
import { buildCoachSystemPrompt, buildLociVoiceCapsule } from "./coachSystemPrompt";

function baseCtx() {
  return {
    lociCoreInstruction: "CORE INSTRUCTION",
    mentorName: "Coach",
    firstName: "Rohan",
    userName: "Rohan Das",
    challengeLabel: "Action over Perfectionism",
    profileContext: "",
    memoryContext: "",
    memorySectionEnabled: true,
    personaInstruction: "PERSONA",
    taskContext: "- Task A\n- Task B",
    focusSessionContext: "",
    nowFocusContext: "",
    dayMapContext: "",
    remindersContext: "",
    anchorContext: "",
    checkinContext: "",
    deadlineContext: "",
    brainDumpContext: "",
    velocityContext: "",
    lowEnergyContext: "",
    recentlyParkedContext: "",
    isEarlyConversation: false,
    nowLabel: "Tue, Jun 17, 10:00 AM",
    timeOfDay: "morning",
    todayActiveCount: 3,
    streakCount: 5,
    profileBlock: "",
  };
}

describe("buildCoachSystemPrompt", () => {
  it("light mode omits the full task universe and action-tag machinery", () => {
    const out = buildCoachSystemPrompt("light", baseCtx());
    expect(out).not.toContain("CURRENT CAPPED TASK CONTEXT");
    expect(out).not.toContain("COACH ACTIONS:");
  });

  it("light and profile_reflection modes contain the compact session line", () => {
    const ctx = baseCtx();
    const expectedSessionLine = `Current Time: ${ctx.nowLabel} (${ctx.timeOfDay})`;
    
    const lightPrompt = buildCoachSystemPrompt("light", ctx);
    expect(lightPrompt).toContain(expectedSessionLine);
    
    const profileReflectionPrompt = buildCoachSystemPrompt("profile_reflection", ctx);
    expect(profileReflectionPrompt).toContain(expectedSessionLine);
  });

  it("emotional mode omits the full task universe but keeps support-mode safety content", () => {
    const out = buildCoachSystemPrompt("emotional", baseCtx());
    expect(out).not.toContain("CURRENT CAPPED TASK CONTEXT");
    expect(out).toContain("SUPPORT MODE");
  });

  it("profile_reflection mode omits the full task universe", () => {
    const out = buildCoachSystemPrompt("profile_reflection", baseCtx());
    expect(out).not.toContain("CURRENT CAPPED TASK CONTEXT");
  });

  it("full_task mode keeps the full task universe and action-tag machinery", () => {
    const out = buildCoachSystemPrompt("full_task", baseCtx());
    expect(out).toContain("CURRENT CAPPED TASK CONTEXT");
    expect(out).toContain("COACH ACTIONS:");
  });

  it("light, emotional, and profile_reflection each carry the Loci voice capsule", () => {
    const capsule = buildLociVoiceCapsule("Rohan");
    ["light", "emotional", "profile_reflection"].forEach(mode => {
      const out = buildCoachSystemPrompt(mode, baseCtx());
      expect(out).toContain("VOICE:");
      expect(out).toContain("sharp execution coach");
      expect(out).toContain(capsule);
    });
  });

  it("full_task mode is dramatically larger than the reduced modes for the same context", () => {
    const ctx = baseCtx();
    const fullLen = buildCoachSystemPrompt("full_task", ctx).length;
    const lightLen = buildCoachSystemPrompt("light", ctx).length;
    expect(lightLen).toBeLessThan(fullLen / 2);
  });

  it("falls back to light for an unrecognized mode", () => {
    const out = buildCoachSystemPrompt("not_a_real_mode", baseCtx());
    expect(out).toEqual(buildCoachSystemPrompt("light", baseCtx()));
  });

  it("compact_task mode conditionally carries the CURRENT NOW FOCUS line", () => {
    // Case 1: focus task exists
    const ctxWithFocus = { ...baseCtx(), currentFocusTitle: "My Focus Task" };
    const outWithFocus = buildCoachSystemPrompt("compact_task", ctxWithFocus);
    expect(outWithFocus).toContain('CURRENT NOW FOCUS: "My Focus Task"');

    // Case 2: no focus task exists
    const ctxNoFocus = { ...baseCtx(), currentFocusTitle: null };
    const outNoFocus = buildCoachSystemPrompt("compact_task", ctxNoFocus);
    expect(outNoFocus).not.toContain("CURRENT NOW FOCUS");
  });
});
