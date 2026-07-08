import { describe, expect, it } from "vitest";
import { classifyContextMode, needsConversationContext, trimHistoryForDb, trimHistoryForLLM, detectRequestedCategories, normalizeForClassification } from "./coachContextMode";

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

  // Found via live-testing round 3: real users describe finishing, adding,
  // deferring, or starting a task with far more verbs than the ones already
  // covered — each of these previously fell through to "light" (no task
  // data at all), matching coachActions.js's own INTENT_PATTERNS synonyms
  // added alongside this so a resulting action tag isn't then blocked by
  // the gate once the message does reach full_task.
  it("recognizes additional completion/add/park/focus action-verb synonyms (live-testing round 3)", () => {
    expect(classifyContextMode("i wrapped up the inbox message")).toBe("full_task");
    expect(classifyContextMode("i knocked out the important message")).toBe("full_task");
    expect(classifyContextMode("i crossed the message off my list")).toBe("full_task");
    expect(classifyContextMode("i'm done replying to that important message")).toBe("full_task");
    expect(classifyContextMode("jot down call the plumber")).toBe("full_task");
    expect(classifyContextMode("note down call the plumber")).toBe("full_task");
    expect(classifyContextMode("i need to remember to call the plumber")).toBe("full_task");
    expect(classifyContextMode("put off clearing my desk")).toBe("full_task");
    expect(classifyContextMode("postpone clearing my desk")).toBe("full_task");
    expect(classifyContextMode("shelve the desk cleaning for now")).toBe("full_task");
    expect(classifyContextMode("i want to focus on the deep work block now")).toBe("full_task");
    expect(classifyContextMode("let's dive into the deep work block now")).toBe("full_task");
    expect(classifyContextMode("time to work on the deep work block")).toBe("full_task");
  });

  it("does not route non-task 'done <gerund>' phrasing to full_task (Codex review finding, PR #342 round 1)", () => {
    // "I'm done stressing/thinking about X" is emotional/reflective language,
    // not a task completion — without this exclusion, it removed the
    // previous barrier keeping such phrasing away from coachActions.js's
    // COMPLETE_TASK gate, which could then accept a hallucinated completion
    // tag for the mentioned task.
    expect(classifyContextMode("I'm done stressing about the report")).not.toBe("full_task");
    expect(classifyContextMode("I'm done thinking about the report")).not.toBe("full_task");
    // The genuine completion-gerund phrasing still works.
    expect(classifyContextMode("I'm done replying to that important message")).toBe("full_task");
  });

  it("excludes more non-task gerunds from 'done <gerund>' (Codex review finding, PR #342 round 2)", () => {
    expect(classifyContextMode("I'm done arguing about the report")).not.toBe("full_task");
    expect(classifyContextMode("I'm done waiting on the report")).not.toBe("full_task");
    expect(classifyContextMode("I'm done pretending this report matters")).not.toBe("full_task");
    expect(classifyContextMode("I'm done obsessing over the report")).not.toBe("full_task");
    expect(classifyContextMode("I'm done avoiding the report")).not.toBe("full_task");
  });

  it("guards the routing regex for wrapped-up/knocked-out/jot-down/put-off/postpone/shelve with the same question-word exclusion as 'dive into' (Codex review finding, PR #342 round 2)", () => {
    // Even though coachActions.js's gate would still block any resulting
    // mutation, unguarded routing still sent ordinary definition/how-to/
    // general-knowledge questions into full_task, exposing the user's task
    // snapshot and action instructions unnecessarily.
    expect(classifyContextMode("what does postpone mean?")).not.toBe("full_task");
    expect(classifyContextMode("how do I jot down notes better?")).not.toBe("full_task");
    expect(classifyContextMode("why do people put off chores?")).not.toBe("full_task");
    // The genuine imperative/statement phrasings still work.
    expect(classifyContextMode("postpone the report")).toBe("full_task");
    expect(classifyContextMode("jot down call the plumber")).toBe("full_task");
    expect(classifyContextMode("I wrapped up the report")).toBe("full_task");
    expect(classifyContextMode("I knocked out the report")).toBe("full_task");
  });

  it("preserves 'could/would you' polite requests for the new verb synonyms at the routing level too (Codex review finding, PR #342 round 3)", () => {
    // The loose question-word window previously blocked "could you"/"would
    // you" from ever reaching full_task at all, the same as "could I"/
    // "would I" — these words also form a polite command when followed by
    // "you", so the guard needs immediate "I" adjacency instead of a loose
    // window.
    expect(classifyContextMode("could you jot down call the plumber?")).toBe("full_task");
    expect(classifyContextMode("would you note down call the plumber?")).toBe("full_task");
    expect(classifyContextMode("could you postpone the report?")).toBe("full_task");
    expect(classifyContextMode("could you dive into the report?")).toBe("full_task");
    expect(classifyContextMode("could you shelve the report?")).toBe("full_task");
    // The advice-question forms still stay light.
    expect(classifyContextMode("what does postpone mean?")).not.toBe("full_task");
    expect(classifyContextMode("how do I jot down notes better?")).not.toBe("full_task");
  });

  it("routes 'do I have time'/'is now a good time' availability questions away from full_task (Codex review finding, PR #342 round 3)", () => {
    expect(classifyContextMode("do I have time to work on the report?")).not.toBe("full_task");
    expect(classifyContextMode("is now a good time to work on the report?")).not.toBe("full_task");
  });

  it("guards 'need to remember' against a 'do I need to' advice question (Codex review finding, PR #342 round 3)", () => {
    expect(classifyContextMode("do I need to remember to call the plumber?")).not.toBe("full_task");
    // The genuine statement/request still works.
    expect(classifyContextMode("I need to remember to call the plumber")).toBe("full_task");
  });

  it("routes separated 'jot/note ... down' and 'put ... off' object forms to full_task (Codex review finding, PR #342 round 4)", () => {
    // The previous adjacent-only "jot down"/"note down"/"put off" never
    // recognized this equally common separable phrasing, so the message
    // stayed at "light" and never reached the COACH ACTIONS instructions.
    expect(classifyContextMode("jot this down: call the plumber")).toBe("full_task");
    expect(classifyContextMode("note this down: call the plumber")).toBe("full_task");
    expect(classifyContextMode("put the report off until tomorrow")).toBe("full_task");
  });

  it("excludes a preceding question word from the 'dive into'/'jump into'/'time to work on'/'want to focus on' synonyms (merge regression)", () => {
    // Merging #340's TASK_ASK_RE bounding work (which requires "what should
    // I dive into" to end in a short, task-shaped continuation) with #342's
    // unconstrained EXPLICIT_ACTION_RE additions of the same verbs caused
    // "what should I dive into in Madrid?" to match EXPLICIT_ACTION_RE
    // unconditionally and skip TASK_ASK_RE's lookahead entirely.
    expect(classifyContextMode("what should I dive into in Madrid?")).toBe("light");
    expect(classifyContextMode("what should I jump into next in this course?")).toBe("light");
    // The imperative forms (no leading question word) still work.
    expect(classifyContextMode("let's dive into the deep work block now")).toBe("full_task");
    expect(classifyContextMode("time to work on the deep work block")).toBe("full_task");
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

  it("still normalizes '4' shorthand to 'for' before a category-word synonym, unless it follows 'my' (Codex review finding, PR #341 round 1)", () => {
    // Adding job/office/fitness/wellness/gym/home/family to the digit-guard's
    // exclusion list broke the far more common "4" == "for" shorthand before
    // these words, since the guard didn't distinguish a genuine count ("my 4
    // work priorities") from "for" ("what should i tackle 4 fitness").
    expect(normalizeForClassification("what should i tackle 4 fitness")).toBe("what should i tackle for fitness");
    expect(normalizeForClassification("my 4 work priorities")).toBe("my 4 work priorities");
    // Duration/time-unit words stay unconditionally excluded regardless of a
    // preceding "my".
    expect(normalizeForClassification("remind me in 4 months")).toBe("remind me in 4 months");
    expect(normalizeForClassification("call the plumber at 4pm")).toBe("call the plumber at 4pm");
  });

  it("still normalizes '2' shorthand to 'to' before a category-word synonym, unless it follows 'my' (Codex review finding, PR #341 round 2)", () => {
    // Mirrors the "4"->"for" fix — the same category-word exclusion list on
    // the "2"->"to" rule broke "remind me 2 job hunt"/"remind me 2 fitness
    // class" (no time signal, so with no normalization these fell to
    // "light" instead of reaching the ADD_TASK path).
    expect(normalizeForClassification("remind me 2 job hunt")).toBe("remind me to job hunt");
    expect(normalizeForClassification("remind me 2 fitness class")).toBe("remind me to fitness class");
    expect(normalizeForClassification("my 2 work priorities")).toBe("my 2 work priorities");
    expect(normalizeForClassification("remind me in 2 minutes")).toBe("remind me in 2 minutes");
    expect(normalizeForClassification("call the plumber at 2pm")).toBe("call the plumber at 2pm");
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

    it("never compacts category-synonym-scoped priority asks, even on the paced path (live-testing round 3)", () => {
      const pacedOpts = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("which job task should i do first", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("what are my fitness priorities", pacedOpts)).toBe("full_task");
      expect(classifyContextMode("show me my wellness tasks", pacedOpts)).toBe("full_task");
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

    it("bounds 'which one/task should I handle/tackle' before an unrelated trailing clause (Codex review finding)", () => {
      expect(classifyContextMode("which one should I handle carefully in this recipe?")).toBe("light");
      expect(classifyContextMode("which task should I tackle?")).toBe("full_task");
      expect(classifyContextMode("which one should I handle for work?")).toBe("full_task");
      expect(classifyContextMode("which task should I start?")).toBe("full_task");
    });

    it("anchors the remaining negation aliases before an unrelated trailing clause (Codex review finding, round 2)", () => {
      expect(classifyContextMode("what's not important in JavaScript?")).toBe("light");
      expect(classifyContextMode("what's the least important thing about this movie?")).toBe("light");
      expect(classifyContextMode("what has the lowest priority in CSS?")).toBe("light");
      expect(classifyContextMode("what am i free to skip in this recipe?")).toBe("light");
      expect(classifyContextMode("what's not important today")).toBe("full_task");
      expect(classifyContextMode("what's the least important thing")).toBe("full_task");
      expect(classifyContextMode("what has the lowest priority")).toBe("full_task");
      expect(classifyContextMode("what am i free to skip today")).toBe("full_task");
    });

    it("anchors the remaining open-ended priority aliases before an unrelated trailing clause (Codex review finding)", () => {
      expect(classifyContextMode("what needs my attention in this recipe?")).toBe("light");
      expect(classifyContextMode("what's on my radar in chess?")).toBe("light");
      expect(classifyContextMode("walk me through what matters in this codebase")).toBe("light");
      expect(classifyContextMode("what needs my attention")).toBe("full_task");
      expect(classifyContextMode("what's on my radar")).toBe("full_task");
      expect(classifyContextMode("walk me through what matters")).toBe("full_task");
      expect(classifyContextMode("what needs my attention for work?")).toBe("full_task");
      expect(classifyContextMode("what's on my radar for health?")).toBe("full_task");
    });

    it("keeps category/horizon-filtered new task verbs out of compact mode on the paced path (Codex review finding, round 5)", () => {
      const paced = { lastFullTaskTime: Date.now(), hasLastPlan: true };
      expect(classifyContextMode("what should I tackle for work?", paced)).toBe("full_task");
      expect(classifyContextMode("what should I dive into this quarter?", paced)).toBe("full_task");
      expect(classifyContextMode("what should I deal with for health?", paced)).toBe("full_task");
    });

    it("bounds the remaining open-ended priority aliases and 'which one should I do' (Codex review finding, round 5)", () => {
      expect(classifyContextMode("what deserves my attention in this recipe?")).toBe("light");
      expect(classifyContextMode("what do i have going on in my stomach?")).toBe("light");
      expect(classifyContextMode("what is the important thing about CSS?")).toBe("light");
      expect(classifyContextMode("which one should I do in this recipe?")).toBe("light");
      expect(classifyContextMode("what deserves my attention?")).toBe("full_task");
      expect(classifyContextMode("what do i have going on?")).toBe("full_task");
      expect(classifyContextMode("what is the important thing?")).toBe("full_task");
      expect(classifyContextMode("what's most important right now")).toBe("full_task");
      expect(classifyContextMode("which one should I do?")).toBe("full_task");
    });

    it("bounds the due-soon negation alias and lets number-one asks take a day cue (Codex review finding, round 5)", () => {
      expect(classifyContextMode("what's not due soon in JavaScript?")).toBe("light");
      expect(classifyContextMode("what is not going to hurt if I skip it during pregnancy?")).toBe("light");
      expect(classifyContextMode("what's not due soon?")).toBe("full_task");
      expect(classifyContextMode("what's my number one priority today?")).toBe("full_task");
      expect(classifyContextMode("what's my number one focus right now?")).toBe("full_task");
    });

    it("carries a category/horizon cue through the remaining negation aliases (Codex review finding, round 5)", () => {
      expect(classifyContextMode("what can wait for work?")).toBe("full_task");
      expect(classifyContextMode("what's not urgent for health?")).toBe("full_task");
      expect(classifyContextMode("what's the least important thing for work?")).toBe("full_task");
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

  it("detects a category cue on TASK_ASK_RE's newer verb lead-ins (Codex review finding)", () => {
    // "tackle"/"deal with"/etc. route to full_task on their own via "for
    // <category>", but without a matching category-detection lead-in here, a
    // missing-category mismatch note (issue #338) never fires.
    expect(detectRequestedCategories("what should I tackle for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what should I deal with for health?")).toEqual(["Health"]);
  });

  it("detects a category cue on PRIORITY_SYNONYM_RE's priority-noun lead-ins (Codex review finding, round 5)", () => {
    expect(detectRequestedCategories("what's my main focus for health?")).toEqual(["Health"]);
    expect(detectRequestedCategories("what's the top thing for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what deserves my attention for work?")).toEqual(["Work"]);
  });

  it("resolves compound category phrases to their true category, not their component word's default (Codex review finding, PR #341 round 1)", () => {
    // "job search" is Career (job-hunting), not Work — the app's own
    // category guidance classifies it that way (MindBoxTab.jsx), even
    // though bare "job" is a Work synonym.
    expect(detectRequestedCategories("what are my job search priorities")).toEqual(["Career"]);
    expect(detectRequestedCategories("what are my job priorities")).toEqual(["Work"]);
    // "family doctor" is Health (medical admin), not Personal, even though
    // bare "family" is a Personal synonym.
    expect(detectRequestedCategories("what should I prioritize for family doctor?")).toEqual(["Health"]);
    expect(detectRequestedCategories("which family doctor task should I do first?")).toEqual(["Health"]);
    expect(detectRequestedCategories("what are my family priorities")).toEqual(["Personal"]);
    // "home" in "work from home" is part of a Work phrase, not a separate
    // Personal category request.
    expect(detectRequestedCategories("what are my work from home priorities")).toEqual(["Work"]);
    expect(detectRequestedCategories("what should I focus on for work from home")).toEqual(["Work"]);
  });

  it("resolves more compound category phrases and applies the rewrite before direct task patterns too (Codex review finding, PR #341 round 2)", () => {
    // "job applications" is Career, mirroring "job search".
    expect(detectRequestedCategories("what should I prioritize for job applications?")).toEqual(["Career"]);
    // "doctor's office"/"doctor office" is Health, not Work (bare "office").
    expect(detectRequestedCategories("what should I prioritize for doctor's office?")).toEqual(["Health"]);
    expect(detectRequestedCategories("what should I prioritize for doctor office?")).toEqual(["Health"]);
    // The compound rewrite must run before SINGLE_CATEGORY_PATTERNS' direct
    // "<category> task should" shape too, not just the clause-scanning
    // shapes — otherwise "home" is captured directly off the raw text before
    // the "work from home" rewrite ever runs.
    expect(detectRequestedCategories("what work from home task should I do first?")).toEqual(["Work"]);
  });

  it("does not route a possessive 'my family's priorities' ask into full_task (Codex review finding, PR #341 round 2)", () => {
    // Unlike "career's"/"work's" (awkward, rarely said), "my family's
    // priorities" is a natural phrase — but it's asking about the family's
    // priorities, not the user's own tasks, so it must not enter full_task
    // (which would otherwise answer from the user's own Loci tasks with no
    // category filter, since detectRequestedCategories already excludes
    // third-party possessives and returns []).
    expect(classifyContextMode("what are my family's priorities?")).not.toBe("full_task");
    expect(detectRequestedCategories("what are my family's priorities?")).toEqual([]);
    // The non-possessive form still works as a genuine category ask.
    expect(classifyContextMode("what are my family priorities?")).toBe("full_task");
    expect(detectRequestedCategories("what are my family priorities?")).toEqual(["Personal"]);
  });

  it("applies the compound-category rewrite to classifyContextMode's routing too, not just detectRequestedCategories (Codex review finding, PR #341 round 3)", () => {
    // The rewrite previously only ran inside detectRequestedCategories, so
    // classifyContextMode still evaluated the raw "job search"/"work from
    // home" text and BROAD_TASK_QUERY_RE (which requires the category word
    // immediately before "priorities", not an extra word like "search" or
    // "from home" in between) never matched, leaving these at "light" even
    // though detectRequestedCategories separately resolved a category.
    expect(classifyContextMode("what are my job search priorities")).toBe("full_task");
    expect(classifyContextMode("what are my work from home priorities")).toBe("full_task");
  });

  it("resolves job-interview and home-workout compound phrases, and non-Work 'office' compounds (Codex review finding, PR #341 round 3)", () => {
    // "job interview(s)" is Career, mirroring "job search"/"job application".
    expect(detectRequestedCategories("what should I prioritize for job interviews?")).toEqual(["Career"]);
    expect(detectRequestedCategories("which job interview task should I do first?")).toEqual(["Career"]);
    // "home workout" is Health (exercise), not Personal (bare "home").
    expect(detectRequestedCategories("which home workout task should I do first?")).toEqual(["Health"]);
    // "post office" is Personal (errand), "dentist office" is Health
    // (medical admin) — neither is Work despite the bare "office" synonym.
    expect(detectRequestedCategories("what should I prioritize for post office?")).toEqual(["Personal"]);
    expect(detectRequestedCategories("what should I prioritize for dentist office?")).toEqual(["Health"]);
    // Bare "office" (no compound) still correctly means Work.
    expect(detectRequestedCategories("what should I prioritize for office?")).toEqual(["Work"]);
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

  // Found via live-testing round 3: real users name a category by a common
  // synonym ("job", "fitness") far more often than by the app's exact tag
  // word ("Work", "Health") — none of these resolved to anything before,
  // silencing the category-mismatch honesty check for the majority of
  // real-world phrasings.
  it("maps common category synonyms to their canonical tag (live-testing round 3)", () => {
    expect(detectRequestedCategories("which job task should i do first")).toEqual(["Work"]);
    expect(detectRequestedCategories("which office task should i do first")).toEqual(["Work"]);
    expect(detectRequestedCategories("which fitness task should i do first")).toEqual(["Health"]);
    expect(detectRequestedCategories("which wellness task should i do first")).toEqual(["Health"]);
    expect(detectRequestedCategories("which gym task should i do first")).toEqual(["Health"]);
    expect(detectRequestedCategories("which home task should i do first")).toEqual(["Personal"]);
    expect(detectRequestedCategories("which family task should i do first")).toEqual(["Personal"]);
    expect(detectRequestedCategories("what are my job priorities")).toEqual(["Work"]);
    expect(detectRequestedCategories("what are my fitness priorities")).toEqual(["Health"]);
    expect(detectRequestedCategories("what are my home priorities")).toEqual(["Personal"]);
    expect(detectRequestedCategories("show me my job tasks")).toEqual(["Work"]);
    expect(detectRequestedCategories("show me my fitness tasks")).toEqual(["Health"]);
  });

  // Found via live-testing round 4 against the merged #340-#343 main: these
  // natural phrasings stayed at "light" and got the coach's honest
  // "missing the task snapshot" fallback, while near-identical phrasings
  // (e.g. "what can I skip today?") correctly reached full_task.
  it("routes 'anything ... I can ignore/skip' and 'bother with' framings to full_task (live-testing round 4)", () => {
    expect(classifyContextMode("anything low priority I can ignore today?")).toBe("full_task");
    expect(classifyContextMode("anything I can skip today?")).toBe("full_task");
    expect(classifyContextMode("what shouldn't I bother with today?")).toBe("full_task");
  });

  it("routes '<category> stuff/things/items' phrasing to full_task, not just '<category> task(s)' (live-testing round 4)", () => {
    expect(classifyContextMode("what job stuff do I have today?")).toBe("full_task");
    expect(classifyContextMode("what home things do I need to handle?")).toBe("full_task");
    expect(classifyContextMode("show me my fitness items")).toBe("full_task");
    expect(detectRequestedCategories("what job stuff do I have today?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what home things do I need to handle?")).toEqual(["Personal"]);
  });

  it("doesn't route general-knowledge '<category> stuff/things/items' questions to full_task (Codex review finding, PR #344)", () => {
    // Unlike "task(s)" (inherently task-related), the generic nouns only
    // count as a task-list ask when followed by a task-list continuation
    // or the clause ends there — not when the sentence keeps going into an
    // unrelated general-knowledge question that happens to share the noun.
    expect(classifyContextMode("what health things should I know about pregnancy?")).not.toBe("full_task");
    expect(classifyContextMode("what work items can I deduct on taxes?")).not.toBe("full_task");
    expect(classifyContextMode("tell me my health things I should know about pregnancy")).not.toBe("full_task");
  });

  it("doesn't treat bare 'do I need' as a task-list continuation for generic nouns (Codex review finding, PR #344 round 2)", () => {
    // A bare "do i need" let arbitrary text follow it; it now only counts
    // as the end of the clause or immediately followed by a task verb.
    expect(classifyContextMode("what health things do I need to know about pregnancy?")).not.toBe("full_task");
    expect(classifyContextMode("what work items do I need for taxes?")).not.toBe("full_task");
    // Genuine task-list asks with "do I need" still work.
    expect(classifyContextMode("what home things do I need to handle?")).toBe("full_task");
  });

  it("accepts the expanded 'what should I not bother with' phrasing (Codex review finding, PR #344 round 2)", () => {
    expect(classifyContextMode("what should I not bother with today?")).toBe("full_task");
    expect(classifyContextMode("what should I not bother with for work?")).toBe("full_task");
    expect(classifyContextMode("what shouldn't I bother with today?")).toBe("full_task");
  });

  it("routes 'which <category> stuff/items should I do/handle first' to full_task (Codex review finding, PR #344 round 2)", () => {
    // "which" questions naturally continue with "should I do/handle first"
    // or "can I skip", distinct from "what <category> <noun> do I have".
    expect(classifyContextMode("which work items should I do first?")).toBe("full_task");
    expect(classifyContextMode("which job stuff should I handle first?")).toBe("full_task");
    // The pre-existing "task(s)" form still works.
    expect(classifyContextMode("which work tasks should I do first?")).toBe("full_task");
  });

  it("accepts hyphenated 'low-priority' spelling for the ignore/skip ask (Codex review finding, PR #344 round 3)", () => {
    expect(classifyContextMode("anything low-priority I can ignore today?")).toBe("full_task");
    expect(classifyContextMode("anything low priority I can ignore today?")).toBe("full_task");
  });

  it("accepts singular generic nouns 'item'/'thing' alongside the plural forms (Codex review finding, PR #344 round 3)", () => {
    expect(classifyContextMode("which work item should I do first?")).toBe("full_task");
    expect(classifyContextMode("what home thing do I need to handle?")).toBe("full_task");
  });

  it("accepts 'next' and 'ignore'/'put off' continuations for generic-noun 'which' asks (Codex review finding, PR #344 round 3)", () => {
    // These already worked for the unguarded "task(s)" form; the generic
    // nouns now accept the same set of priority continuations.
    expect(classifyContextMode("which work items should I do next?")).toBe("full_task");
    expect(classifyContextMode("which work items can I ignore?")).toBe("full_task");
    expect(classifyContextMode("which work items can I put off?")).toBe("full_task");
  });

  it("accepts 'now'/'right now' endings and 'should I skip/ignore' for generic nouns (Codex review finding, PR #344 round 4)", () => {
    expect(classifyContextMode("which work items should I do right now?")).toBe("full_task");
    expect(classifyContextMode("which work items can I skip now?")).toBe("full_task");
    expect(classifyContextMode("which work items should I skip?")).toBe("full_task");
    expect(classifyContextMode("which work items should I ignore?")).toBe("full_task");
  });

  it("accepts 'now'/'for now' endings for the bother-with ask (Codex review finding, PR #344 round 4)", () => {
    expect(classifyContextMode("what should I not bother with now?")).toBe("full_task");
    expect(classifyContextMode("what shouldn't I bother with for now?")).toBe("full_task");
  });

  it("detects categories for the new negative-priority synonyms and pre-existing skip/put-off (Codex review finding, PR #344 round 4)", () => {
    // "bother with" and "anything...can I skip" are new this round; plain
    // "skip"/"put off" for "for <category>" was a pre-existing gap from
    // #340 that shares the same underlying fix.
    expect(detectRequestedCategories("what should I not bother with for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("anything I can skip for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what can I skip for work?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what can i put off for work?")).toEqual(["Work"]);
  });

  it("detects categories for generic-noun 'on my list' asks with 'is/are' in between (Codex review finding, PR #344 round 4)", () => {
    // "what job items are on my list?" has "are" between the noun and the
    // continuation phrase, unlike the unguarded "task(s)" form which has no
    // such requirement at all.
    expect(detectRequestedCategories("what job items are on my list?")).toEqual(["Work"]);
    expect(detectRequestedCategories("what job tasks are on my list?")).toEqual(["Work"]);
  });

  it("doesn't treat '<category> reason(s)' as a category filter (Codex review finding, PR #344 round 5)", () => {
    // "what can I skip for health reasons?" names "health" as the cause of
    // skipping something, not the category being asked about — a real
    // regression introduced by the round-4 FOCUS_FOR_CLAUSE_RE broadening.
    expect(detectRequestedCategories("what can I skip for health reasons?")).toEqual([]);
    expect(detectRequestedCategories("what should I not bother with for work reasons?")).toEqual([]);
    // A genuine category ask for the same category word still works.
    expect(detectRequestedCategories("what can I skip for health?")).toEqual(["Health"]);
  });

  it("accepts 'should' alongside 'can' for the 'anything ... skip/ignore' ask (Codex review finding, PR #344 round 5)", () => {
    expect(classifyContextMode("anything I should skip today?")).toBe("full_task");
    expect(classifyContextMode("anything low priority I should ignore today?")).toBe("full_task");
  });

  it("accepts 'for now' endings and urgent/can-wait continuations for generic-noun which asks (Codex review finding, PR #344 round 5)", () => {
    expect(classifyContextMode("which work items can I skip for now?")).toBe("full_task");
    expect(classifyContextMode("which work items are urgent?")).toBe("full_task");
    expect(classifyContextMode("which work items can wait?")).toBe("full_task");
  });

  it("recognizes 'errands' as a Personal-category synonym (live-testing round 5)", () => {
    // "errands" is itself a natural plural noun, unlike "job"/"work"/etc.,
    // which are category adjectives that need a separate trailing noun
    // ("job stuff", "job tasks") — "what errands do I have today?" has no
    // such separate noun, so it needs its own routing shape.
    expect(classifyContextMode("what errands do I have today?")).toBe("full_task");
    expect(detectRequestedCategories("what errands do I have today?")).toEqual(["Personal"]);
    expect(detectRequestedCategories("which errands should I do first?")).toEqual(["Personal"]);
  });

  it("still excludes possessive 'family's' after adding 'errands' to the category word list", () => {
    // Regression check: adding "errands" as a new alternative must not
    // disturb the existing family(?!['’]s) negative lookahead that
    // excludes "my family's priorities" from being treated as the user's
    // own Personal-category ask.
    expect(classifyContextMode("what are my family's priorities?")).not.toBe("full_task");
    expect(detectRequestedCategories("what are my family's priorities?")).toEqual([]);
    expect(classifyContextMode("what are my family priorities?")).toBe("full_task");
  });

  it("detects categories for 'can/should wait for <category>' negation asks (Codex review finding, PR #345)", () => {
    // "wait" wasn't in FOCUS_FOR_CLAUSE_RE's verb list at all — a
    // pre-existing gap from #340, not specific to errands, that this fix
    // also resolves for every category.
    expect(detectRequestedCategories("what can wait for errands?")).toEqual(["Personal"]);
    expect(detectRequestedCategories("what can wait for work?")).toEqual(["Work"]);
  });

  it("routes 'which errands ...' to full_task (Codex review finding, PR #345)", () => {
    expect(classifyContextMode("which errands should I do first?")).toBe("full_task");
    expect(classifyContextMode("which errands can I skip?")).toBe("full_task");
  });

  it("doesn't corrupt literal 'N errands' counts (Codex review finding, PR #345)", () => {
    // Unlike the adjective-like category words ("2 job"/"2 fitness" are
    // never literal counts), "errands" is a genuine countable noun, so
    // "what 2 errands do I have?" must not become "what to errands do I
    // have?" the way "remind me 2 job hunt" -> "remind me to job hunt" does.
    expect(normalizeForClassification("what 2 errands do I have?")).toBe("what 2 errands do I have?");
    expect(normalizeForClassification("I have 2 errands")).toBe("I have 2 errands");
    // The "my"-prefixed case (already protected before this fix) still works.
    expect(normalizeForClassification("what are my 2 errands?")).toBe("what are my 2 errands?");
    // Unrelated category shorthand normalization is untouched.
    expect(normalizeForClassification("remind me 2 job hunt")).toBe("remind me to job hunt");
  });

  it("routes bare 'what errands should I do first/can I skip' to full_task (Codex review finding, PR #345 round 3)", () => {
    expect(classifyContextMode("what errands should I do first?")).toBe("full_task");
    expect(classifyContextMode("what errands can I skip?")).toBe("full_task");
    expect(detectRequestedCategories("what errands should I do first?")).toEqual(["Personal"]);
  });

  it("doesn't treat temporal 'wait for <noun>' clauses as category filters (Codex review finding, PR #345 round 3)", () => {
    // "do" alone already matched these exact examples before "wait" was
    // ever added — narrowing "wait" to "(?:can|should) wait" wasn't
    // sufficient on its own; the shared verb-to-"for" gap now also excludes
    // "wait" as an interrupter for every verb in the list.
    expect(detectRequestedCategories("what should I do while I wait for health insurance?")).toEqual([]);
    expect(detectRequestedCategories("what should I do while I wait for work to start?")).toEqual([]);
    // The genuine "can/should wait for <category>" ask still works.
    expect(detectRequestedCategories("what can wait for errands?")).toEqual(["Personal"]);
    expect(detectRequestedCategories("what can wait for work?")).toEqual(["Work"]);
  });

  it("only counts 'errands' as the requested category when it ends the clause (Codex review finding, PR #345 round 3)", () => {
    // Unlike the adjective-like category words, "errands" is a plain noun
    // that can appear as a compound-noun modifier ("errands app design")
    // without naming the category being asked about. "work" has the
    // identical pre-existing issue ("what is important for work app
    // design?" also over-matches) — out of scope here, since it wasn't
    // introduced by this PR.
    expect(detectRequestedCategories("what is important for errands app design?")).toEqual([]);
    // A genuine compound-category ask naming errands alongside another
    // category still works.
    expect(detectRequestedCategories("what should I prioritize for errands and health?")).toEqual(["Personal", "Health"]);
  });

  it("accepts 'of my' before bare errands and bare list requests (Codex review finding, PR #345 round 4)", () => {
    expect(classifyContextMode("which of my errands should I do first?")).toBe("full_task");
    expect(classifyContextMode("which of my errands can I skip?")).toBe("full_task");
    expect(classifyContextMode("show me my errands")).toBe("full_task");
    expect(classifyContextMode("list my errands")).toBe("full_task");
    expect(classifyContextMode("what are my errands?")).toBe("full_task");
  });

  it("preserves errands in unspaced compound-category separators (Codex review finding, PR #345 round 4)", () => {
    expect(detectRequestedCategories("what should I prioritize for errands/health?")).toEqual(["Personal", "Health"]);
    expect(detectRequestedCategories("what should I prioritize for errands&health?")).toEqual(["Personal", "Health"]);
  });

  it("recognizes singular 'errand' alongside 'errands' (Codex review finding, PR #345 round 4)", () => {
    expect(classifyContextMode("what are my errand priorities?")).toBe("full_task");
    expect(classifyContextMode("which errand should I do first?")).toBe("full_task");
    expect(detectRequestedCategories("which errand task should I do first?")).toEqual(["Personal"]);
  });
});
