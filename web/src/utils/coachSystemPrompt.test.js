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
    pendingCheckinContext: "",
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

  it("full_task mode gives honest, conditional answers for check-in/reminder questions", () => {
    const out = buildCoachSystemPrompt("full_task", baseCtx());
    expect(out).toContain("HONESTY ABOUT CHECK-INS");
    expect(out).toContain('I set a Coach check-in, not a task reminder attached to a task.');
    expect(out).toContain("I haven't set a reminder yet. I can set a Coach check-in here if you tell me when.");
    expect(out).not.toContain('always answer "I set a Coach check-in"');
  });

  it("emotional mode's check-in line is honest about what happens", () => {
    const out = buildCoachSystemPrompt("emotional", baseCtx());
    expect(out).toContain('call it a check-in here in the app — never "reminder," "notification," or "alert."');
  });

  it("every mode surfaces the actual pending check-in state when present, so honesty answers aren't guesswork", () => {
    const ctx = { ...baseCtx(), pendingCheckinContext: 'CURRENT CHECK-IN: A Coach check-in is pending, firing in about 10 minute(s), about "Write report".' };
    ["light", "emotional", "profile_reflection", "compact_task", "full_task"].forEach(mode => {
      const out = buildCoachSystemPrompt(mode, ctx);
      expect(out).toContain('CURRENT CHECK-IN: A Coach check-in is pending, firing in about 10 minute(s), about "Write report".');
    });
  });

  it("no mode fabricates a pending check-in when none exists", () => {
    ["light", "emotional", "profile_reflection", "compact_task", "full_task"].forEach(mode => {
      const out = buildCoachSystemPrompt(mode, baseCtx());
      expect(out).not.toContain("CURRENT CHECK-IN:");
    });
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

  it("light mode never denies access to Loci task data and gives the context-issue line instead", () => {
    const out = buildCoachSystemPrompt("light", baseCtx());
    expect(out).not.toContain("no direct access to Loci app data");
    expect(out).not.toContain("I have no access");
    expect(out).toContain("I'm missing the task snapshot for this request — that looks like a Loci context issue.");
  });

  it("light mode's missing-snapshot guard explicitly excludes plain date/day/time questions", () => {
    const out = buildCoachSystemPrompt("light", baseCtx());
    expect(out).toContain('This does NOT apply to plain date/day/time questions');
    expect(out).toContain("answer those directly using the Current Time below");
  });

  it("full_task and compact_task modes instruct the Coach not to silently drop extra tasks", () => {
    const fullOut = buildCoachSystemPrompt("full_task", baseCtx());
    expect(fullOut).toContain("MULTIPLE TASKS RULE");

    const compactOut = buildCoachSystemPrompt("compact_task", baseCtx());
    expect(compactOut).toContain("MULTIPLE TASKS RULE");
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

  it("PR277 - compact_task mode carries FORMAT RULES for numbered steps and date/time answers", () => {
    const out = buildCoachSystemPrompt("compact_task", baseCtx());
    expect(out).toContain("FORMAT RULES");
    expect(out).toContain("the visible reply is exactly N numbered lines");
    expect(out).toContain("Never stop mid-sentence");
    expect(out).toContain("give the first 5 complete steps and ask if");
    expect(out).toContain("answer in exactly one complete sentence using the Current Time below");
  });

  it("PR277 follow-up - compact_task FORMAT RULES do not block COACH ACTIONS tags on numbered-step replies", () => {
    const out = buildCoachSystemPrompt("compact_task", baseCtx());
    expect(out).toContain("these tags are stripped automatically and are not part of the \"nothing else\" reply text");
  });

  it("PR277 follow-up - compact_task FORMAT RULES give explicit precedence for combined date/time + numbered-step asks", () => {
    const out = buildCoachSystemPrompt("compact_task", baseCtx());
    expect(out).toContain("answer the date/time in one complete sentence first, then give the numbered list");
  });
});
