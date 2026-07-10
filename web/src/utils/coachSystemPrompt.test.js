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
    recentlyCompletedContext: "",
    rescueHandoffContext: "",
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


  it("every mode can include a same-day Rescue Mode handoff summary", () => {
    const ctx = { ...baseCtx(), rescueHandoffContext: 'RECENT RESCUE MODE HANDOFF:\nUsed Rescue Mode from Home/Today earlier today (anxious while stuck on "Write grant draft") and left without resolving it.' };
    ["light", "emotional", "profile_reflection", "compact_task", "full_task"].forEach(mode => {
      const out = buildCoachSystemPrompt(mode, ctx);
      expect(out).toContain("RECENT RESCUE MODE HANDOFF");
      expect(out).toContain("Write grant draft");
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

  it("compact_task mode never denies access to Loci task data and gives the context-issue line instead", () => {
    const out = buildCoachSystemPrompt("compact_task", baseCtx());
    expect(out).not.toContain("no direct access to Loci app data");
    expect(out).not.toContain("I have no access");
    expect(out).toContain("I'm missing the task snapshot for this request — that looks like a Loci context issue.");
  });

  it("full_task, compact_task, emotional, and light modes all carry RECENTLY COMPLETED context when present", () => {
    // classifyContextMode routes completion-celebration phrasing like "I did
    // it" / "small win" to emotional, and bare "done"-style confirmations to
    // light — both need to see a just-completed task too, not only full_task
    // and compact_task (which only cover messages containing task-ish
    // keywords like the literal word "completed").
    const ctx = { ...baseCtx(), recentlyCompletedContext: "RECENTLY COMPLETED (last 24h): 'Pay 308: Euros Water TAX'." };

    for (const mode of ["full_task", "compact_task", "emotional", "light"]) {
      const out = buildCoachSystemPrompt(mode, ctx);
      expect(out).toContain("RECENTLY COMPLETED (last 24h): 'Pay 308: Euros Water TAX'.");
    }
  });

  it("compact_task mode explains that a task in RECENTLY COMPLETED is relevant context, not something to treat as missing", () => {
    const out = buildCoachSystemPrompt("compact_task", baseCtx());
    expect(out).toContain("that is relevant context — acknowledge it directly, do not treat it as \"missing.\"");
  });

  it("light mode's missing-task-snapshot refusal carves out RECENTLY COMPLETED confirmations, same as it already does for date/time questions", () => {
    const out = buildCoachSystemPrompt("light", baseCtx());
    expect(out).toContain("It also does NOT apply to confirming or acknowledging a task named in RECENTLY COMPLETED below");
  });

  it("full_task, compact_task, emotional, and light modes omit the dynamic RECENTLY COMPLETED block when nothing was recently completed", () => {
    for (const mode of ["full_task", "compact_task", "emotional", "light"]) {
      const out = buildCoachSystemPrompt(mode, baseCtx());
      expect(out).not.toContain("RECENTLY COMPLETED (last 24h):");
    }
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

  it("full_task mode carries the PRIORITY QUESTIONS framework", () => {
    const out = buildCoachSystemPrompt("full_task", baseCtx());
    expect(out).toContain("PRIORITY QUESTIONS");
    expect(out).toContain("Give at most 3 priorities");
    expect(out).toContain('urgent = overdue or near the key deadline; important = [P1]/[P2]');
  });

  it("PRIORITY QUESTIONS reinforces answering from the visible snapshot only", () => {
    const out = buildCoachSystemPrompt("full_task", baseCtx());
    expect(out).toContain("These are the visible tasks only");
  });

  it("reduced modes do not carry the PRIORITY QUESTIONS framework (no full task context to apply it to)", () => {
    ["light", "emotional", "profile_reflection", "compact_task"].forEach(mode => {
      const out = buildCoachSystemPrompt(mode, baseCtx());
      expect(out).not.toContain("PRIORITY QUESTIONS");
    });
  });

  it("full_task mode includes body-double instructions with honesty about not watching the user", () => {
    const out = buildCoachSystemPrompt("full_task", baseCtx());
    expect(out).toContain("BODY-DOUBLE SESSIONS");
    expect(out).toContain("not actually watching");
  });

  it("light, emotional, profile_reflection, and compact_task modes omit body-double instructions", () => {
    ["light", "emotional", "profile_reflection", "compact_task"].forEach(mode => {
      const out = buildCoachSystemPrompt(mode, baseCtx());
      expect(out).not.toContain("BODY-DOUBLE SESSIONS");
    });
  });

  describe("memory-writing rules (PR1: fix durable Coach memory gaps)", () => {
    it("full_task, emotional, profile_reflection, and compact_task modes can write memory when enabled", () => {
      ["full_task", "emotional", "profile_reflection", "compact_task"].forEach(mode => {
        const out = buildCoachSystemPrompt(mode, { ...baseCtx(), memorySectionEnabled: true });
        expect(out).toContain("MEMORY — building a picture of");
        expect(out).toContain("[[REMEMBER:");
        expect(out).toContain("[[NOTE:");
      });
    });

    it("light mode never carries memory-writing rules, even when memory is enabled", () => {
      const out = buildCoachSystemPrompt("light", { ...baseCtx(), memorySectionEnabled: true });
      expect(out).not.toContain("MEMORY — building a picture of");
      expect(out).not.toContain("[[REMEMBER:");
    });

    it("no mode carries memory-writing rules when memorySectionEnabled is false", () => {
      ["light", "full_task", "emotional", "profile_reflection", "compact_task"].forEach(mode => {
        const out = buildCoachSystemPrompt(mode, { ...baseCtx(), memorySectionEnabled: false });
        expect(out).not.toContain("MEMORY — building a picture of");
      });
    });

    it("all four memory-capable modes carry the conservative rule against storing passing feelings (loopcheck finding, PR #346)", () => {
      // Folded directly into buildMemoryWritingRules() rather than a
      // separate per-mode addendum, specifically so full_task and
      // compact_task get it too: classifyContextMode() routes plenty of
      // genuinely emotional messages there before ever reaching the
      // emotional/profile_reflection checks — e.g. "I feel overwhelmed,
      // what should I do?" escapes to full_task via the TASK_ASK_RE/
      // isBroadQuery check at line 669, and "I feel like such a failure,
      // mark this done" can route to compact_task via EXPLICIT_ACTION_RE
      // taking priority at line 647. A per-mode addendum that only covered
      // emotional/profile_reflection would miss both of these.
      ["full_task", "emotional", "profile_reflection", "compact_task"].forEach(mode => {
        const out = buildCoachSystemPrompt(mode, { ...baseCtx(), memorySectionEnabled: true });
        expect(out).toContain("recurring pattern, a stable preference, an explicit \"remember this\" request, or a durable fact");
        expect(out).toContain("never for a passing feeling in the moment");
      });
    });
  });

  describe("session summary (PR2: rolling summary for the raw-history window)", () => {
    const ALL_MODES = ["light", "full_task", "emotional", "profile_reflection", "compact_task"];

    it("every mode, including light, surfaces an existing session summary when present", () => {
      const ctx = { ...baseCtx(), sessionSummaryContext: "CONVERSATION SO FAR:\nCurrent objective: ship PR2." };
      ALL_MODES.forEach(mode => {
        const out = buildCoachSystemPrompt(mode, ctx);
        expect(out).toContain("Current objective: ship PR2.");
      });
    });

    it("no mode fabricates a session summary when none exists", () => {
      ALL_MODES.forEach(mode => {
        const out = buildCoachSystemPrompt(mode, baseCtx());
        expect(out).not.toContain("CONVERSATION SO FAR");
      });
    });

    it("every mode, including light, can receive the pending-summarization trigger and its writing instruction", () => {
      // Light mode must be able to update the summary even on a plain
      // "hi"/no-reference turn — its raw window is only 3 messages, so it
      // reaches the summarization boundary sooner than other modes, not
      // less often.
      const ctx = { ...baseCtx(), pendingSummaryContext: "OLDER MESSAGES LEAVING THE ACTIVE WINDOW (fold these into your summary now — after this turn they will not be shown again):\nUser: hi\nCoach: hey" };
      ALL_MODES.forEach(mode => {
        const out = buildCoachSystemPrompt(mode, ctx);
        expect(out).toContain("OLDER MESSAGES LEAVING THE ACTIVE WINDOW");
        expect(out).toContain("[[SESSION_SUMMARY:");
        expect(out).toContain("REPLACES the old summary, it does not append to it");
      });
    });

    it("no mode carries the writing instruction when no update is pending", () => {
      ALL_MODES.forEach(mode => {
        const out = buildCoachSystemPrompt(mode, baseCtx());
        expect(out).not.toContain("[[SESSION_SUMMARY:");
      });
    });

    it("profile_reflection explicitly distinguishes the session summary from durable memory, so a 'what do you know about me' answer can't blur this-conversation-only context into pinned facts/recent notes (Codex review finding, PR #347)", () => {
      const out = buildCoachSystemPrompt("profile_reflection", baseCtx());
      expect(out).toContain("NOT durable memory");
      expect(out).toMatch(/summary of THIS chat session only/);
    });
  });
});
