import { describe, expect, it } from "vitest";
import { classifyContextMode, needsConversationContext, trimHistoryForDb, trimHistoryForLLM } from "./coachContextMode";

describe("classifyContextMode", () => {
  it("defaults casual/light messages to light", () => {
    expect(classifyContextMode("Hi")).toBe("light");
    expect(classifyContextMode("Which day is it?")).toBe("light");
    expect(classifyContextMode("thanks")).toBe("light");
    expect(classifyContextMode("okay")).toBe("light");
    expect(classifyContextMode("are you there")).toBe("light");
  });

  it("routes profile/memory questions to profile_reflection", () => {
    expect(classifyContextMode("What do you know about me?")).toBe("profile_reflection");
    expect(classifyContextMode("what do you remember about me")).toBe("profile_reflection");
    expect(classifyContextMode("tell me my pattern")).toBe("profile_reflection");
    expect(classifyContextMode("what have you learned about me")).toBe("profile_reflection");
    expect(classifyContextMode("why am I like this")).toBe("profile_reflection");
    expect(classifyContextMode("tell me about myself")).toBe("profile_reflection");
  });

  it("routes planning/task language to full_task", () => {
    expect(classifyContextMode("Help me plan today")).toBe("full_task");
    expect(classifyContextMode("What should I do now?")).toBe("full_task");
    expect(classifyContextMode("what are my tasks")).toBe("full_task");
    expect(classifyContextMode("help me prioritize")).toBe("full_task");
    expect(classifyContextMode("what's my deadline")).toBe("full_task");
    expect(classifyContextMode("set now focus")).toBe("full_task");
  });

  it("PR276 follow-up - routes priority/check phrasing to full_task, not light", () => {
    expect(classifyContextMode("what are my priorities")).toBe("full_task");
    expect(classifyContextMode("tell me my priorities")).toBe("full_task");
    expect(classifyContextMode("show me my priorities")).toBe("full_task");
    expect(classifyContextMode("what should be my priority")).toBe("full_task");
    expect(classifyContextMode("which priority should I focus on")).toBe("full_task");
    expect(classifyContextMode("cant you check?")).toBe("full_task");
    expect(classifyContextMode("can't you check?")).toBe("full_task");
    expect(classifyContextMode("check my week")).toBe("full_task");
  });

  it("routes action/mutation phrases to full_task", () => {
    expect(classifyContextMode("I finished the report")).toBe("full_task");
    expect(classifyContextMode("start timer for writing")).toBe("full_task");
    expect(classifyContextMode("park this")).toBe("full_task");
    expect(classifyContextMode("delete this task")).toBe("full_task");
    expect(classifyContextMode("mark this done")).toBe("full_task");
    expect(classifyContextMode("create a task for groceries")).toBe("full_task");
    expect(classifyContextMode("capture this")).toBe("full_task");
  });

  it("routes check-in/reminder phrasing paired with a time signal to full_task, not light", () => {
    expect(classifyContextMode("check in with me in 20 minutes")).toBe("full_task");
    expect(classifyContextMode("remind me in 30 minutes")).toBe("full_task");
    expect(classifyContextMode("circle back at 11")).toBe("full_task");
    expect(classifyContextMode("remind me later")).toBe("full_task");
    expect(classifyContextMode("check in later")).toBe("full_task");
    expect(classifyContextMode("ping me tomorrow morning")).toBe("full_task");
  });

  it("routes standalone time signals to full_task even without a reminder verb", () => {
    expect(classifyContextMode("in 10 minutes")).toBe("full_task");
    expect(classifyContextMode("let's talk tomorrow morning")).toBe("full_task");
  });

  it("does NOT route standalone casual 'later' to full_task", () => {
    expect(classifyContextMode("talk later")).toBe("light");
    expect(classifyContextMode("okay later")).toBe("light");
  });

  it("routes support/emotional language to emotional", () => {
    expect(classifyContextMode("Comfort me")).toBe("emotional");
    expect(classifyContextMode("I feel terrible")).toBe("emotional");
    expect(classifyContextMode("I'm overwhelmed")).toBe("emotional");
    expect(classifyContextMode("I'm stuck")).toBe("emotional");
    expect(classifyContextMode("I did it")).toBe("emotional");
    expect(classifyContextMode("I feel bad")).toBe("emotional");
    expect(classifyContextMode("I feel sad")).toBe("emotional");
    expect(classifyContextMode("I feel low")).toBe("emotional");
    expect(classifyContextMode("I feel hopeless")).toBe("emotional");
  });

  it("always overrides to emotional for crisis/panic signals, even paired with casual or task words", () => {
    const crisisPhrases = [
      "I want to die",
      "kill myself",
      "I don't want to exist",
      "I can't do this anymore",
      "I might hurt myself",
      "I feel unsafe",
      "I'm panicking",
      "I can't breathe",
      "I have chest pain",
      "my heart is racing",
    ];
    crisisPhrases.forEach(phrase => {
      expect(classifyContextMode(phrase)).toBe("emotional");
      expect(classifyContextMode(`Hi, ${phrase}, also help me plan today`)).toBe("emotional");
    });
  });

  it("handles empty/non-string input gracefully", () => {
    expect(classifyContextMode("")).toBe("light");
    expect(classifyContextMode(undefined)).toBe("light");
    expect(classifyContextMode(null)).toBe("light");
  });

  describe("PR #269 Fixes & Refinements", () => {
    it("Must fix 2 — Refine classifier false positives (add)", () => {
      expect(classifyContextMode("Can you add more detail?")).toBe("light");
      expect(classifyContextMode("That doesn't add up")).toBe("light");
      expect(classifyContextMode("Add buy milk to my list")).toBe("full_task");
      expect(classifyContextMode("Add this task")).toBe("full_task");
    });

    it("Must fix 3 & Amendment 1 — Refine classifier false negatives (task context & due)", () => {
      expect(classifyContextMode("What did I park yesterday?")).toBe("full_task");
      expect(classifyContextMode("Which task is overdue?")).toBe("full_task");
      expect(classifyContextMode("Is anything due today?")).toBe("full_task");
      expect(classifyContextMode("Which task should I start?")).toBe("full_task");
      expect(classifyContextMode("I'm ready to tackle my tasks")).toBe("full_task");
      expect(classifyContextMode("Show me my tasks")).toBe("full_task");
      expect(classifyContextMode("What's on my list?")).toBe("full_task");
      expect(classifyContextMode("What's due?")).toBe("full_task");
      expect(classifyContextMode("What should I work on?")).toBe("full_task");

      // Amendment 1: "due to" should not trigger full_task
      expect(classifyContextMode("I'm tired due to poor sleep")).not.toBe("full_task");
    });

    it("Must fix 5 — Emotional + explicit task action routes to full_task", () => {
      expect(classifyContextMode("I feel terrible and I need to park my coding task")).toBe("full_task");
      expect(classifyContextMode("I'm overwhelmed, add buy milk to my list")).toBe("full_task");
      expect(classifyContextMode("I feel bad but mark X done")).toBe("full_task");
      expect(classifyContextMode("I'm stuck, start timer for X")).toBe("full_task");
    });

    it("Must fix 4 — needsConversationContext identifies follow-up phrases", () => {
      expect(needsConversationContext("How do I do that?")).toBe(true);
      expect(needsConversationContext("Tell me more")).toBe(true);
      expect(needsConversationContext("Which one?")).toBe(true);
      expect(needsConversationContext("What was the first option?")).toBe(true);
      expect(needsConversationContext("Why?")).toBe(true);
      expect(needsConversationContext("Can you explain that?")).toBe(true);
      
      expect(needsConversationContext("Hi")).toBe(false);
      expect(needsConversationContext("What should I do?")).toBe(false);
    });

    it("Amendment 3 — trimHistoryForDb and trimHistoryForLLM helpers preserve/trim history correctly", () => {
      // Create 15 existing messages
      const history = Array.from({ length: 15 }, (_, i) => ({
        text: `Message ${i + 1}`,
        isUser: i % 2 === 0
      }));

      // 1. User message is "Hi" (light mode, not reference)
      const withUserHi = trimHistoryForDb(history, "Hi", 20);
      expect(withUserHi.length).toBe(16);
      expect(withUserHi[withUserHi.length - 1]).toEqual({ text: "Hi", isUser: true });

      const llmHi = trimHistoryForLLM(withUserHi, "light", false);
      expect(llmHi.length).toBe(3); // capped to 3 for light non-references
      expect(llmHi[llmHi.length - 1]).toEqual({ text: "Hi", isUser: true });

      // 2. User message is "Tell me more" (light mode, but needs context)
      const withUserMore = trimHistoryForDb(history, "Tell me more", 20);
      expect(withUserMore.length).toBe(16);

      const llmMore = trimHistoryForLLM(withUserMore, "light", true);
      expect(llmMore.length).toBe(10); // capped to 10 because it needs context
      expect(llmMore[llmMore.length - 1]).toEqual({ text: "Tell me more", isUser: true });

      // 3. Database cap enforcement
      const largeHistory = Array.from({ length: 25 }, (_, i) => ({
        text: `Msg ${i + 1}`,
        isUser: i % 2 === 0
      }));
      const withUserCapped = trimHistoryForDb(largeHistory, "Hi", 20);
      expect(withUserCapped.length).toBe(20);
      expect(withUserCapped[0].text).toBe("Msg 7"); // Wiped older messages past 20
      expect(withUserCapped[19].text).toBe("Hi");
    });

    it("PR #272 Codex Fix 4 & 5 - routes broad task/deadline queries and named completions properly", () => {
      // 1. Named completions (positive cases)
      expect(classifyContextMode("I'm done with the report")).toBe("full_task");
      expect(classifyContextMode("done with CV update")).toBe("full_task");
      expect(classifyContextMode("finished the application")).toBe("full_task");
      expect(classifyContextMode("finished the application", { lastFullTaskTime: Date.now(), hasLastPlan: true })).toBe("full_task");

      // Curly apostrophe support for named completions
      expect(classifyContextMode("I’m done with CV update")).toBe("full_task");

      // 2. Emotional/Safety exclusions (negative cases)
      expect(classifyContextMode("I'm done with life")).toBe("emotional");
      expect(classifyContextMode("done with life")).toBe("emotional");
      expect(classifyContextMode("I'm done with everything")).toBe("emotional");
      expect(classifyContextMode("done with everything")).toBe("emotional");

      // 3. Broad task/deadline queries bypass compact pacing window
      const broadQueries = [
        "what are my tasks?",
        "what's due?",
        "what’s due?", // curly apostrophe
        "what is due",
        "anything due?",
        "due date",
        "what's my deadline",
        "what’s my deadline", // curly apostrophe
        "what is my deadline",
        "show my tasks",
        "what do I have today?",
        "what tasks do I have?",
        "list my tasks",
        "my task list",
        "show my list",
        "what's on my list",
        "what’s on my list", // curly apostrophe
        "what do I need to do today"
      ];
      broadQueries.forEach(query => {
        expect(classifyContextMode(query, { lastFullTaskTime: Date.now(), hasLastPlan: true })).toBe("full_task");
      });
    });

    it("PR #272 New Codex Fixes - named mutations, fresh scans, and check-ins pacing routing", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };

      // 1. Named mutations vs Targeted mutations
      expect(classifyContextMode("mark Budget review done", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("start a timer for Write report", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("park CV update", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("mark it done", pacedOpts)).toBe("compact_task");
      expect(classifyContextMode("start current focus", pacedOpts)).toBe("compact_task");
      expect(classifyContextMode("start timer on this", pacedOpts)).toBe("compact_task");

      // 2. Standalone fresh-scan requests
      expect(classifyContextMode("fresh scan")).toBe("full_task");
      expect(classifyContextMode("full scan")).toBe("full_task");
      expect(classifyContextMode("re-plan")).toBe("full_task");
      expect(classifyContextMode("look at everything again")).toBe("full_task");
      expect(classifyContextMode("fresh scan", pacedOpts)).toBe("full_task");

      // 3. Check-ins bypass compact mode
      expect(classifyContextMode("remind me in 30 minutes", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("check in tomorrow morning", pacedOpts)).toBe("full_task");
    });

    it("PR276 - routes 'check today/week focus/horizon' and 'focus on' phrasing to full_task, not light", () => {
      expect(classifyContextMode("Check today's focus and tell me which one shall I focus")).toBe("full_task");
      expect(classifyContextMode("Check this week horizon")).toBe("full_task");
      expect(classifyContextMode("What should I focus on")).toBe("full_task");

      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("What should I focus on", pacedOpts)).toBe("compact_task");
    });

    it("PR276 - widens compact follow-up detection for '10-min version' and 'turn that into N steps'", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("give me the 10-min version", pacedOpts)).toBe("compact_task");
      expect(classifyContextMode("turn that into 3 steps", pacedOpts)).toBe("compact_task");
      expect(classifyContextMode("turn this into concrete steps", pacedOpts)).toBe("compact_task");
    });

    it("PR277 - routes natural category/horizon priority asks without requiring 'task' wording to full_task", () => {
      expect(classifyContextMode("What are my career priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my work priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my health priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my personal priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my health and work priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my health task and work task priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my this month priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my month priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my quarter priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my 6 month priorities?")).toBe("full_task");
      expect(classifyContextMode("What should I focus on this month?")).toBe("full_task");
      expect(classifyContextMode("Which work task should I do first?")).toBe("full_task");
      expect(classifyContextMode("Which career task should I do first?")).toBe("full_task");
      expect(classifyContextMode("Which health task should I do first?")).toBe("full_task");
      expect(classifyContextMode("What are my this month’s priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my health/work priorities?")).toBe("full_task");
      expect(classifyContextMode("What are my health & work priorities?")).toBe("full_task");
      expect(classifyContextMode("Tell me my health priorities")).toBe("full_task");
      expect(classifyContextMode("Show me my work priorities")).toBe("full_task");

      // Possessive references to someone else's priorities must NOT be treated as a Loci task request
      expect(classifyContextMode("What are my boss's priorities?")).not.toBe("full_task");
      expect(classifyContextMode("What are my partner's priorities?")).not.toBe("full_task");
    });

    it("PR #272 Codex Fix - routes distressed task asks to full_task", () => {
      // Mixed distress + task planning asks route to full_task
      expect(classifyContextMode("I’m overwhelmed, what should I do?")).toBe("full_task");
      expect(classifyContextMode("I’m stuck, what should I work on?")).toBe("full_task");
      expect(classifyContextMode("I feel scattered, help me choose a task")).toBe("full_task");
      expect(classifyContextMode("I feel low and behind, help me pick one thing")).toBe("full_task");

      // Pure emotional distress still routes to emotional
      expect(classifyContextMode("I feel low")).toBe("emotional");
      expect(classifyContextMode("I'm overwhelmed")).toBe("emotional");

      // Crisis/safety phrases still route to emotional with highest priority
      expect(classifyContextMode("I want to die, what should I do?")).toBe("emotional");
      expect(classifyContextMode("I might hurt myself, help me pick a task")).toBe("emotional");
    });
  });
});
