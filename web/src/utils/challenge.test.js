import { describe, expect, it } from "vitest";
import { CHALLENGES, challengeCoachLine, challengeDescription, normalizeChallenge } from "./challenge";
import { buildAskAIRequest } from "./aiTaskPrompts";
import { buildCoachSystemPrompt } from "./coachSystemPrompt";

describe("What helps you most (#656)", () => {
  it("maps every stored value, old or new, to exactly one choice", () => {
    for (const [stored, want] of [
      ["overplanner", "overplanner"], ["initiation", "initiation"], ["momentum", "momentum"], ["overwhelmed", "overwhelmed"],
      ["starting", "initiation"], ["focusing", "momentum"], ["execution", "overplanner"], ["tracking", "overwhelmed"],
    ]) {
      expect(normalizeChallenge(stored), stored).toBe(want);
      expect(CHALLENGES.filter(c => c.value === normalizeChallenge(stored)), stored).toHaveLength(1);
      expect(challengeDescription(stored), stored).toBe(CHALLENGES.find(c => c.value === want).description);
    }
  });

  it("nothing chosen stays not set, never a default", () => {
    for (const stored of [undefined, null, "", "something-else"]) {
      expect(normalizeChallenge(stored), String(stored)).toBeNull();
      expect(challengeDescription(stored), String(stored)).toBeNull();
    }
  });

  it("subtitles promise only what the choice does", () => {
    for (const c of CHALLENGES) {
      expect(c.sub).toMatch(/^Coach and Ask AI /);
      expect(c.sub.toLowerCase()).not.toMatch(/streak|reset tools|up front/);
    }
  });

  it("Ask AI gets the same sentence as Coach, and none when not set", () => {
    const withChoice = buildAskAIRequest({ title: "write the intro", challengeType: "starting", tasks: [] });
    expect(JSON.stringify(withChoice)).toContain(challengeDescription("initiation"));
    const without = buildAskAIRequest({ title: "write the intro", challengeType: undefined, tasks: [] });
    expect(JSON.stringify(without)).not.toMatch(/core challenge/i);
  });

  it("Coach gets its short line for the same choice, and no challenge line when not set, in every prompt mode", () => {
    const base = { mentorName: "Coach", firstName: "Sam", userName: "Sam" };
    for (const mode of ["full_task", "compact_task", "light", "emotional", "profile_reflection"]) {
      const set = buildCoachSystemPrompt(mode, { ...base, challengeLabel: challengeCoachLine("overwhelmed") });
      const unset = buildCoachSystemPrompt(mode, { ...base, challengeLabel: challengeCoachLine(undefined) });
      if (/core challenge/i.test(set)) expect(set, mode).toContain(challengeCoachLine("overwhelmed"));
      expect(unset, mode).not.toMatch(/core challenge/i);
      expect(unset, mode).not.toMatch(/null|undefined"/);
    }
    expect(buildCoachSystemPrompt("full_task", { ...base, challengeLabel: challengeCoachLine("starting") }))
      .toContain(`Core challenge: "${challengeCoachLine("initiation")}"`);
  });

  // Coach's full-task turn sits close to Groq's free-tier limit
  // (coachPromptBudget.test.js), so its line stays short; Ask AI has room.
  it("Coach's lines stay short; every choice has one; no internal labels", () => {
    for (const c of CHALLENGES) {
      expect(c.coach.length, c.value).toBeLessThanOrEqual(50);
      expect(`${c.coach} ${c.description}`, c.value).not.toMatch(/\bP[1-4]\b/);
    }
    expect(challengeCoachLine(null)).toBeNull();
  });
});
