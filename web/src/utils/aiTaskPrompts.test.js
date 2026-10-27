import { describe, expect, it } from "vitest";
import { buildSplitRequest, buildBreakdownRequest, buildAskAIRequest, buildOrganizeRequest } from "./aiTaskPrompts";

// #603: the four task-writing prompts moved out of their screens unchanged. These
// pin what each screen sends, so a later prompt fix is a visible, deliberate change.
describe("AI task-writing requests", () => {
  it("Split sends only the title, 2-4 steps of 45 minutes or less", () => {
    const r = buildSplitRequest({ title: "Plan the team offsite", timeEstimateMinutes: 90 });
    expect(r.maxTokens).toBe(250);
    expect(r.systemPrompt).toBe("You split tasks into concrete steps. Respond ONLY with a valid JSON array, no markdown.");
    expect(r.messages).toEqual([{ role: "user", content: 'Split this task into 2-4 concrete steps, each 45 minutes or less, together about 90 minutes.\n\nTask: "Plan the team offsite"\n\nReturn ONLY a JSON array like [{"text":"Collect the latest figures","minutes":30}]. Each text under 10 words. minutes is one of 10, 15, 20, 25, 30, 45.' }]);
    expect(buildSplitRequest({ title: "x" }).messages[0].content).toContain("together about 60 minutes");
  });

  it("Break-down sends the title, the concrete step and the estimate", () => {
    const r = buildBreakdownRequest({ title: "Write the report", concreteStep: "Open the doc" });
    expect(r.maxTokens).toBe(200);
    expect(r.messages[0].content).toContain('Task: "Write the report"\nConcrete step: "Open the doc"\nTime estimate: 25 minutes');
  });

  it("Ask AI lists only open tasks and adds patterns from 5 tasks on", () => {
    const tasks = [
      { title: "Open one", priority: "P2" },
      { title: "Done one", priority: "P1", isCompleted: true },
      { title: "Gone one", priority: "P3", isDeleted: true },
    ];
    const r = buildAskAIRequest({ title: "  call the plumber ", challengeType: "initiation", tasks, profile: { totalTasks: 4 } });
    const text = r.messages[0].content;
    expect(r.maxTokens).toBe(350);
    expect(text).toContain('The user typed this rough task idea: "call the plumber".');
    expect(text).toContain("freezes before starting despite knowing what to do");
    expect(text).toContain("Their current tasks for context: [P2] Open one\n");
    expect(text).not.toContain("User's task patterns");
    const withProfile = buildAskAIRequest({ title: "x", tasks: [], profile: { totalTasks: 5, completionRate: 0.5, dominantHorizon: "week", avgEstimateMinutes: 30 } });
    expect(withProfile.messages[0].content).toContain('completion rate 50%, dominant horizon "week", avg estimate 30min');
    expect(withProfile.messages[0].content).toContain("Their current tasks for context: none yet");
  });

  it("Organize numbers each thought with its id and keeps the detail rule", () => {
    const r = buildOrganizeRequest({ items: [{ id: "a1", text: "Email Sam about the 12 June invoice" }, { id: "b2", text: "dentist" }] });
    expect(r.maxTokens).toBe(4000);
    expect(r.reasoningEffort).toBe("low");
    expect(r.systemPrompt).toContain("Preserve every concrete detail from the input");
    expect(r.messages[0].content).toContain("1. [id:a1] Email Sam about the 12 June invoice\n2. [id:b2] dentist\n");
  });
});
