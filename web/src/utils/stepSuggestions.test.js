import { describe, it, expect, vi, beforeEach } from "vitest";

const callAI = vi.fn();
vi.mock("./aiCall", async (orig) => ({
  ...(await orig()),
  callAI: (...args) => callAI(...args),
  hasAIKey: () => true,
  getAIKeys: () => ({ groqKey: "k" }),
}));

const { suggestSteps } = await import("./stepSuggestions");

describe("suggestSteps", () => {
  beforeEach(() => callAI.mockReset());

  // Codex review of #418: a repeat within one answer is offered once.
  it("offers each step once: not one the task has, nor a repeat in the answer", async () => {
    callAI.mockResolvedValue(JSON.stringify(["Open the file", "Write a line", "write a line ", "Send it", "Send it"]));
    const res = await suggestSteps({ title: "Draft" }, [{ id: "a", text: "open the file" }]);
    expect(res).toEqual({ steps: ["Write a line", "Send it"] });
  });

  it("fails when nothing new is left", async () => {
    callAI.mockResolvedValue(JSON.stringify(["Open the file"]));
    expect(await suggestSteps({ title: "Draft" }, [{ id: "a", text: "Open the file" }])).toEqual({ error: "failed" });
  });
});
