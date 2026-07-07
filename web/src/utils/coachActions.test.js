import { describe, it, expect } from "vitest";
import { parseCoachActionTags, findTaskByTitle, buildSetNowFocusTasks, buildParkTaskTasks, applyCoachActions, matchesUserIntent, buildActionReplyText, inferTaskMetadata } from "./coachActions";
import { parseCheckinTag } from "./coachCheckin";
import { getFocusWindows, getLociDayStr } from "./focusWindows";
import { getLocalDateString } from "./lociAIContext";

describe("inferTaskMetadata", () => {
  it("infers Career for a CV/job-application title", () => {
    expect(inferTaskMetadata("update my CV for job applications")).toEqual({ category: "Career", priority: "P3" });
  });

  it("infers Career for a recruiter-call title", () => {
    expect(inferTaskMetadata("prepare for recruiter call")).toEqual({ category: "Career", priority: "P3" });
  });

  it("infers Health for a dentist title", () => {
    expect(inferTaskMetadata("call dentist")).toEqual({ category: "Health", priority: "P3" });
  });

  it("infers Work for a manager-report title", () => {
    expect(inferTaskMetadata("prepare report for manager")).toEqual({ category: "Work", priority: "P3" });
  });

  it("defaults to Personal when nothing matches", () => {
    expect(inferTaskMetadata("buy milk")).toEqual({ category: "Personal", priority: "P3" });
  });

  it("infers Health and bumps priority to P1 for an urgent appointment", () => {
    expect(inferTaskMetadata("urgent blood test appointment")).toEqual({ category: "Health", priority: "P1" });
  });

  it("does not bump priority for non-urgent titles", () => {
    expect(inferTaskMetadata("schedule a checkup")).toEqual({ category: "Health", priority: "P3" });
  });

  it("infers Career for plural job-application/cover-letter phrasing with no other cue", () => {
    expect(inferTaskMetadata("submit job applications")).toEqual({ category: "Career", priority: "P3" });
    expect(inferTaskMetadata("draft cover letters")).toEqual({ category: "Career", priority: "P3" });
  });

  it("does not bump priority when urgency is explicitly negated", () => {
    expect(inferTaskMetadata("email landlord, not urgent")).toEqual({ category: "Personal", priority: "P3" });
    expect(inferTaskMetadata("non-urgent: water the plants")).toEqual({ category: "Personal", priority: "P3" });
    expect(inferTaskMetadata("water the plants, not right away")).toEqual({ category: "Personal", priority: "P3" });
    expect(inferTaskMetadata("not really urgent at all, water the plants")).toEqual({ category: "Personal", priority: "P3" });
  });

  it("prefers a stronger Career/Work cue over a generic appointment keyword", () => {
    expect(inferTaskMetadata("prepare for recruiter appointment")).toEqual({ category: "Career", priority: "P3" });
    expect(inferTaskMetadata("client appointment")).toEqual({ category: "Work", priority: "P3" });
  });
});

describe("parseCoachActionTags", () => {
  it("returns no actions and the original text when no tag is present", () => {
    expect(parseCoachActionTags("Start with the report.")).toEqual({ cleanText: "Start with the report.", actions: [] });
  });

  it("extracts a SET_NOW_FOCUS tag and strips it from the end", () => {
    expect(parseCoachActionTags("Switching your focus now.\n[[SET_NOW_FOCUS:Write report]]")).toEqual({
      cleanText: "Switching your focus now.",
      actions: [{ type: "SET_NOW_FOCUS", title: "Write report" }],
    });
  });

  it("extracts a COMPLETE_TASK tag and strips it from the end", () => {
    expect(parseCoachActionTags("Nice work!\n[[COMPLETE_TASK:Email client]]")).toEqual({
      cleanText: "Nice work!",
      actions: [{ type: "COMPLETE_TASK", title: "Email client" }],
    });
  });

  it("is case-insensitive on the tag name", () => {
    expect(parseCoachActionTags("Done.\n[[complete_task:Email client]]")).toEqual({
      cleanText: "Done.",
      actions: [{ type: "COMPLETE_TASK", title: "Email client" }],
    });
  });

  it("strips a tag in the middle of the text", () => {
    expect(parseCoachActionTags("Before. [[SET_NOW_FOCUS:Write report]] After.")).toEqual({
      cleanText: "Before. After.",
      actions: [{ type: "SET_NOW_FOCUS", title: "Write report" }],
    });
  });

  it("extracts multiple tags in order", () => {
    expect(parseCoachActionTags("Marking it done and switching focus.\n[[COMPLETE_TASK:Email client]]\n[[SET_NOW_FOCUS:Write report]]")).toEqual({
      cleanText: "Marking it done and switching focus.",
      actions: [
        { type: "COMPLETE_TASK", title: "Email client" },
        { type: "SET_NOW_FOCUS", title: "Write report" },
      ],
    });
  });

  it("extracts an ADD_TASK tag", () => {
    expect(parseCoachActionTags("Added it!\n[[ADD_TASK:Call the dentist]]")).toEqual({
      cleanText: "Added it!",
      actions: [{ type: "ADD_TASK", title: "Call the dentist" }],
    });
  });

  it("extracts a PARK_TASK tag", () => {
    expect(parseCoachActionTags("Parked it.\n[[PARK_TASK:Write report]]")).toEqual({
      cleanText: "Parked it.",
      actions: [{ type: "PARK_TASK", title: "Write report" }],
    });
  });

  it("extracts a START_FOCUS tag", () => {
    expect(parseCoachActionTags("Starting now!\n[[START_FOCUS:Write report]]")).toEqual({
      cleanText: "Starting now!",
      actions: [{ type: "START_FOCUS", title: "Write report" }],
    });
  });

  it("extracts a body-double duration suffix from a START_FOCUS tag", () => {
    expect(parseCoachActionTags("Starting now!\n[[START_FOCUS:Write report|10]]")).toEqual({
      cleanText: "Starting now!",
      actions: [{ type: "START_FOCUS", title: "Write report", durationMinutes: 10 }],
    });
    expect(parseCoachActionTags("[[START_FOCUS:Write report|10 minutes]]").actions).toEqual([
      { type: "START_FOCUS", title: "Write report", durationMinutes: 10 },
    ]);
  });

  it("clamps a START_FOCUS duration suffix to the 5-20 minute range", () => {
    expect(parseCoachActionTags("[[START_FOCUS:Write report|2]]").actions).toEqual([
      { type: "START_FOCUS", title: "Write report", durationMinutes: 5 },
    ]);
    expect(parseCoachActionTags("[[START_FOCUS:Write report|45]]").actions).toEqual([
      { type: "START_FOCUS", title: "Write report", durationMinutes: 20 },
    ]);
  });

  it("allows a single bracket character within a tag title", () => {
    expect(parseCoachActionTags("Added it!\n[[ADD_TASK:Review [Q2] metrics]]")).toEqual({
      cleanText: "Added it!",
      actions: [{ type: "ADD_TASK", title: "Review [Q2] metrics" }],
    });
  });
});

describe("tag-stripping integration", () => {
  it("strips both a CHECKIN_IN tag and a coach action tag from the reply", () => {
    const reply = "Nice work! I'll check on you soon.\n[[CHECKIN_IN:15]]\n[[COMPLETE_TASK:Write report]]";
    const { cleanText: afterCheckin, minutes } = parseCheckinTag(reply);
    const { cleanText, actions } = parseCoachActionTags(afterCheckin);
    expect(minutes).toBe(15);
    expect(cleanText).toBe("Nice work! I'll check on you soon.");
    expect(actions).toEqual([{ type: "COMPLETE_TASK", title: "Write report" }]);
  });
});

describe("findTaskByTitle", () => {
  const tasks = [
    { uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false },
    { uuid: "2", title: "Email the client about invoice", isCompleted: false, isDeleted: false, isParked: false },
    { uuid: "3", title: "Done already", isCompleted: true, isDeleted: false, isParked: false },
  ];

  it("matches exactly, case- and punctuation-insensitive", () => {
    expect(findTaskByTitle(tasks, "write report")).toBe(tasks[0]);
    expect(findTaskByTitle(tasks, "Write Report!")).toBe(tasks[0]);
  });

  it("matches when the tag title is a substring of the task title", () => {
    expect(findTaskByTitle(tasks, "Email the client")).toBe(tasks[1]);
  });

  it("matches when the task title is a substring of the tag title", () => {
    expect(findTaskByTitle(tasks, "Email the client about invoice ASAP")).toBe(tasks[1]);
  });

  it("returns null when nothing matches", () => {
    expect(findTaskByTitle(tasks, "Walk the dog")).toBeNull();
  });

  it("does not substring-match a tiny pronoun-like title (e.g. 'it')", () => {
    expect(findTaskByTitle(tasks, "it")).toBeNull();
  });

  it("still matches an exact short title even though it's below the fuzzy-match length", () => {
    const short = [{ uuid: "1", title: "Gym", isCompleted: false, isDeleted: false, isParked: false }];
    expect(findTaskByTitle(short, "gym")).toBe(short[0]);
  });

  it("returns null for an empty title", () => {
    expect(findTaskByTitle(tasks, "")).toBeNull();
  });

  it("ignores completed tasks", () => {
    expect(findTaskByTitle(tasks, "Done already")).toBeNull();
  });

  it("returns null when multiple active tasks match equally well", () => {
    const ambiguous = [
      { uuid: "1", title: "Email the client about invoice", isCompleted: false, isDeleted: false, isParked: false },
      { uuid: "2", title: "Email the team about invoice", isCompleted: false, isDeleted: false, isParked: false },
    ];
    expect(findTaskByTitle(ambiguous, "Email")).toBeNull();
  });

  it("returns null when multiple active tasks have the same exact title", () => {
    const duplicates = [
      { uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false },
      { uuid: "2", title: "Write report", isCompleted: false, isDeleted: false, isParked: false },
    ];
    expect(findTaskByTitle(duplicates, "Write report")).toBeNull();
  });

  it("matches non-Latin task titles exactly", () => {
    const tasksCJK = [
      { uuid: "1", title: "書類を提出する", isCompleted: false, isDeleted: false, isParked: false },
    ];
    expect(findTaskByTitle(tasksCJK, "書類を提出する")).toBe(tasksCJK[0]);
  });
});

describe("buildSetNowFocusTasks", () => {
  it("pins the target task and unpins any other", () => {
    const tasks = [
      { uuid: "1", title: "A", isNowFocus: true },
      { uuid: "2", title: "B", isNowFocus: false },
    ];
    const result = buildSetNowFocusTasks(tasks, "2", 1000);
    expect(result[0]).toEqual({ uuid: "1", title: "A", isNowFocus: false, lastUpdated: 1000 });
    expect(result[1]).toEqual({ uuid: "2", title: "B", isNowFocus: true, lastUpdated: 1000 });
  });

  it("leaves tasks whose isNowFocus is already correct untouched", () => {
    const other = { uuid: "1", title: "A", isNowFocus: false };
    const target = { uuid: "2", title: "B", isNowFocus: true };
    const result = buildSetNowFocusTasks([other, target], "2", 1000);
    expect(result[0]).toBe(other);
    expect(result[1]).toBe(target);
  });
});

describe("buildParkTaskTasks", () => {
  it("parks the target task and unpins it, leaving others untouched", () => {
    const target = { uuid: "1", title: "A", isParked: false, isNowFocus: true };
    const other = { uuid: "2", title: "B", isParked: false, isNowFocus: false };
    const result = buildParkTaskTasks([target, other], "1", 1000);
    expect(result[0]).toEqual({ uuid: "1", title: "A", isParked: true, isNowFocus: false, lastUpdated: 1000 });
    expect(result[1]).toBe(other);
  });
});

describe("matchesUserIntent", () => {
  it("matches COMPLETE_TASK on completion language", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I just finished the report")).toBe(true);
    expect(matchesUserIntent("COMPLETE_TASK", "Tell me about the report")).toBe(false);
  });

  it("matches SET_NOW_FOCUS on focus/prioritize language", () => {
    expect(matchesUserIntent("SET_NOW_FOCUS", "Focus on the report now")).toBe(true);
    expect(matchesUserIntent("SET_NOW_FOCUS", "What should I do next?")).toBe(false);
  });

  it("does not treat a 'what can I skip' advice question as a PARK_TASK request (Codex review finding)", () => {
    // coachContextMode.js's NEGATION_PRIORITY_RE now routes "what can I skip"
    // advice questions to full_task — without this guard, a bare "skip" here
    // would let the gate treat the model's answer (which names the task
    // being asked about) as authorizing a real park mutation the user never
    // requested.
    expect(matchesUserIntent("PARK_TASK", "what can I skip for the report today?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "should I skip the report?", "the report")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("PARK_TASK", "skip the report for now", "the report")).toBe(true);
  });

  it("still treats a polite 'can/could you skip X' imperative as a PARK_TASK request (Codex review finding)", () => {
    // The advice-question guard above must be scoped to a first-person modal
    // ("can/could/should/would/do I") specifically — a blanket lookbehind on
    // any preceding "can"/"could" would also block a polite command
    // addressed to the coach ("can you skip the report for now?"), which is
    // a genuine mutation request, not advice-seeking.
    expect(matchesUserIntent("PARK_TASK", "can you skip the report for now?", "the report")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "could you skip the report?", "the report")).toBe(true);
  });

  it("still blocks a first-person skip advice question with a small filler word (Codex review finding)", () => {
    // The previous round's guard only excluded an immediately-adjacent
    // "<modal> I skip" — "can I just skip..." / "should I maybe skip..."
    // have a filler word between "I" and "skip" that the guard didn't
    // tolerate, so these advice questions could still authorize a park
    // mutation.
    expect(matchesUserIntent("PARK_TASK", "can I just skip the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "should I maybe skip the report?", "the report")).toBe(false);
    // The polite imperative (addressed to the coach, not advice-seeking) still works.
    expect(matchesUserIntent("PARK_TASK", "can you skip the report for now?", "the report")).toBe(true);
  });

  it("blocks a 'what am I free to skip' advice question from parking a task (Codex review finding)", () => {
    // coachContextMode.js's NEGATION_PRIORITY_RE routes "what am I free to
    // skip" advice questions to full_task, but that phrasing doesn't fit the
    // "<modal> I skip" shape the earlier guard checked for, so a corroborated
    // model reply could still park the named task.
    expect(matchesUserIntent("PARK_TASK", "what am I free to skip, the report?", "the report")).toBe(false);
    // The imperative form still works.
    expect(matchesUserIntent("PARK_TASK", "skip the report, I'm free today", "the report")).toBe(true);
  });

  it("blocks a 'not going to hurt if I skip it' advice question from parking a task (Codex review finding, round 5)", () => {
    // coachContextMode.js's NEGATION_PRIORITY_RE routes "what's not going to
    // hurt if I skip it" advice questions to full_task too, and that phrasing
    // doesn't fit any of the earlier guard shapes.
    expect(matchesUserIntent("PARK_TASK", "what's not going to hurt if I skip it, the report?", "the report")).toBe(false);
    // The imperative form still works.
    expect(matchesUserIntent("PARK_TASK", "skip the report, it's not going to hurt", "the report")).toBe(true);
  });

  it("matches SET_NOW_FOCUS on set/swap/make-my-focus phrasing (Codex review finding)", () => {
    // coachContextMode.js's EXPLICIT_ACTION_RE routes "set/swap my focus to
    // X" and "make X my focus" to full_task, so this gate must recognize the
    // same phrasings — otherwise the model could emit a SET_NOW_FOCUS tag for
    // these that gets silently blocked here while its visible narration
    // ("switched your focus...") still shows.
    expect(matchesUserIntent("SET_NOW_FOCUS", "set my focus to the report", "the report")).toBe(true);
    expect(matchesUserIntent("SET_NOW_FOCUS", "swap my focus to the report", "the report")).toBe(true);
    expect(matchesUserIntent("SET_NOW_FOCUS", "make the report my focus", "the report")).toBe(true);
    expect(matchesUserIntent("SET_NOW_FOCUS", "ok, make the report my focus now", "the report")).toBe(true);
  });

  it("does not treat a 'make X my focus' analysis question as an imperative request (Codex review finding)", () => {
    // "what would make X my focus easier?" is asking for analysis, not
    // commanding a focus change — the deterministic gate must not let this
    // authorize a SET_NOW_FOCUS mutation just because the title is present.
    expect(matchesUserIntent("SET_NOW_FOCUS", "what would make the report my focus easier?", "the report")).toBe(false);
    expect(matchesUserIntent("SET_NOW_FOCUS", "how could I make the report my focus without stress?", "the report")).toBe(false);
  });

  it("does not treat a 'set/swap my focus' question as an imperative request (Codex review finding)", () => {
    // Same class of gap as the "make X my focus" case above, but for the
    // set/swap alternatives — "should I set my focus to X?" is asking for
    // advice, not commanding a change.
    expect(matchesUserIntent("SET_NOW_FOCUS", "should I set my focus to the report?", "the report")).toBe(false);
    expect(matchesUserIntent("SET_NOW_FOCUS", "how can I swap my focus to the report?", "the report")).toBe(false);
    // Imperative phrasing still works.
    expect(matchesUserIntent("SET_NOW_FOCUS", "set my focus to the report", "the report")).toBe(true);
  });

  // Found via live-testing round 3: mirrors the synonym verbs added to
  // coachContextMode.js's EXPLICIT_ACTION_RE — a message needs to pass both
  // that classification check (to reach full_task) and this intent gate (for
  // the resulting tag to actually be applied), so both files needed the
  // same synonyms or a real user's phrasing could still end up silently
  // blocked after successfully reaching full_task.
  it("matches additional completion/add/park/focus action-verb synonyms (live-testing round 3)", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I wrapped up the report", "the report")).toBe(true);
    expect(matchesUserIntent("COMPLETE_TASK", "I knocked out the report", "the report")).toBe(true);
    expect(matchesUserIntent("COMPLETE_TASK", "I crossed the report off my list", "the report")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "jot down call the plumber")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "note down call the plumber")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "I need to remember to call the plumber")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "put off the report", "the report")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "postpone the report", "the report")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "let's dive into the report", "the report")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "time to work on the report", "the report")).toBe(true);
  });

  it("does not treat 'what can I put off/postpone' advice questions as PARK_TASK requests (mirrors PR #340's 'skip' fix)", () => {
    // Once combined with coachContextMode.js's NEGATION_PRIORITY_RE (which
    // routes "what can I put off?" advice questions to full_task), a bare
    // "put off"/"postpone" here would have the same false-authorization risk
    // Codex found for "skip" on PR #340 — fixed proactively with the same
    // question-word lookbehind guard.
    expect(matchesUserIntent("PARK_TASK", "what can i put off?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "should i postpone the report?", "the report")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("PARK_TASK", "put off the report", "the report")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "postpone the report", "the report")).toBe(true);
  });

  it("shares PR #340's fully-refined skip-advice guard (filler words, 'am I free to', 'not going to hurt') with 'postpone'/'put off' (merge reconciliation)", () => {
    // Reconciles a latent inconsistency: this branch previously used its own
    // narrower question-word lookbehind while #340 iterated its "skip" guard
    // through several more rounds (filler-word tolerance, "am I free to",
    // "not going to hurt if I") — merging #340 and #342 together is the
    // point where "postpone"/"put off" now share the exact same refined
    // guard as "skip" instead of drifting further apart.
    expect(matchesUserIntent("PARK_TASK", "can I just postpone the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "what am I free to put off, the report?", "the report")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("PARK_TASK", "can you postpone the report for now?", "the report")).toBe(true);
  });

  it("blocks subject-first and hypothetical postpone/put-off advice framings (Codex review finding, PR #342 round 1)", () => {
    // The original guard only covered interrogative-inversion order
    // ("<modal> I <verb>", e.g. "should I postpone?"). Subject-first order
    // ("I should postpone...") and hypothetical framing ("if I put off...")
    // slipped through.
    expect(matchesUserIntent("PARK_TASK", "do you think I should postpone the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "what would happen if I put off the report?", "the report")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("PARK_TASK", "postpone the report", "the report")).toBe(true);
  });

  it("blocks a 'crossed off' status question from completing a task (Codex review finding, PR #342 round 1)", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "have I crossed the report off my list?", "the report")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "did I cross the report off my list?", "the report")).toBe(false);
    // The genuine statement still works.
    expect(matchesUserIntent("COMPLETE_TASK", "I crossed the report off my list", "the report")).toBe(true);
  });

  it("blocks past-tense/status-question 'jot down'/'note down' phrasing from adding a task (Codex review finding, PR #342 round 1)", () => {
    expect(matchesUserIntent("ADD_TASK", "I already jotted down call the plumber", "call the plumber")).toBe(false);
    expect(matchesUserIntent("ADD_TASK", "where did I note down call the plumber?", "call the plumber")).toBe(false);
    // The genuine imperative phrasing still works.
    expect(matchesUserIntent("ADD_TASK", "jot down call the plumber", "call the plumber")).toBe(true);
  });

  it("blocks a dive-into advice question from starting a focus session (Codex review finding, PR #342 round 1)", () => {
    expect(matchesUserIntent("START_FOCUS", "what should I dive into for work, Write report?", "Write report")).toBe(false);
    // The genuine imperative phrasing still works.
    expect(matchesUserIntent("START_FOCUS", "let's dive into Write report now", "Write report")).toBe(true);
  });

  it("blocks impersonal advice framings ('is it okay to...', 'what happens when I...') from parking a task (Codex review finding, PR #342 round 2)", () => {
    // These don't have a first-person "I <verb>" shape at all, so the
    // modal+I guards from round 1 never matched them.
    expect(matchesUserIntent("PARK_TASK", "what happens when I postpone the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "is it okay to postpone the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "would it be bad to put off the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "does it make sense to postpone the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "when is it okay to put off the report?", "the report")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("PARK_TASK", "postpone the report", "the report")).toBe(true);
  });

  it("blocks permission/advice questions from adding a task via jot/note down (Codex review finding, PR #342 round 2)", () => {
    expect(matchesUserIntent("ADD_TASK", "should I jot down call the plumber?", "call the plumber")).toBe(false);
    expect(matchesUserIntent("ADD_TASK", "can I note down call the plumber somewhere?", "call the plumber")).toBe(false);
    expect(matchesUserIntent("ADD_TASK", "do I need to jot down call the plumber?", "call the plumber")).toBe(false);
    expect(matchesUserIntent("ADD_TASK", "would it help to note down call the plumber?", "call the plumber")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("ADD_TASK", "jot down call the plumber", "call the plumber")).toBe(true);
    // A polite imperative addressed to the coach still works too.
    expect(matchesUserIntent("ADD_TASK", "can you jot down call the plumber?", "call the plumber")).toBe(true);
  });

  it("blocks more question framings ('can I dive into...', 'is now a good time to...') from starting a focus session (Codex review finding, PR #342 round 2)", () => {
    expect(matchesUserIntent("START_FOCUS", "can I dive into the report tomorrow?", "the report")).toBe(false);
    expect(matchesUserIntent("START_FOCUS", "is now a good time to work on the report?", "the report")).toBe(false);
    expect(matchesUserIntent("START_FOCUS", "when is it time to work on the report?", "the report")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("START_FOCUS", "let's dive into the report now", "the report")).toBe(true);
  });

  it("blocks status questions from completing a task via wrapped-up/knocked-out (Codex review finding, PR #342 round 2)", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "have I wrapped up the report already?", "the report")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "was the report knocked out yesterday?", "the report")).toBe(false);
    // Genuine statements still work.
    expect(matchesUserIntent("COMPLETE_TASK", "I wrapped up the report", "the report")).toBe(true);
    expect(matchesUserIntent("COMPLETE_TASK", "I knocked out the report", "the report")).toBe(true);
  });

  it("blocks a 'do I need to remember' advice question from adding a task (Codex review finding, PR #342 round 3)", () => {
    expect(matchesUserIntent("ADD_TASK", "do I need to remember to call the plumber?", "call the plumber")).toBe(false);
    // Genuine statement/request still works.
    expect(matchesUserIntent("ADD_TASK", "need to remember to call the plumber", "call the plumber")).toBe(true);
  });

  it("blocks a 'do I have time' availability question from starting a focus session (Codex review finding, PR #342 round 3)", () => {
    expect(matchesUserIntent("START_FOCUS", "do I have time to work on the report?", "the report")).toBe(false);
  });

  it("guards 'shelve' the same as skip/postpone/put off against advice questions (Codex review finding, PR #342 round 3)", () => {
    // "shelve" was previously in the unguarded group.
    expect(matchesUserIntent("PARK_TASK", "can I shelve the report?", "the report")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "is it okay to shelve the report?", "the report")).toBe(false);
    // Genuine imperative phrasing still works.
    expect(matchesUserIntent("PARK_TASK", "shelve the report", "the report")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "can you shelve the report for now?", "the report")).toBe(true);
  });

  it("excludes passive/idiomatic wrapped-up-in/knocked-out-by/crossed-my-mind/put-off-by phrases (Codex review finding, PR #342 round 3)", () => {
    // These idioms mean busy/exhausted/an idea occurring/feeling discouraged
    // — not a task completion or park request.
    expect(matchesUserIntent("COMPLETE_TASK", "I'm wrapped up in the report", "the report")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "I'm knocked out by the report", "the report")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "it crossed my mind to take Friday off", "Friday")).toBe(false);
    expect(matchesUserIntent("PARK_TASK", "I'm put off by the report", "the report")).toBe(false);
  });

  it("blocks unqualified past-tense 'I jotted/noted down' statements from adding a task (Codex review finding, PR #342 round 3)", () => {
    // The user is reporting they captured it elsewhere already, not asking
    // the coach to add it.
    expect(matchesUserIntent("ADD_TASK", "I jotted down call the plumber", "call the plumber")).toBe(false);
    expect(matchesUserIntent("ADD_TASK", "I noted down call the plumber", "call the plumber")).toBe(false);
    // The imperative form (no subject, or addressed to the coach) still works.
    expect(matchesUserIntent("ADD_TASK", "jot down call the plumber", "call the plumber")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "can you jot down call the plumber?", "call the plumber")).toBe(true);
  });

  it("preserves 'could/would you' polite requests for the new verb synonyms (Codex review finding, PR #342 round 3)", () => {
    // The loose question-word window previously blocked "could you"/"would
    // you" the same as "could I"/"would I" — these words also form a polite
    // command when followed by "you", so the guard needs immediate "I"
    // adjacency instead of a loose window.
    expect(matchesUserIntent("START_FOCUS", "could you dive into the report?", "the report")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "could you postpone the report?", "the report")).toBe(true);
  });

  it("normalizes shorthand before intent matching, same as coachContextMode's classifier (Codex review finding)", () => {
    // "remind me 2 call the plumber" reaches full_task via coachContextMode's
    // normalizer, but without the same normalization here, this gate would
    // see the raw "2" (not "to") and block the resulting ADD_TASK tag.
    expect(matchesUserIntent("ADD_TASK", "yo remind me 2 call the plumber", "Call the plumber")).toBe(true);
  });

  it("matches START_FOCUS on body-double language without start/focus wording", () => {
    expect(matchesUserIntent("START_FOCUS", "can you sit with me while I work on Write report", "Write report")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "be my body double for Write report", "Write report")).toBe(true);
  });

  it("matches START_FOCUS on start+session language", () => {
    expect(matchesUserIntent("START_FOCUS", "Let's start a focus session")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "Focus on the report")).toBe(false);
  });

  it("matches ADD_TASK on add/remind/need language", () => {
    expect(matchesUserIntent("ADD_TASK", "Add a task to call the dentist")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "What's on my list?")).toBe(false);
  });

  it("matches ADD_TASK on 'add X to my list' / 'put X on my list' phrasing", () => {
    expect(matchesUserIntent("ADD_TASK", "add Call dentist to my Today list")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "put Call dentist on my list")).toBe(true);
  });

  it("matches PARK_TASK on park/defer language", () => {
    expect(matchesUserIntent("PARK_TASK", "Park the report for now")).toBe(true);
    expect(matchesUserIntent("PARK_TASK", "Tell me about the report")).toBe(false);
  });

  it("returns false for an unknown action type", () => {
    expect(matchesUserIntent("NOT_A_REAL_ACTION", "I just finished the report")).toBe(false);
  });

  it("returns false for an empty or missing message", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK")).toBe(false);
  });

  it("does not match COMPLETE_TASK on negated completion language", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I'm not done with the report")).toBe(false);
  });

  it("does not match COMPLETE_TASK when negation is several words before the completion word", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "Don't mark Write report complete", "Write report")).toBe(false);
  });

  it("does not match PARK_TASK on negated park language", () => {
    expect(matchesUserIntent("PARK_TASK", "Don't park the report")).toBe(false);
  });

  it("still matches ADD_TASK on 'don't forget' phrasing", () => {
    expect(matchesUserIntent("ADD_TASK", "Don't forget to call mom")).toBe(true);
  });

  it("matches ADD_TASK on 'don't forget' with a curly/smart apostrophe (Codex review finding)", () => {
    // coachContextMode.js's classifier already accepted both apostrophe
    // forms for this phrase — this gate didn't, so a curly apostrophe
    // (common on mobile keyboards) reached full_task but had its resulting
    // tag silently blocked here.
    expect(matchesUserIntent("ADD_TASK", "don’t forget to call the plumber", "Call the plumber")).toBe(true);
  });

  it("does not match ADD_TASK on a plain 'I need to' statement with no add/remind request", () => {
    expect(matchesUserIntent("ADD_TASK", "I need to call the dentist at some point")).toBe(false);
  });

  it("does not match COMPLETE_TASK on a generic 'done for today' statement", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I'm done for today")).toBe(false);
  });

  it("does not match COMPLETE_TASK on a question about past completions", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "What have I done today?")).toBe(false);
  });

  it("requires the tag's title to be mentioned in the message for task-targeted actions", () => {
    expect(matchesUserIntent("SET_NOW_FOCUS", "Focus on the report now", "Write report")).toBe(true);
    expect(matchesUserIntent("SET_NOW_FOCUS", "Focus on the report now", "Email client")).toBe(false);
  });

  it("requires the tag's title to be corroborated for ADD_TASK too", () => {
    expect(matchesUserIntent("ADD_TASK", "Add a task to call the dentist", "Call the dentist")).toBe(true);
    expect(matchesUserIntent("ADD_TASK", "Add a task to call the dentist", "Buy groceries")).toBe(false);
  });

  it("scans past an earlier negated match to find a later, unnegated completion request", () => {
    expect(matchesUserIntent("COMPLETE_TASK", "I'm not done with Write report, but I finished Email client", "Email client")).toBe(true);
  });

  it("allows current-focus references when the target is the actual current focus task", () => {
    expect(matchesUserIntent("START_FOCUS", "start current focus", "Write report", [], "Write report")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "start now focus", "Write report", [], "Write report")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "start now focus", "Email client", [], "Write report")).toBe(false);
  });

  it("allows a no-task-named body-double request to fall back to the current Now Focus task", () => {
    // "be my body double for 15 minutes" names neither the task nor "now focus" —
    // it should still resolve against whatever the current Now Focus task is.
    expect(matchesUserIntent("START_FOCUS", "be my body double for 15 minutes", "Write report", [], "Write report")).toBe(true);
    expect(matchesUserIntent("START_FOCUS", "be my body double for 15 minutes", "Email client", [], "Write report")).toBe(false);
    expect(matchesUserIntent("START_FOCUS", "be my body double for 15 minutes", "Write report", [], null)).toBe(false);
  });

  it("does not corroborate a title match on shared stopwords alone", () => {
    // "the", "your", etc. appear in almost every title and almost every
    // message — titleMentionedInMessage must ignore them, or a generic "I'm
    // done with the task" (naming no task at all) would falsely corroborate
    // completing whatever task happens to be Now Focus, purely because its
    // title also contains "the".
    const title = "Reply to the important message sitting in your inbox";
    expect(matchesUserIntent("COMPLETE_TASK", "I'm done with the task", title, [], title)).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "I am done with the task", "Reach out to 2 people - clients, collaborators, or connections")).toBe(false);
    // A message that genuinely names the task still matches.
    expect(matchesUserIntent("COMPLETE_TASK", "I finished replying to the important message", title)).toBe(true);
  });

  it("does not let a title made entirely of stopwords bypass the corroboration gate unconditionally", () => {
    // Excluding stopwords from the "significant word" check must not regress
    // into the opposite bug: a title whose only length->=3 word(s) are ALL
    // stopwords (e.g. "Just Do It" -> only "just" survives length filtering,
    // and "just" is itself a stopword) would otherwise leave zero significant
    // words, and titleMentionedInMessage treats "zero significant words" as
    // an unconditional pass — letting ANY message satisfying the bare intent
    // pattern corroborate this task regardless of what was actually said.
    const title = "Just Do It";
    expect(matchesUserIntent("COMPLETE_TASK", "I'm done with the laundry", title, [], title)).toBe(false);
    // A verbatim mention of the whole title still corroborates.
    expect(matchesUserIntent("COMPLETE_TASK", "I finished Just Do It", title)).toBe(true);
  });

  it("does not let a fallback to the title's own generic words reopen the same loophole (Codex review finding)", () => {
    // My first fix fell back to the title's unfiltered words when every
    // significant word was a stopword — but a title like "New Task" then
    // falls back to ["new","task"], and "task" is common enough that ANY
    // generic completion message ("I'm done with the task") would still
    // falsely corroborate it. Only a verbatim whole-title mention should
    // count for these all-stopword titles.
    expect(matchesUserIntent("COMPLETE_TASK", "I'm done with the task", "New task", [], "New task")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "I'm done with the task", "Day off", [], "Day off")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "I'm done with the task", "Get out", [], "Get out")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "finally finished my new task", "New task")).toBe(true);
  });

  it("requires whole-word boundaries for the all-stopword-title verbatim match (Codex review finding)", () => {
    // A raw substring check would let "get out" match inside "get output",
    // and "new task" match inside "new taskboard" — neither actually names
    // the task.
    expect(matchesUserIntent("COMPLETE_TASK", "I finished get output from the build", "Get out", [], "Get out")).toBe(false);
    expect(matchesUserIntent("COMPLETE_TASK", "finished the new taskboard setup", "New task", [], "New task")).toBe(false);
    // A genuine whole-word mention still matches.
    expect(matchesUserIntent("COMPLETE_TASK", "finished, time to get out of here", "Get out", [], "Get out")).toBe(true);
  });
});

describe("applyCoachActions", () => {
  const dateOpts = { lociDateStr: "2026-06-13", localDateStr: "2026-06-13" };

  it("SET_NOW_FOCUS pins the matched task", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "SET_NOW_FOCUS", title: "Email client" }], { ...dateOpts, lastUserMessage: "Let's focus on Email client now." });
    expect(next.tasks.find(t => t.uuid === "2").isNowFocus).toBe(true);
    expect(next.tasks.find(t => t.uuid === "1").isNowFocus).toBe(false);
    // results.task reflects the post-mutation task (isNowFocus now true), not
    // the pre-mutation snapshot — callers like CoachTab's focus-timer launcher
    // read fields (e.g. timeEstimateMinutes) that this action may have just updated.
    expect(results).toEqual([{ type: "SET_NOW_FOCUS", title: "Email client", matched: true, task: next.tasks.find(t => t.uuid === "2") }]);
  });

  it("COMPLETE_TASK marks the task done, awards XP, and increments today's contribution", () => {
    const payload = {
      userId: "user-1",
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: true, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: { totalXp: 100 },
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "I just finished writing the report." });
    expect(next.tasks[0].isCompleted).toBe(true);
    expect(next.tasks[0].isNowFocus).toBe(false);
    expect(next.tasks[0].dateCompletedString).toBe("2026-06-13");
    expect(next.config.totalXp).toBe(200);
    expect(next.contributions).toEqual([
      expect.objectContaining({ dateString: "2026-06-13", count: 1, userId: "user-1" }),
    ]);
    expect(results[0].matched).toBe(true);
  });

  it("COMPLETE_TASK increments an existing contribution entry for today", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [{ dateString: "2026-06-13", count: 2 }],
    };
    const { payload: next } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "Done with the report!" });
    expect(next.contributions).toEqual([expect.objectContaining({ dateString: "2026-06-13", count: 3 })]);
  });

  it("COMPLETE_TASK with a pronoun-like title ('it') does not complete an unrelated task", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: { totalXp: 100 },
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "it" }], { ...dateOpts, lastUserMessage: "I finished it." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "COMPLETE_TASK", title: "it", matched: false }]);
  });

  it("returns matched: false and leaves the payload untouched when no task matches", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Walk the dog" }], { ...dateOpts, lastUserMessage: "Just finished walking the dog." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "COMPLETE_TASK", title: "Walk the dog", matched: false }]);
  });

  it("ADD_TASK appends a new Today task with sensible defaults", () => {
    const payload = {
      userId: "user-1",
      tasks: [
        { uuid: "1", title: "Existing", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist." });
    expect(next.tasks).toHaveLength(2);
    const added = next.tasks[1];
    expect(added).toMatchObject({
      title: "Call the dentist",
      horizonLevel: "today",
      priority: "P3",
      timeEstimateMinutes: 25,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex: 1,
      userId: "user-1",
    });
    expect(added.uuid).toBeTruthy();
    expect(results).toEqual([{ type: "ADD_TASK", title: "Call the dentist", matched: true }]);
  });

  it("PARK_TASK parks the matched task and unpins it", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: true, isParked: false, isCompleted: false, isDeleted: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "PARK_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "Let's park the report for now." });
    expect(next.tasks[0].isParked).toBe(true);
    expect(next.tasks[0].isNowFocus).toBe(false);
    expect(results[0].matched).toBe(true);
  });

  it("START_FOCUS pins the matched task as Now Focus", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: true, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "START_FOCUS", title: "Write report" }], { ...dateOpts, lastUserMessage: "Let's start a focus session on the report." });
    expect(next.tasks.find(t => t.uuid === "1").isNowFocus).toBe(true);
    expect(next.tasks.find(t => t.uuid === "2").isNowFocus).toBe(false);
    expect(results[0].matched).toBe(true);
    expect(results[0].task.uuid).toBe("1");
  });

  it("START_FOCUS with a body-double duration carries it on the result without touching the task's own time estimate", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false, timeEstimateMinutes: 60 },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(
      payload,
      [{ type: "START_FOCUS", title: "Write report", durationMinutes: 10 }],
      { ...dateOpts, lastUserMessage: "Sit with me for 10 minutes while I write the report." },
    );
    expect(next.tasks[0].isNowFocus).toBe(true);
    // The task's real time estimate (e.g. for planning totals, Today cards,
    // Focus Briefing) must survive a body-double session unrelated to it.
    expect(next.tasks[0].timeEstimateMinutes).toBe(60);
    expect(results[0].matched).toBe(true);
    expect(results[0].task.timeEstimateMinutes).toBe(60);
    // The session duration itself is on the result (spread from the action)
    // for the caller's timer launcher to use directly.
    expect(results[0].durationMinutes).toBe(10);
  });

  it("applies multiple actions in order: completing the Now Focus task, then pinning the next one", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: true, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next } = applyCoachActions(payload, [
      { type: "COMPLETE_TASK", title: "Write report" },
      { type: "SET_NOW_FOCUS", title: "Email client" },
    ], { ...dateOpts, lastUserMessage: "I finished the report, now focus on Email client." });
    expect(next.tasks.find(t => t.uuid === "1").isCompleted).toBe(true);
    expect(next.tasks.find(t => t.uuid === "2").isNowFocus).toBe(true);
  });

  it("completes the task named in a later, unnegated clause even when an earlier clause negates a different task", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [
      { type: "COMPLETE_TASK", title: "Email client" },
    ], { ...dateOpts, lastUserMessage: "I'm not done with Write report, but I finished Email client." });
    expect(next.tasks.find(t => t.uuid === "2").isCompleted).toBe(true);
    expect(next.tasks.find(t => t.uuid === "1").isCompleted).toBe(false);
    expect(results[0].matched).toBe(true);
  });

  it("blocks an action and leaves the payload untouched when the user's message doesn't request it", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "SET_NOW_FOCUS", title: "Write report" }], { ...dateOpts, lastUserMessage: "How's it going?" });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "SET_NOW_FOCUS", title: "Write report", matched: false, blocked: true }]);
  });

  it("blocks an action whose tag title doesn't match the task the user named", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false },
      ],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "SET_NOW_FOCUS", title: "Email client" }], { ...dateOpts, lastUserMessage: "Let's focus on Write report now." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "SET_NOW_FOCUS", title: "Email client", matched: false, blocked: true }]);
  });

  it("blocks ADD_TASK when the tag's title doesn't match the task the user described", () => {
    const payload = { tasks: [], config: {}, contributions: [] };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Buy groceries" }], { ...dateOpts, lastUserMessage: "Add Call dentist to my list." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "Buy groceries", matched: false, blocked: true }]);
  });

  it("blocks ADD_TASK with a short (3-letter) title that doesn't match the task the user described", () => {
    const payload = { tasks: [], config: {}, contributions: [] };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Gym" }], { ...dateOpts, lastUserMessage: "Add Tax to my list." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "Gym", matched: false, blocked: true }]);
  });

  it("COMPLETE_TASK on an already-completed task is a no-op (idempotent)", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isCompleted: true, isDeleted: false, isParked: false, dateCompletedString: "2026-06-12" },
      ],
      config: { totalXp: 100 },
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { ...dateOpts, lastUserMessage: "I'm done with the report" });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "COMPLETE_TASK", title: "Write report", matched: false }]);
  });

  it("START_FOCUS does not match a completed, deleted, or parked task", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Write report", isNowFocus: false, isCompleted: true, isDeleted: false, isParked: false },
        { uuid: "2", title: "Email client", isNowFocus: false, isCompleted: false, isDeleted: true, isParked: false },
        { uuid: "3", title: "Plan trip", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: true },
      ],
      config: {},
      contributions: [],
    };
    for (const title of ["Write report", "Email client", "Plan trip"]) {
      const { payload: next, results } = applyCoachActions(payload, [{ type: "START_FOCUS", title }], { ...dateOpts, lastUserMessage: `Let's start a focus session on ${title}.` });
      expect(next).toBe(payload);
      expect(results).toEqual([{ type: "START_FOCUS", title, matched: false }]);
    }
  });

  it("uses the Loci day for dateCompletedString and the local calendar day for contributions across midnight", () => {
    const windows = getFocusWindows({ focusWindows: [{ start: "22:00", end: "04:00" }] });
    const now = new Date(2026, 5, 14, 1, 0); // June 14, 1:00 AM — still the June 13 Loci day
    const lociDateStr = getLociDayStr(now, windows);
    const localDateStr = getLocalDateString(now);
    expect(lociDateStr).toBe("2026-06-13");
    expect(localDateStr).toBe("2026-06-14");

    const payload = {
      userId: "user-1",
      tasks: [{ uuid: "1", title: "Write report", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [],
    };
    const { payload: next } = applyCoachActions(payload, [{ type: "COMPLETE_TASK", title: "Write report" }], { lociDateStr, localDateStr, lastUserMessage: "I'm done with the report" });
    expect(next.tasks[0].dateCompletedString).toBe("2026-06-13");
    expect(next.contributions).toEqual([expect.objectContaining({ dateString: "2026-06-14" })]);
  });

  it("ADD_TASK rejects an empty or whitespace-only title", () => {
    const payload = { tasks: [], config: {}, contributions: [] };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "   " }], { ...dateOpts, lastUserMessage: "Add a task for this." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "   ", matched: false }]);
  });

  it("ADD_TASK truncates an overlong title to 1000 characters", () => {
    const longTitle = "x".repeat(1100);
    const payload = { tasks: [], config: {}, contributions: [] };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: longTitle }], { ...dateOpts, lastUserMessage: `Add a task for ${longTitle}.` });
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].title).toBe("x".repeat(1000));
    expect(results[0].matched).toBe(true);
  });

  it("ADD_TASK is blocked by Evening Guard at or after 8 PM", () => {
    const payload = { tasks: [], config: { eveningGuardWindowActive: true }, contributions: [] };
    const now = new Date(2026, 5, 13, 20, 30).getTime(); // 8:30 PM
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist.", now });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "Call the dentist", matched: false, eveningGuardBlocked: true }]);
  });

  it("ADD_TASK proceeds when Evening Guard is active but it's before 8 PM", () => {
    const payload = { tasks: [], config: { eveningGuardWindowActive: true }, contributions: [] };
    const now = new Date(2026, 5, 13, 19, 30).getTime(); // 7:30 PM
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "Call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist.", now });
    expect(next.tasks).toHaveLength(1);
    expect(results[0].matched).toBe(true);
  });

  it("ADD_TASK skips an obvious duplicate of an existing active task", () => {
    const payload = {
      tasks: [{ uuid: "1", title: "Call the dentist", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false }],
      config: {},
      contributions: [],
    };
    const { payload: next, results } = applyCoachActions(payload, [{ type: "ADD_TASK", title: "call the dentist" }], { ...dateOpts, lastUserMessage: "Add a task to call the dentist." });
    expect(next).toBe(payload);
    expect(results).toEqual([{ type: "ADD_TASK", title: "call the dentist", matched: false }]);
  });
});

describe("full pipeline: stale action tag in a generic follow-up reply", () => {
  const dateOpts = { lociDateStr: "2026-06-13", localDateStr: "2026-06-13" };
  const payload = {
    tasks: [{ uuid: "1", title: "Draft Q3 report", horizonLevel: "week", isNowFocus: false, isCompleted: false, isDeleted: false, isParked: false }],
    config: {},
    contributions: [],
  };

  it("a tag attached to an analysis/suggestion reply is dropped and the suggestion is shown as-is", () => {
    const raw = `"Draft Q3 report" has the nearest deadline — I'd suggest switching your focus there. [[SET_NOW_FOCUS:Draft Q3 report]]`;
    const { cleanText, actions } = parseCoachActionTags(raw);
    const lastUserMessage = "Check all my tasks and suggest.";
    const { payload: next, results } = applyCoachActions(payload, actions, { ...dateOpts, lastUserMessage });
    expect(next).toBe(payload);
    expect(buildActionReplyText(cleanText, results, lastUserMessage)).toBe(cleanText);
  });

  it("a stale tag re-attached to a generic 'No.' reply is dropped, leaving the payload and reply untouched", () => {
    const raw = `No problem — I'll leave things as they are. [[SET_NOW_FOCUS:Draft Q3 report]]`;
    const { cleanText, actions } = parseCoachActionTags(raw);
    const lastUserMessage = "No.";
    const { payload: next, results } = applyCoachActions(payload, actions, { ...dateOpts, lastUserMessage });
    expect(next).toBe(payload);
    expect(buildActionReplyText(cleanText, results, lastUserMessage)).toBe(cleanText);
  });
});

describe("buildActionReplyText", () => {
  it("returns cleanText unchanged when there are no actions", () => {
    expect(buildActionReplyText("Just chatting.", [], "How's it going?")).toBe("Just chatting.");
  });

  it("returns cleanText unchanged when every action matched", () => {
    const results = [{ type: "COMPLETE_TASK", title: "Write report", matched: true, task: { title: "Write report" } }];
    expect(buildActionReplyText("Nice work!", results, "I finished the report")).toBe("Nice work!");
  });

  it("shows cleanText only when a blocked action is stale — the message doesn't ask for that kind of action at all", () => {
    const results = [{ type: "ADD_TASK", title: "Write report", matched: false, blocked: true }];
    expect(buildActionReplyText("Sounds good, let's chat about your day.", results, "How's it going?")).toBe("Sounds good, let's chat about your day.");
  });

  it("returns empty cleanText unchanged when a blocked action is stale and the model wrote nothing else", () => {
    const results = [{ type: "ADD_TASK", title: "Write report", matched: false, blocked: true }];
    expect(buildActionReplyText("", results, "How's it going?")).toBe("");
  });

  it("drops the model's narration and asks which task when the message is action-like but the tag's title didn't match", () => {
    const results = [{ type: "COMPLETE_TASK", title: "Email client", matched: false, blocked: true }];
    expect(buildActionReplyText("Nice work!", results, "I finished the report")).toBe(`Which task should I mark complete?`);
  });

  it("uses the SET_NOW_FOCUS/START_FOCUS clarification when the user asks to focus but the tag's title doesn't match", () => {
    const results = [{ type: "SET_NOW_FOCUS", title: "Write report", matched: false, blocked: true }];
    expect(buildActionReplyText("", results, "Let's focus on something now")).toBe(`Which task should I focus on? Say: "Start focus on [task name]."`);
  });

  it("uses the ADD_TASK clarification when the user asks to add a task but the tag's title doesn't match", () => {
    const results = [{ type: "ADD_TASK", title: "Buy groceries", matched: false, blocked: true }];
    expect(buildActionReplyText("", results, "Add a task to call the dentist")).toBe("What exact task should I add?");
  });

  it("uses the PARK_TASK clarification when the user asks to park something but the tag's title doesn't match", () => {
    const results = [{ type: "PARK_TASK", title: "Write report", matched: false, blocked: true }];
    expect(buildActionReplyText("Sure thing.", results, "Let's park that for now")).toBe(`Which task should I park?`);
  });

  it("dedupes identical clarification notes from multiple blocked actions of related types", () => {
    const results = [
      { type: "SET_NOW_FOCUS", title: "Write report", matched: false, blocked: true },
      { type: "START_FOCUS", title: "Write report", matched: false, blocked: true },
    ];
    expect(buildActionReplyText("", results, "Let's focus on something and start working now")).toBe(`Which task should I focus on? Say: "Start focus on [task name]."`);
  });

  it("reports a not-found task alongside narration for an action that did succeed", () => {
    const results = [
      { type: "COMPLETE_TASK", title: "Write report", matched: true, task: { title: "Write report" } },
      { type: "PARK_TASK", title: "Walk the dog", matched: false },
    ];
    expect(buildActionReplyText("Some narration the model wrote.", results, "I finished the report, and park walk the dog")).toBe(
      `Marked "Write report" complete — +100 XP! I couldn't find "Walk the dog" in your task list — could you double-check the name?`
    );
  });

  it("includes the body-double duration in the START_FOCUS success line", () => {
    const results = [
      { type: "START_FOCUS", title: "Write report", durationMinutes: 10, matched: true, task: { title: "Write report" } },
      { type: "PARK_TASK", title: "Walk the dog", matched: false },
    ];
    expect(buildActionReplyText("Some narration the model wrote.", results, "Sit with me for 10 minutes, and park walk the dog")).toBe(
      `Started a 10-min focus session on "Write report". I couldn't find "Walk the dog" in your task list — could you double-check the name?`
    );
  });

  it("drops contradictory narration when the only action wasn't found, leaving just the note", () => {
    const results = [{ type: "SET_NOW_FOCUS", title: "Report", matched: false }];
    expect(buildActionReplyText("Switching your focus to the report now!", results, "Let's focus on the report")).toBe(
      `I couldn't find "Report" in your task list — could you double-check the name?`
    );
  });

  it("drops contradictory narration when multiple actions aren't found, leaving the combined note", () => {
    const results = [
      { type: "COMPLETE_TASK", title: "Write report", matched: false },
      { type: "PARK_TASK", title: "Walk the dog", matched: false },
    ];
    expect(buildActionReplyText("Done and done!", results, "I finished the report and park walk the dog")).toBe(
      `I couldn't find "Write report" or "Walk the dog" in your task list — could you double-check the name?`
    );
  });

  it("notes a skipped duplicate ADD_TASK and a blocked Evening Guard ADD_TASK", () => {
    const results = [
      { type: "ADD_TASK", title: "Call the dentist", matched: false },
      { type: "ADD_TASK", title: "Buy groceries", matched: false, eveningGuardBlocked: true },
    ];
    expect(buildActionReplyText("", results, "Add Call the dentist and Buy groceries to my list.")).toBe(
      `Looks like that's already on your list, so I didn't add a duplicate. Evening Guard is active, so I didn't add that — feel free to add it again tomorrow.`
    );
  });
});

describe("Coach Action Integrity Constraints (PR #269 Fixes)", () => {
  const dateOpts = { lociDateStr: "2026-06-13", localDateStr: "2026-06-13" };

  it("a) direct add two tasks to Today", () => {
    const payload = { tasks: [], config: {}, contributions: [] };
    const actions = [
      { type: "ADD_TASK", title: "drink water" },
      { type: "ADD_TASK", title: "open laptop" }
    ];
    const { payload: next, results } = applyCoachActions(payload, actions, {
      ...dateOpts,
      lastUserMessage: "Add drink water and open laptop to Today."
    });
    expect(next.tasks).toHaveLength(2);
    expect(next.tasks[0].title).toBe("drink water");
    expect(next.tasks[0].horizonLevel).toBe("today");
    expect(next.tasks[1].title).toBe("open laptop");
    expect(next.tasks[1].horizonLevel).toBe("today");
    expect(results.every(r => r.matched)).toBe(true);
  });

  it("b) add task with clarification: '2 separate'", () => {
    const payload = {
      tasks: [],
      config: {},
      contributions: [],
      chatHistory: [
        { text: "Add drink water and open laptop to Today.", isUser: true },
        { text: "Should I add them as two separate items or one task?", isUser: false }
      ]
    };
    const actions = [
      { type: "ADD_TASK", title: "drink water" },
      { type: "ADD_TASK", title: "open laptop" }
    ];
    const { payload: next, results } = applyCoachActions(payload, actions, {
      ...dateOpts,
      lastUserMessage: "2 separate"
    });
    expect(next.tasks).toHaveLength(2);
    expect(next.tasks[0].title).toBe("drink water");
    expect(next.tasks[1].title).toBe("open laptop");
    expect(results.every(r => r.matched)).toBe(true);
  });

  it("c) 'Can you add more detail?' does not create a task", () => {
    const payload = { tasks: [], config: {}, contributions: [] };
    const actions = [{ type: "ADD_TASK", title: "more detail" }];
    const { payload: next, results } = applyCoachActions(payload, actions, {
      ...dateOpts,
      lastUserMessage: "Can you add more detail?"
    });
    expect(next.tasks).toHaveLength(0);
    expect(results[0].matched).toBe(false);
  });

  it("d) choose one task and set as Now Focus", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Review SHM adhesive layer and send it to Danny", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false }
      ],
      config: {},
      contributions: []
    };
    const actions = [{ type: "SET_NOW_FOCUS", title: "Review SHM adhesive layer and send it to Danny" }];
    const { payload: next, results } = applyCoachActions(payload, actions, {
      ...dateOpts,
      lastUserMessage: "Focus on Review SHM adhesive layer and send it to Danny"
    });
    expect(next.tasks[0].isNowFocus).toBe(true);
    expect(results[0].matched).toBe(true);
  });

  it("e) user says 'Set that as my Now Focus' after Yoda recommends a task (pronoun resolution)", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Review SHM adhesive layer and send it to Danny", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false }
      ],
      config: {},
      contributions: [],
      chatHistory: [
        { text: "I feel scattered. Help me plan today, but don't overwhelm me.", isUser: true },
        { text: "I recommend Review SHM adhesive layer and send it to Danny.", isUser: false }
      ]
    };
    const actions = [{ type: "SET_NOW_FOCUS", title: "Review SHM adhesive layer and send it to Danny" }];
    const { payload: next, results } = applyCoachActions(payload, actions, {
      ...dateOpts,
      lastUserMessage: "Set that as my Now Focus."
    });
    expect(next.tasks[0].isNowFocus).toBe(true);
    expect(results[0].matched).toBe(true);
  });

  it("f) user says 'pin this task to focus now' (verb-less title clarification)", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Review SHM adhesive layer and send it to Danny", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false }
      ],
      config: {},
      contributions: [],
      chatHistory: [
        { text: "I feel scattered. Help me plan today.", isUser: true },
        { text: "Which task should I focus on? Say: 'Start focus on [task name].'", isUser: false }
      ]
    };
    const actions = [{ type: "SET_NOW_FOCUS", title: "Review SHM adhesive layer and send it to Danny" }];
    const { payload: next, results } = applyCoachActions(payload, actions, {
      ...dateOpts,
      lastUserMessage: "pin this task to focus now"
    });
    expect(next.tasks[0].isNowFocus).toBe(true);
    expect(results[0].matched).toBe(true);
  });

  it("g) failed action does not show success confirmation", () => {
    const results = [{ type: "SET_NOW_FOCUS", title: "Non-existing task", matched: false }];
    const cleanText = "All set! I've pinned Non-existing task as your Now Focus.";
    const response = buildActionReplyText(cleanText, results, "Set that task as my Now Focus");
    expect(response).not.toContain("All set");
    expect(response).not.toContain("I've pinned");
    expect(response).toContain("I couldn't find");
  });

  it("h) user wants task mutation but no tag/action executed displays failure note", () => {
    const results = [];
    const cleanText = "All set! I've added a new task to your list.";
    const response = buildActionReplyText(cleanText, results, "Add buy milk to my list");
    expect(response).not.toContain("All set");
    expect(response).toBe("I couldn't save that action yet.");
  });

  it("i) 'Set that as my Now Focus' with multiple tasks and no previous assistant recommendation does not mutate and fails safely", () => {
    const payload = {
      tasks: [
        { uuid: "1", title: "Review SHM adhesive layer and send it to Danny", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false },
        { uuid: "2", title: "Buy groceries", horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false }
      ],
      config: {},
      contributions: [],
      chatHistory: [
        { text: "Just say hello.", isUser: true },
        { text: "Hello! How can I help you today?", isUser: false }
      ]
    };
    const actions = [{ type: "SET_NOW_FOCUS", title: "Review SHM adhesive layer and send it to Danny" }];
    const { payload: next, results } = applyCoachActions(payload, actions, {
      ...dateOpts,
      lastUserMessage: "Set that as my Now Focus."
    });
    expect(next.tasks[0].isNowFocus).toBe(false);
    expect(next.tasks[1].isNowFocus).toBe(false);
    expect(results[0].matched).toBe(false);
    expect(results[0].blocked).toBe(true);

    const cleanText = "All set! I've pinned Review SHM adhesive layer and send it to Danny as your Now Focus.";
    const response = buildActionReplyText(cleanText, results, "Set that as my Now Focus.");
    expect(response).not.toContain("All set");
    expect(response).toContain("Which task should I focus on?");
  });
});
