import { describe, expect, it } from "vitest";
import { buildLocalSafetyReply, buildOfflineRescueReply, buildRescuePrompt, buildRescueTaskList, filterApplicableRescueActions, parseRescueActionTags } from "./rescueCoachPrompt";

describe("rescueCoachPrompt", () => {
  const tasks = [
    {
      uuid: "now",
      title: "Write grant draft",
      horizonLevel: "today",
      priority: "P1",
      category: "work",
      timeEstimateMinutes: 15,
      concreteStep: "open the outline",
      isNowFocus: true,
    },
    {
      uuid: "later",
      title: "Email Maya",
      horizonLevel: "today",
      priority: "P2",
      timeEstimateMinutes: 5,
    },
    {
      uuid: "week",
      title: "Submit invoice",
      horizonLevel: "week",
      priority: "P2",
    },
  ];

  it("builds a richer task snapshot with metadata and first steps", () => {
    const out = buildRescueTaskList(tasks);
    expect(out).toContain("NOW FOCUS: Write grant draft");
    expect(out).toContain("priority P1");
    expect(out).toContain("15 min");
    expect(out).toContain("first step: open the outline");
    expect(out).toContain("TODAY: Email Maya");
    expect(out).toContain("WEEK: Submit invoice");
  });


  it("excludes parked tasks from rescue snapshots", () => {
    const out = buildRescueTaskList([
      ...tasks,
      { uuid: "parked", title: "Parked backlog item", horizonLevel: "today", isParked: true },
    ]);
    expect(out).not.toContain("Parked backlog item");
  });


  it("does not promote hidden non-Today pinned tasks as Now Focus for Today rescues", () => {
    const out = buildRescueTaskList([
      { uuid: "today", title: "Visible today task", horizonLevel: "today" },
      { uuid: "week-focus", title: "Hidden week focus", horizonLevel: "week", isNowFocus: true },
    ], { entryPoint: "today" });
    expect(out).not.toContain("NOW FOCUS: Hidden week focus");
    expect(out).toContain("TODAY: Visible today task");
    expect(out).toContain("WEEK: Hidden week focus");
  });

  it("uses the active task as Now Focus for Deep Focus rescues even outside Today", () => {
    const out = buildRescueTaskList([
      { uuid: "deep", title: "Deep focus week task", horizonLevel: "week" },
      { uuid: "today", title: "Visible today task", horizonLevel: "today" },
    ], { entryPoint: "deep_focus", focusTask: { uuid: "deep", title: "Deep focus week task", horizonLevel: "week" } });
    expect(out).toContain("NOW FOCUS: Deep focus week task");
  });

  it("includes safety/support-mode instructions for anxious rescue", () => {
    const prompt = buildRescuePrompt({
      reason: "anxious",
      firstName: "Rohan",
      task: tasks[0],
      allTasks: tasks,
      entryPoint: "deep_focus",
    });
    expect(prompt).toContain("SAFETY MODES");
    expect(prompt).toContain("Self-harm/suicide/crisis");
    expect(prompt).toContain("stop productivity coaching");
    expect(prompt).toContain("Opened from an active Deep Focus session");
    expect(prompt).toContain("you may speak as if they were working on that task");
  });

  it("warns Home/Today rescue not to overclaim the selected task", () => {
    const prompt = buildRescuePrompt({
      reason: "distracted",
      firstName: "Rohan",
      task: tasks[0],
      allTasks: tasks,
      entryPoint: "today",
    });
    expect(prompt).toContain("Home/Today tab");
    expect(prompt).toContain("may only be the pinned or first visible Today task");
    expect(prompt).toContain('never say "you were working on..."');
    expect(prompt).toContain("if this is still the right task");
  });

  it("injects profile, memory, persona, and low-energy context", () => {
    const prompt = buildRescuePrompt({
      reason: "tired",
      firstName: "Rohan",
      allTasks: tasks,
      entryPoint: "today",
      config: {
        coachPersona: "direct",
        coachProfileNote: "Works best with very short starts.",
        isLowEnergyMode: true,
        coachMemory: { pinnedFacts: [{ text: "Prefers morning writing." }], recentObservations: [] },
      },
    });
    expect(prompt).toContain("direct and no-nonsense");
    expect(prompt).toContain("Works best with very short starts");
    expect(prompt).toContain("Prefers morning writing");
    expect(prompt).toContain("Low Energy Mode enabled");
  });

  it("can suppress memory context while still keeping the user-authored profile", () => {
    const prompt = buildRescuePrompt({
      reason: "overwhelmed",
      firstName: "Rohan",
      allTasks: tasks,
      config: {
        coachProfileNote: "Needs low-pressure language.",
        coachMemory: { pinnedFacts: [{ text: "This memory should stay out." }], recentObservations: [] },
      },
      includeMemory: false,
    });
    expect(prompt).toContain("Needs low-pressure language");
    expect(prompt).not.toContain("This memory should stay out");
  });


  it("parses and strips safe rescue action tags", () => {
    const { cleanText, actions } = parseRescueActionTags("I’ll start a short timer now. [[RESCUE_START_TIMER:5]] [[RESCUE_SET_NOW_FOCUS]]");
    expect(cleanText).toBe("I’ll start a short timer now.");
    expect(actions).toEqual([
      { type: "RESCUE_START_TIMER", minutes: 5 },
      { type: "RESCUE_SET_NOW_FOCUS" },
    ]);
  });

  it("plain conversational replies do not produce rescue actions", () => {
    const { cleanText, actions } = parseRescueActionTags("I’m here. Let’s take one breath first.");
    expect(cleanText).toBe("I’m here. Let’s take one breath first.");
    expect(actions).toEqual([]);
  });

  it("ignores invalid timer action tags", () => {
    const { cleanText, actions } = parseRescueActionTags("Timer maybe. [[RESCUE_START_TIMER:not-a-number]]");
    expect(cleanText).toBe("Timer maybe.");
    expect(actions).toEqual([]);
  });

  describe("filterApplicableRescueActions", () => {
    const setNowFocus = { type: "RESCUE_SET_NOW_FOCUS" };
    const parkTask = { type: "RESCUE_PARK_TASK" };
    const startTimer = { type: "RESCUE_START_TIMER", minutes: 5 };

    it("applies a mutating action when the user's message actually asked for it", () => {
      const { applicable, suppressedForSync } = filterApplicableRescueActions(
        [setNowFocus], { lastUserText: "yes, let's focus on this now" }
      );
      expect(applicable).toEqual([setNowFocus]);
      expect(suppressedForSync).toBe(false);
    });

    it("drops a mutating action the user's message never asked for (echoed/hallucinated tag)", () => {
      const { applicable, suppressedForSync } = filterApplicableRescueActions(
        [setNowFocus, parkTask], { lastUserText: "haha ok thanks" }
      );
      expect(applicable).toEqual([]);
      expect(suppressedForSync).toBe(false);
    });

    it("drops PARK_TASK unless the message asks to park/defer/skip it", () => {
      const { applicable } = filterApplicableRescueActions([parkTask], { lastUserText: "let's park this for later" });
      expect(applicable).toEqual([parkTask]);
      const blocked = filterApplicableRescueActions([parkTask], { lastUserText: "I'll do it now" });
      expect(blocked.applicable).toEqual([]);
    });

    it("always allows RESCUE_START_TIMER through regardless of message or sync state", () => {
      const { applicable, suppressedForSync } = filterApplicableRescueActions(
        [startTimer], { lastUserText: "haha ok thanks", cloudSyncUnconfirmed: true }
      );
      expect(applicable).toEqual([startTimer]);
      expect(suppressedForSync).toBe(false);
    });

    it("blocks mutating actions outright when cloud sync is unconfirmed, even with matching intent", () => {
      const { applicable, suppressedForSync } = filterApplicableRescueActions(
        [setNowFocus], { lastUserText: "let's focus on this now", cloudSyncUnconfirmed: true }
      );
      expect(applicable).toEqual([]);
      expect(suppressedForSync).toBe(true);
    });

    it("only reports suppressedForSync when a mutation was actually blocked for that reason", () => {
      const { suppressedForSync } = filterApplicableRescueActions(
        [setNowFocus], { lastUserText: "haha ok thanks", cloudSyncUnconfirmed: false }
      );
      expect(suppressedForSync).toBe(false);
    });
  });

  describe("rescue scenario regression coverage", () => {
    it("keeps tired + Low Energy Mode focused on low-energy framing and small tasks", () => {
      const prompt = buildRescuePrompt({
        reason: "tired",
        firstName: "Rohan",
        allTasks: [
          { uuid: "tiny", title: "Send short reply", horizonLevel: "today", timeEstimateMinutes: 5, concreteStep: "open inbox" },
          { uuid: "large", title: "Write full proposal", horizonLevel: "today", timeEstimateMinutes: 90 },
        ],
        config: { isLowEnergyMode: true },
      });

      expect(prompt).toContain("Low Energy Mode enabled");
      expect(prompt).toContain("Validate that low-energy mode is real");
      expect(prompt).toContain("Prefer tasks with small time estimates or concrete first steps");
      expect(prompt).toContain("Send short reply");
      expect(prompt).toContain("5 min");
      expect(prompt).toContain("first step: open inbox");
    });

    it("blocks overclaiming in Today distracted rescue but allows active-task wording in Deep Focus", () => {
      const todayPrompt = buildRescuePrompt({
        reason: "distracted",
        firstName: "Rohan",
        task: tasks[0],
        allTasks: tasks,
        entryPoint: "today",
      });
      expect(todayPrompt).toContain('never say "you were working on..."');
      expect(todayPrompt).toContain("do not claim they were working on the selected task");
      expect(todayPrompt).toContain("ask if it is still the right task");

      const deepFocusPrompt = buildRescuePrompt({
        reason: "distracted",
        firstName: "Rohan",
        task: tasks[0],
        allTasks: tasks,
        entryPoint: "deep_focus",
      });
      expect(deepFocusPrompt).toContain("The user was focusing on");
      expect(deepFocusPrompt).toContain("you may speak as if they were working on that task");
      expect(deepFocusPrompt).toContain("re-anchor them to the active task");
    });

    it("grounds first instead of inventing a task when overwhelmed with no reliable context", () => {
      const prompt = buildRescuePrompt({
        reason: "overwhelmed",
        firstName: "Rohan",
        task: null,
        allTasks: [],
        entryPoint: "today",
      });

      expect(prompt).toContain("no active visible task");
      expect(prompt).toContain("Start with grounding or clarification, not task certainty");
      expect(prompt).toContain("If there is no reliable task, ground first and ask what feels most urgent");
      expect(prompt).toContain("Do not solve the whole list");
    });

    it("does not fire local safety fallback for ordinary anxious avoidance", () => {
      expect(buildLocalSafetyReply("I don't want to start this", "Rohan")).toBeNull();
      expect(buildLocalSafetyReply("I feel anxious and frozen", "Rohan")).toBeNull();
      expect(buildLocalSafetyReply("I might hurt myself", "Rohan")).toContain("emergency services");
      expect(buildLocalSafetyReply("I have chest pain and can't breathe", "Rohan")).toContain("medical help");
    });
  });

  it("uses local safety fallback before productivity-oriented offline replies", () => {
    expect(buildLocalSafetyReply("I might hurt myself", "Rohan")).toContain("emergency services");
    expect(buildLocalSafetyReply("I have chest pain and can't breathe", "Rohan")).toContain("medical help");
    expect(buildOfflineRescueReply("distracted", "Rohan", "I might hurt myself")).toContain("emergency services");
  });

  it("returns rescue-state-specific offline replies", () => {
    expect(buildOfflineRescueReply("tired", "Rohan")).toContain("low energy");
    expect(buildOfflineRescueReply("distracted", "Rohan")).toContain("no shame");
  });
});
