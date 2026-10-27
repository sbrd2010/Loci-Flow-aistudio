import { describe, expect, it } from "vitest";
import { TASK_AI_PATHS, taskAiRequest, parseTaskAiReply, gradeTaskAi } from "./taskAiEval";
import { TASK_AI_CASES } from "./taskAiCases.fixture";
import { buildLocalSafetyReply } from "./crisisSafety";

const vitamins = TASK_AI_CASES.find(c => c.id === "emoji");

describe("task-writing evaluation (#603)", () => {
  it("builds each screen's request for a case", () => {
    for (const path of TASK_AI_PATHS) {
      const r = taskAiRequest(path, vitamins);
      expect(r.messages[0].content, path).toContain("vitamins B12");
    }
  });

  it("reads replies the way each screen does, null when the screen falls back", () => {
    expect(parseTaskAiReply("split", '[{"text":"Open Amazon","minutes":10},{"text":"Add B12","minutes":10}]')).toEqual(["Open Amazon", "Add B12"]);
    expect(parseTaskAiReply("split", '[{"text":"Only one","minutes":10}]')).toBeNull();
    const five = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ text: `Step ${i}`, minutes: 45 })));
    expect(parseTaskAiReply("split", five, 60)).toBeNull();
    expect(parseTaskAiReply("split", five, 240)).toBeNull();
    expect(parseTaskAiReply("split", five, 200)).toHaveLength(5);
    expect(parseTaskAiReply("breakdown", '```json\n["Open the site", "Search B12"]\n```')).toEqual(["Open the site", "Search B12"]);
    expect(parseTaskAiReply("askAI", 'Sure: {"title":"Order B12","microStep":"Open Amazon","subSteps":[{"text":"zinc"}]}')).toEqual(["Order B12", "Open Amazon", "zinc"]);
    expect(parseTaskAiReply("organize", '[{"sourceId":"t1","title":"Order B12 on Amazon","horizonLevel":"week","priority":"P3","concreteStep":"Open Amazon"}]')).toContain("Order B12 on Amazon");
    expect(parseTaskAiReply("organize", "no json here")).toBeNull();
  });

  it("fails an invented object, a dropped detail and an ungrounded reply", () => {
    expect(gradeTaskAi("split", ["Browse Amazon for coffee machines", "Order the vitamins"], vitamins).reasons).toContain("invented /coffee|espresso|caf(?:e|é)/");
    expect(gradeTaskAi("askAI", ["Order vitamins", "Open Amazon"], vitamins).reasons).toEqual(expect.arrayContaining(["dropped /B12/"]));
    expect(gradeTaskAi("breakdown", ["Open the app", "Tap the button"], vitamins).reasons).toContain("not grounded in the title");
    expect(gradeTaskAi("split", ["Open Amazon and search vitamins", "Order B12 and D3"], vitamins).verdict).toBe("pass");
    expect(gradeTaskAi("split", null, vitamins).reasons[0]).toMatch(/fallback/);
  });

  it("grades what the user would see: stand-alone Split steps, odd spaces, short names", () => {
    const refund = TASK_AI_CASES.find(c => c.id === "refund");
    const tom = TASK_AI_CASES.find(c => c.id === "vague");
    // Each Split step becomes its own task, so a step that doesn't name the task fails.
    expect(gradeTaskAi("split", ["Find the refund receipt", "Send email and set reminder"], refund).reasons).toContain("a step doesn't name the task");
    expect(gradeTaskAi("breakdown", ["Find the refund receipt", "Send email and set reminder"], refund).verdict).toBe("pass");
    expect(gradeTaskAi("askAI", ["Chase the laptop battery refund by Apr\u202f30", "Open the shop's refund form"], refund).verdict).toBe("pass");
    expect(gradeTaskAi("organize", ["Email Chase support about the refund by 30 April"], refund).reasons[0]).toMatch(/^invented/);
    expect(gradeTaskAi("breakdown", ["Message Tom to ask what's pending"], tom).verdict).toBe("pass");  });

  it("has a crisis-like case every screen answers on the device", () => {
    for (const c of TASK_AI_CASES.filter(x => x.local)) expect(buildLocalSafetyReply(c.title, "Sam")).toBeTruthy();
  });
});
