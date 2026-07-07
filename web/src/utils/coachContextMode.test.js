import { describe, expect, it } from "vitest";
import { classifyContextMode, needsConversationContext, trimHistoryForDb, trimHistoryForLLM, detectRequestedCategories } from "./coachContextMode";

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

  it("PR335 follow-up - routes urgent/pressing/important phrasing to full_task, not light", () => {
    expect(classifyContextMode("so like whats actually urgent for me today")).toBe("full_task");
    expect(classifyContextMode("what is actually urgent today")).toBe("full_task");
    expect(classifyContextMode("whats urgent")).toBe("full_task");
    expect(classifyContextMode("what is pressing today")).toBe("full_task");
    expect(classifyContextMode("whats important today")).toBe("full_task");
    expect(classifyContextMode("anything urgent")).toBe("full_task");
    expect(classifyContextMode("anything pressing today")).toBe("full_task");
    // Non-question mentions of the same words must not be swept in.
    expect(classifyContextMode("this is really important to me")).toBe("light");
    expect(classifyContextMode("that meeting felt urgent and stressful")).toBe("light");
  });

  it("routes task-list/brain-dump synonyms to full_task, not light", () => {
    expect(classifyContextMode("what's on my plate today")).toBe("full_task");
    expect(classifyContextMode("what's on my plate")).toBe("full_task");
    expect(classifyContextMode("what's next on my plate")).toBe("full_task");
    expect(classifyContextMode("what's in my brain dump")).toBe("full_task");
    expect(classifyContextMode("check my brain dump")).toBe("full_task");
  });

  it("tolerates filler words in 'what should I do' phrasing", () => {
    expect(classifyContextMode("ok what should i actually do now")).toBe("full_task");
    expect(classifyContextMode("what should i really work on")).toBe("full_task");
    expect(classifyContextMode("what do i even do")).toBe("full_task");
    expect(classifyContextMode("what to do right now")).toBe("full_task");
  });

  it("recognizes 'remind me to X' (no time signal) as an ADD_TASK request, matching coachActions' own intent pattern", () => {
    expect(classifyContextMode("remind me to book a dentist appointment and also to renew my passport")).toBe("full_task");
    expect(classifyContextMode("don't forget to call the plumber")).toBe("full_task");
    // A genuine check-in request (with a time signal) still routes to full_task too.
    expect(classifyContextMode("remind me at 5pm to look at my week")).toBe("full_task");
  });

  it("recognizes 'switch/set/swap my focus to X' as a SET_NOW_FOCUS request, matching coachActions' own intent pattern", () => {
    expect(classifyContextMode("switch my focus to writing the quarterly tax report")).toBe("full_task");
    expect(classifyContextMode("set my focus to the report")).toBe("full_task");
    expect(classifyContextMode("swap my focus to the report")).toBe("full_task");
    expect(classifyContextMode("make the report my focus")).toBe("full_task");
  });

  it("routes shame/failure language to emotional even with intensifiers or filler words", () => {
    expect(classifyContextMode("i feel like a failure today, i wasted the whole day")).toBe("emotional");
    expect(classifyContextMode("i feel like such a failure right now")).toBe("emotional");
    expect(classifyContextMode("i feel like a total failure today")).toBe("emotional");
    expect(classifyContextMode("i wasted the entire day")).toBe("emotional");
    expect(classifyContextMode("i've wasted the whole freaking day")).toBe("emotional");
    // The "failure" match must require personal-shame framing ("a failure"),
    // not just the word appearing near "feel like" — otherwise ordinary work
    // language false-positives into the emotional/safety prompt.
    expect(classifyContextMode("I feel like the failure rate on our tests is too high, can you add a task to investigate?")).not.toBe("emotional");
  });

  it("routes 'idk where to start' to emotional, matching its unabbreviated form (Codex review finding)", () => {
    // idk normalizes to "i dont know" (not "i do not know") specifically so
    // it still matches EMOTIONAL_RE's existing don['']?t know where to start
    // clause — "idk where to start" is a very common real-world way of
    // saying the exact same thing.
    expect(classifyContextMode("idk where to start")).toBe("emotional");
    expect(classifyContextMode("I dont know where to start")).toBe("emotional");
  });

  it("escapes distressed broad-task-query phrasings to full_task, matching TASK_ASK_RE's existing behavior (Codex review finding)", () => {
    // "I'm overwhelmed, what should I do" already escapes to full_task via
    // TASK_ASK_RE — the newer broad-task synonyms ("what do I even do",
    // "what's on my plate") must get the same treatment instead of dropping
    // to "emotional" with zero task context.
    expect(classifyContextMode("I'm overwhelmed, what do I even do?")).toBe("full_task");
    expect(classifyContextMode("I'm stuck, what's on my plate?")).toBe("full_task");
  });

  it("normalizes common texting shorthand before classification (real-world typos/broken English)", () => {
    // These are the kinds of messy, real-world phrasings actual users type —
    // dropped apostrophes, phonetic typos, and single-letter/number shorthand.
    expect(classifyContextMode("wut shud i focus on rn")).toBe("full_task");
    expect(classifyContextMode("wat should i do 2day")).toBe("full_task");
    expect(classifyContextMode("wat tasks do i have 2day")).toBe("full_task");
    expect(classifyContextMode("gimme my todo list")).toBe("full_task");
    expect(classifyContextMode("wat r my todos")).toBe("full_task");
    expect(classifyContextMode("im stuck idk what 2 start with")).toBe("emotional");
    expect(classifyContextMode("yo remind me 2 call the plumber")).toBe("full_task");
    // Dropped-apostrophe "im" must still route through all the existing
    // "i(['']m| am) ..." emotional patterns, not just the apostrophe'd form.
    expect(classifyContextMode("im overwhelmed")).toBe("emotional");
    expect(classifyContextMode("im stressed about this")).toBe("emotional");
  });

  it("does not let '2'/'4' shorthand normalization corrupt real clock-time/duration signals", () => {
    // The blind \b2\b->"to" / \b4\b->"for" substitution would otherwise
    // rewrite "in 2 minutes" into "in to minutes", breaking the pre-existing
    // digit-based TIME_SIGNAL_RE/STANDALONE_TIME_RE checks it's supposed to
    // help route correctly — reintroducing the very "falls to light" bug
    // this normalizer exists to fix, just via a different path.
    expect(classifyContextMode("remind me in 2 minutes")).toBe("full_task");
    expect(classifyContextMode("check in with me in 4 minutes")).toBe("full_task");
    expect(classifyContextMode("check in with me at 2 pm")).toBe("full_task");
    expect(classifyContextMode("check in with me at 4pm")).toBe("full_task");
    // Standalone time signal, no reminder verb.
    expect(classifyContextMode("in 2 minutes")).toBe("full_task");
    // Non-time "2"/"4" usage still normalizes as intended.
    expect(classifyContextMode("yo remind me 2 call the plumber")).toBe("full_task");
  });

  it("does not let '2'/'4' shorthand normalization corrupt digit-scoped priority queries (Codex review finding)", () => {
    // BROAD_TASK_QUERY_RE's category-priority branch requires a literal
    // digit before the category word ("2 work priorities") — the shorthand
    // substitution must not eat that digit too.
    expect(classifyContextMode("What are my 2 work priorities?")).toBe("full_task");
    expect(classifyContextMode("What are my 4 month priorities?")).toBe("full_task");
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

    it("routes bare 'today's focus' mentions and 'check my priorities' to full_task, not light", () => {
      // No "check" verb, no "tasks" word — a bare reference to the app's
      // "Today's Focus" section, which previously fell all the way to
      // "light" (zero task data) since it matched neither TASK_RE nor the
      // check-prefixed BROAD_TASK_QUERY_RE alternative.
      expect(classifyContextMode("todays focus i mean")).toBe("full_task");
      expect(classifyContextMode("today's focus?")).toBe("full_task");
      expect(classifyContextMode("show me todays focus")).toBe("full_task");

      // "check" as a leading verb on bare "my priorities" (previously only
      // "what are/tell me/show me my priorities" were recognized).
      expect(classifyContextMode("check my priorities")).toBe("full_task");
      expect(classifyContextMode("what about my priorities")).toBe("full_task");

      // Still must not treat a third party's priorities as a task request.
      expect(classifyContextMode("check my boss's priorities")).not.toBe("full_task");
    });

    it("loopcheck follow-up — routes reordered/bare focus and priority phrasings to full_task, not light", () => {
      expect(classifyContextMode("todays priorities")).toBe("full_task");
      expect(classifyContextMode("today's priorities")).toBe("full_task");
      expect(classifyContextMode("my focus for today")).toBe("full_task");
      expect(classifyContextMode("whats my focus")).toBe("full_task");
      expect(classifyContextMode("what's my focus")).toBe("full_task");
      expect(classifyContextMode("whats my focus today")).toBe("full_task");

      // Still must not treat a third party's focus as a task request.
      expect(classifyContextMode("whats my boss's focus")).not.toBe("full_task");
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

    it("routes body-double requests to full_task even without focus/timer wording", () => {
      expect(classifyContextMode("be my body double for 15 minutes")).toBe("full_task");
      expect(classifyContextMode("can you sit with me while I work on this?")).toBe("full_task");
      expect(classifyContextMode("stay with me, I need to write this report")).toBe("full_task");
      expect(classifyContextMode("can you work alongside me for a bit")).toBe("full_task");
    });

    it("routes low-energy task asks to full_task even on the paced/compact-follow-up path", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("I have low energy, what should I do next?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("I'm exhausted, what should I work on?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("I have low energy, what should I do next?")).toBe("full_task");
    });

    it("routes distress over body-double requests to emotional, not full_task", () => {
      expect(classifyContextMode("I'm overwhelmed, stay with me")).toBe("emotional");
      expect(classifyContextMode("I am so stressed, can you just sit with me, I can't focus on anything")).toBe("emotional");
      expect(classifyContextMode("I feel hopeless, can you be my body double")).toBe("emotional");
    });

    it("routes fear/distress phrasing that overlaps body-double wording to emotional, not full_task", () => {
      expect(classifyContextMode("I'm scared, stay with me")).toBe("emotional");
      expect(classifyContextMode("I am afraid, can you sit with me?")).toBe("emotional");
      expect(classifyContextMode("don't leave me, stay with me")).toBe("emotional");
    });

    it("never compacts body-double requests, even on the paced path with a targeted reference", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("can you sit with me while I work on this?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("stay with me on that task", pacedOpts)).toBe("full_task");
    });

    it("never compacts category/horizon-filtered priority questions, even on the paced path", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("Which work task should I do first?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("Which career task should I do first?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("What should I focus on this month?", pacedOpts)).toBe("full_task");
    });

    it("never compacts 'focus on ... for <category>' phrasing, even on the paced path", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("What should I focus on for work?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("What should I prioritize for my career?", pacedOpts)).toBe("full_task");
    });

    it("never compacts category-scoped task-list asks, even on the paced path (Codex review finding)", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("Show me my work tasks", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("What are my health tasks?", pacedOpts)).toBe("full_task");
    });

    it("never compacts common 'do/start for <category>' or plain 'what <category> tasks' asks, even on the paced path (Codex review finding)", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("What should I do for work?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("Which task should I start for health?", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("What work tasks do I have?", pacedOpts)).toBe("full_task");
    });

    it("never compacts body-double/priority-filter/low-energy phrasing even when it co-occurs with an explicit-mutation targeted reference", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("be my body double for this and start a focus session", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("start a timer for this work task, which work task should I do first", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("I have low energy, start a timer for this", pacedOpts)).toBe("full_task");
    });
  });

  // Found via a 170-message live-testing round (round 3): 94/170 (55%) of
  // natural, real-world phrasings of "what should I do"/"what are my
  // priorities" fell through to "light" mode, meaning the coach never
  // received real task data for them at all — not a wording bug, a data
  // bug. This block covers the highest-value fixes from that round: broader
  // verb coverage, noun-phrase priority synonyms, antonym/negation asks, and
  // common typo/shorthand normalization. Category-word synonyms (job/
  // fitness/wellness/etc.) and action-verb synonyms (wrapped up/knocked out/
  // shelve/etc.) are deliberately left for separate follow-up PRs.
  describe("broader priority/task-ask synonym and antonym coverage (live-testing round 3)", () => {
    it("recognizes additional 'what should I <verb>' synonyms", () => {
      expect(classifyContextMode("what should i tackle first")).toBe("full_task");
      expect(classifyContextMode("what should i knock out")).toBe("full_task");
      expect(classifyContextMode("what should i handle first")).toBe("full_task");
      expect(classifyContextMode("what should i be doing")).toBe("full_task");
      expect(classifyContextMode("which task should i start with")).toBe("full_task");
    });

    it("recognizes noun-phrase priority asks without 'what should I' phrasing", () => {
      expect(classifyContextMode("what's most important right now")).toBe("full_task");
      expect(classifyContextMode("what needs my attention")).toBe("full_task");
      expect(classifyContextMode("what's on deck")).toBe("full_task");
      expect(classifyContextMode("what's pending")).toBe("full_task");
      expect(classifyContextMode("what's my top priority")).toBe("full_task");
      expect(classifyContextMode("what's my main focus")).toBe("full_task");
      expect(classifyContextMode("what deserves my attention")).toBe("full_task");
      expect(classifyContextMode("what's on my radar")).toBe("full_task");
      expect(classifyContextMode("what's the biggest priority")).toBe("full_task");
      expect(classifyContextMode("give me the game plan")).toBe("full_task");
      expect(classifyContextMode("give me my priorities")).toBe("full_task");
      expect(classifyContextMode("long term priorities")).toBe("full_task");
      expect(classifyContextMode("short term priorities")).toBe("full_task");
      expect(classifyContextMode("immediate priorities")).toBe("full_task");
      expect(classifyContextMode("this weeks focus")).toBe("full_task");
      expect(classifyContextMode("this months focus")).toBe("full_task");
      expect(classifyContextMode("priorities for the quarter")).toBe("full_task");
      expect(classifyContextMode("what's the smart move")).toBe("full_task");
      expect(classifyContextMode("what's my north star")).toBe("full_task");
      expect(classifyContextMode("point me in the right direction")).toBe("full_task");
      expect(classifyContextMode("steer me toward something useful")).toBe("full_task");
      expect(classifyContextMode("orient me for the day")).toBe("full_task");
      expect(classifyContextMode("what's the one thing i should nail today")).toBe("full_task");
    });

    it("recognizes the same noun-phrase asks with uncontracted 'what is'", () => {
      expect(classifyContextMode("what is my top priority")).toBe("full_task");
      expect(classifyContextMode("what is on my plate")).toBe("full_task");
    });

    it("recognizes antonym/negation priority asks", () => {
      expect(classifyContextMode("what should i NOT do today")).toBe("full_task");
      expect(classifyContextMode("what's not important")).toBe("full_task");
      expect(classifyContextMode("what can wait")).toBe("full_task");
      expect(classifyContextMode("what's the least important thing")).toBe("full_task");
      expect(classifyContextMode("what can i skip today")).toBe("full_task");
      expect(classifyContextMode("what's low priority")).toBe("full_task");
      expect(classifyContextMode("what don't i need to worry about")).toBe("full_task");
      expect(classifyContextMode("what's not urgent")).toBe("full_task");
      expect(classifyContextMode("what can i ignore for now")).toBe("full_task");
      expect(classifyContextMode("what's optional today")).toBe("full_task");
      expect(classifyContextMode("what has the lowest priority")).toBe("full_task");
      expect(classifyContextMode("what can i put off")).toBe("full_task");
      expect(classifyContextMode("what am i free to skip")).toBe("full_task");
      expect(classifyContextMode("what shouldn't i worry about today")).toBe("full_task");
    });

    it("normalizes common typos/shorthand that previously fell through to light", () => {
      expect(classifyContextMode("wat r my priorites")).toBe("full_task");
      expect(classifyContextMode("help me priortize")).toBe("full_task");
      expect(classifyContextMode("wat shud i focus on rn")).toBe("full_task");
      expect(classifyContextMode("wat health task shud i do fst")).toBe("full_task");
      expect(classifyContextMode("wich task shud i strt with")).toBe("full_task");
    });

    it("does not treat unrelated 'what should I handle/deal with/nail' questions as task asks (Codex review finding)", () => {
      // "get to" was removed entirely — too generic/ambiguous to safely
      // pattern-match ("get to eat", "get to know").
      expect(classifyContextMode("what should I get to eat?")).toBe("light");
      expect(classifyContextMode("what should I handle carefully in this recipe?")).toBe("light");
      expect(classifyContextMode("what should I nail to the wall?")).toBe("light");
      // The legitimate bare/short-continuation phrasings still work.
      expect(classifyContextMode("what should i handle first")).toBe("full_task");
      expect(classifyContextMode("what should i handle")).toBe("full_task");
      expect(classifyContextMode("what should i deal with today")).toBe("full_task");
      expect(classifyContextMode("what should i nail today")).toBe("full_task");
    });

    it("requires a priority noun after 'top/main/biggest' but not after 'important/urgent' (Codex review finding)", () => {
      expect(classifyContextMode("what's the top speed of a cheetah?")).toBe("light");
      expect(classifyContextMode("what's the main idea here?")).toBe("light");
      // The legitimate phrasings (with a priority noun) still work.
      expect(classifyContextMode("what's my top priority")).toBe("full_task");
      expect(classifyContextMode("what's my main focus")).toBe("full_task");
      expect(classifyContextMode("what's the biggest priority")).toBe("full_task");
      // "important"/"urgent"/"pressing"/"critical" still stand alone.
      expect(classifyContextMode("what's most important right now")).toBe("full_task");
    });

    it("anchors bare 'next/pending/coming up' before an unrelated trailing clause (Codex review finding)", () => {
      expect(classifyContextMode("what's next in this recipe?")).toBe("light");
      expect(classifyContextMode("what is coming up in the book?")).toBe("light");
      // The legitimate phrasings still work.
      expect(classifyContextMode("what's next")).toBe("full_task");
      expect(classifyContextMode("what's pending")).toBe("full_task");
      expect(classifyContextMode("whats coming up this week")).toBe("full_task");
    });

    it("anchors negation priority asks before an unrelated trailing clause (Codex review finding)", () => {
      expect(classifyContextMode("what should I not do if I see a bear?")).toBe("light");
      expect(classifyContextMode("what can I ignore in this recipe?")).toBe("light");
      // The legitimate phrasings still work.
      expect(classifyContextMode("what should I NOT do today")).toBe("full_task");
      expect(classifyContextMode("what can i ignore for now")).toBe("full_task");
      expect(classifyContextMode("what can i skip today")).toBe("full_task");
      expect(classifyContextMode("what can i put off")).toBe("full_task");
    });

    it("constrains 'one thing I should' and requires 'my' for 'number one <noun>' (Codex review finding)", () => {
      expect(classifyContextMode("what's the one thing I should do before taking aspirin?")).toBe("light");
      expect(classifyContextMode("what is the number one thing to see in Rome?")).toBe("light");
      // The legitimate phrasings still work.
      expect(classifyContextMode("what's the one thing i should nail today")).toBe("full_task");
      expect(classifyContextMode("what should be my number one focus")).toBe("full_task");
    });

    it("bounds every newly-added TASK_ASK_RE verb, not just handle/deal with/nail (Codex review finding)", () => {
      expect(classifyContextMode("what should I be doing about this rash?")).toBe("light");
      expect(classifyContextMode("what should I dive into in Madrid?")).toBe("light");
      // The legitimate bare/short-continuation phrasings still work.
      expect(classifyContextMode("what should i be doing")).toBe("full_task");
      expect(classifyContextMode("what should i tackle first")).toBe("full_task");
      expect(classifyContextMode("what should i knock out")).toBe("full_task");
    });

    it("scopes direction-seeking phrases to known-safe complete phrasings (Codex review finding)", () => {
      expect(classifyContextMode("point me to the settings page")).toBe("light");
      expect(classifyContextMode("steer me toward the nearest clinic")).toBe("light");
      expect(classifyContextMode("orient me to this codebase")).toBe("light");
      // The legitimate phrasings still work.
      expect(classifyContextMode("point me in the right direction")).toBe("full_task");
      expect(classifyContextMode("steer me toward something useful")).toBe("full_task");
      expect(classifyContextMode("orient me for the day")).toBe("full_task");
    });

    it("still allows a category or horizon cue after the bounded task verbs (Codex review finding)", () => {
      // The end-of-clause lookahead from the previous round was too strict —
      // it didn't recognize "for <category>" or "this week/month/quarter" as
      // legitimate continuations, so these fell back to light along with the
      // genuinely unrelated questions it was meant to filter.
      expect(classifyContextMode("what should I tackle for work?")).toBe("full_task");
      expect(classifyContextMode("what should I deal with for health?")).toBe("full_task");
      expect(classifyContextMode("what should I knock out this week?")).toBe("full_task");
      // The unrelated questions the lookahead is meant to filter still do.
      expect(classifyContextMode("what should I be doing about this rash?")).toBe("light");
      expect(classifyContextMode("what should I dive into in Madrid?")).toBe("light");
    });

    it("anchors the remaining negation aliases before an unrelated trailing clause (Codex review finding)", () => {
      expect(classifyContextMode("what can wait in JavaScript?")).toBe("light");
      expect(classifyContextMode("what's optional chaining?")).toBe("light");
      expect(classifyContextMode("what don't I need to worry about during pregnancy?")).toBe("light");
      // The legitimate phrasings still work.
      expect(classifyContextMode("what can wait")).toBe("full_task");
      expect(classifyContextMode("what's optional today")).toBe("full_task");
      expect(classifyContextMode("what don't i need to worry about")).toBe("full_task");
      expect(classifyContextMode("what shouldn't i worry about today")).toBe("full_task");
    });

    it("anchors 'give me clarity/direction' and 'the smart move'/'needs doing' before an unrelated trailing clause (Codex review finding)", () => {
      expect(classifyContextMode("give me clarity on this regex")).toBe("light");
      expect(classifyContextMode("what's the smart move in chess?")).toBe("light");
      expect(classifyContextMode("what needs doing to this cake?")).toBe("light");
      // The legitimate phrasings still work.
      expect(classifyContextMode("give me clarity")).toBe("full_task");
      expect(classifyContextMode("give me direction")).toBe("full_task");
      expect(classifyContextMode("what's the smart move")).toBe("full_task");
      expect(classifyContextMode("what needs my attention")).toBe("full_task");
      expect(classifyContextMode("what needs doing")).toBe("full_task");
    });
  });
});

describe("detectRequestedCategories", () => {
  it("detects the category from 'which X task' phrasing", () => {
    expect(detectRequestedCategories("which work task should I do first?")).toEqual(["Work"]);
    expect(detectRequestedCategories("which career task should I do first?")).toEqual(["Career"]);
    expect(detectRequestedCategories("which health task should I do first?")).toEqual(["Health"]);
    expect(detectRequestedCategories("which personal task should I do first?")).toEqual(["Personal"]);
  });

  it("detects the category from '<category> task/priority should/to' phrasing", () => {
    expect(detectRequestedCategories("work task should be next")).toEqual(["Work"]);
    expect(detectRequestedCategories("career priority to focus on")).toEqual(["Career"]);
  });

  it("detects the category from 'focus on/prioritize ... for <category>' phrasing", () => {
    expect(detectRequestedCategories("what should I focus on for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what should I prioritize for my career?")).toEqual(["Career"]);
  });

  it("returns an empty array for messages that don't name a category", () => {
    expect(detectRequestedCategories("what should I do today?")).toEqual([]);
    expect(detectRequestedCategories("what should I focus on this month?")).toEqual([]);
  });

  it("normalizes shorthand before detecting, consistent with the classifier", () => {
    expect(detectRequestedCategories("wat work task should i do first")).toEqual(["Work"]);
  });

  it("detects 'what are/tell me/show me my <category> priorities' phrasing without should/to (Codex review finding)", () => {
    // These already route to full_task via BROAD_TASK_QUERY_RE's own
    // category-priority branch — detectRequestedCategories needs the same
    // coverage or the CATEGORY NOTE silently never fires for them.
    expect(detectRequestedCategories("What are my work priorities?")).toEqual(["Work"]);
    expect(detectRequestedCategories("Tell me my health priorities")).toEqual(["Health"]);
    expect(detectRequestedCategories("Show me my work priorities")).toEqual(["Work"]);
    expect(detectRequestedCategories("Check my career priorities")).toEqual(["Career"]);
  });

  it("detects multiple categories from compound 'my X and Y priorities' / 'my X/Y priorities' phrasing (Codex review finding)", () => {
    expect(detectRequestedCategories("What are my health and work priorities?")).toEqual(["Health", "Work"]);
    expect(detectRequestedCategories("What are my health/work priorities?")).toEqual(["Health", "Work"]);
  });

  it("detects counted category-priority asks (Codex review finding)", () => {
    expect(detectRequestedCategories("What are my 2 work priorities?")).toEqual(["Work"]);
    expect(detectRequestedCategories("What are my six work priorities?")).toEqual(["Work"]);
  });

  it("detects plural 'which (of my) X tasks' phrasing (Codex review finding)", () => {
    expect(detectRequestedCategories("Which work tasks should I start?")).toEqual(["Work"]);
    expect(detectRequestedCategories("Which of my work tasks should I do first?")).toEqual(["Work"]);
  });

  it("requires a whole-word category match, not a substring (Codex review finding)", () => {
    expect(detectRequestedCategories("What are my paperwork priorities and tasks?")).toEqual([]);
    expect(detectRequestedCategories("What are my homework priorities?")).toEqual([]);
  });

  it("ignores third-party priority clauses like \"my boss's work priorities\" (Codex review finding)", () => {
    expect(detectRequestedCategories("What are my boss's work priorities and tasks?")).toEqual([]);
    expect(detectRequestedCategories("What are my manager's career priorities?")).toEqual([]);
  });

  it("captures every category in 'focus/prioritize for X and Y' phrasing (Codex review finding)", () => {
    expect(detectRequestedCategories("What should I prioritize for health and work?")).toEqual(["Health", "Work"]);
    // Existing single-category shapes still resolve correctly.
    expect(detectRequestedCategories("what should I focus on for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what should I prioritize for my career?")).toEqual(["Career"]);
  });

  it("detects a category cue on PRIORITY_SYNONYM_RE's newer alias lead-ins (Codex review finding)", () => {
    // These alias phrasings ("needs my attention", "on my radar", "the game
    // plan") already route to full_task on their own, but without a
    // matching category-detection shape, a missing-category mismatch note
    // (issue #338) never fires when one of these is combined with "for
    // <category>".
    expect(detectRequestedCategories("what needs my attention for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what's on my radar for health?")).toEqual(["Health"]);
    expect(detectRequestedCategories("give me the game plan for work")).toEqual(["Work"]);
  });

  it("detects category-scoped task-list asks like 'show me my work tasks' (Codex review finding)", () => {
    expect(detectRequestedCategories("Show me my work tasks")).toEqual(["Work"]);
    expect(detectRequestedCategories("What are my health tasks?")).toEqual(["Health"]);
    expect(detectRequestedCategories("List my career tasks")).toEqual(["Career"]);
  });

  it("does not classify add-task wording as a category filter (Codex review finding)", () => {
    expect(detectRequestedCategories("Add a work task to call Bob to my list")).toEqual([]);
    expect(detectRequestedCategories("create a health task to book a checkup")).toEqual([]);
    // Longer filler between the verb and the category still gets excluded.
    expect(detectRequestedCategories("Add a high priority work task to call Bob to my list")).toEqual([]);
    // The genuine category-filtered ask still works.
    expect(detectRequestedCategories("work task should be next")).toEqual(["Work"]);
    expect(detectRequestedCategories("career priority to focus on")).toEqual(["Career"]);
  });

  it("scans both categories in compound 'which X task and Y task' asks (Codex review finding)", () => {
    expect(detectRequestedCategories("Which work task and health task should I do first?")).toEqual(["Work", "Health"]);
    // Existing single-category "which" shapes still resolve correctly.
    expect(detectRequestedCategories("which work task should I do first?")).toEqual(["Work"]);
    expect(detectRequestedCategories("Which of my work tasks should I do first?")).toEqual(["Work"]);
  });

  it("ignores explicitly excluded categories like 'for work, not personal' (Codex review finding)", () => {
    expect(detectRequestedCategories("What should I prioritize for work, not personal?")).toEqual(["Work"]);
  });

  it("detects common category-scoped asks using 'do/start' verbs and plain 'what <category> tasks' phrasing (Codex review finding)", () => {
    expect(detectRequestedCategories("What should I do for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("Which task should I start for health?")).toEqual(["Health"]);
    expect(detectRequestedCategories("What work tasks do I have?")).toEqual(["Work"]);
  });
});
