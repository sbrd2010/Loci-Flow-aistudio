import { describe, expect, it } from "vitest";
import { buildReasoningInstruction, stripReasoningTag } from "./coachReasoning";

describe("buildReasoningInstruction", () => {
  it("instructs the model to write a hidden THINK block that is never shown", () => {
    const instruction = buildReasoningInstruction("Alex");
    expect(instruction).toContain("[[THINK:");
    expect(instruction).toContain("never shown");
    expect(instruction).toContain("State:");
    expect(instruction).toContain("Relevant:");
    expect(instruction).toContain("Angle:");
    expect(instruction).toContain("Alex");
  });
});

describe("stripReasoningTag", () => {
  it("removes a multi-line THINK block from the start of the text", () => {
    const raw = `[[THINK:
- State: feeling stuck on a deadline.
- Relevant: deadline is due tomorrow.
- Angle: suggest the smallest next step.
]]
Hey, let's tackle that deadline together.`;
    expect(stripReasoningTag(raw)).toBe("Hey, let's tackle that deadline together.");
  });

  it("returns the text unchanged (trimmed) when no THINK block is present", () => {
    expect(stripReasoningTag("Hey, how's it going?")).toBe("Hey, how's it going?");
    expect(stripReasoningTag("  Hey, how's it going?  ")).toBe("Hey, how's it going?");
  });

  it("handles THINK content containing a single ']'", () => {
    const raw = `[[THINK:
- State: user said "done]" earlier.
- Relevant: nothing specific.
- Angle: confirm and move on.
]]
Got it, marked as done.`;
    expect(stripReasoningTag(raw)).toBe("Got it, marked as done.");
  });
});
