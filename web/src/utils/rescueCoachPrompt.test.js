import { describe, expect, it } from "vitest";
import { buildOfflineRescueReply, buildRescuePrompt, buildRescueTaskList } from "./rescueCoachPrompt";

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

  it("returns rescue-state-specific offline replies", () => {
    expect(buildOfflineRescueReply("tired", "Rohan")).toContain("low energy");
    expect(buildOfflineRescueReply("distracted", "Rohan")).toContain("no shame");
  });
});
