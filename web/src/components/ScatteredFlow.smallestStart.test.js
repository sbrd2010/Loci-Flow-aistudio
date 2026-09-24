import { describe, it, expect } from "vitest";
import { smallestStart } from "./ScatteredFlow";

describe("smallestStart", () => {
  it("uses the task's own first step", () => {
    expect(smallestStart({ concreteStep: "Open the draft" })).toBe("Open the draft");
  });
  it("skips the old placeholder and an empty step for the first open sub-step", () => {
    const subSteps = [{ text: "Done already", done: true }, { text: "Find the receipt", done: false }];
    expect(smallestStart({ concreteStep: "Do first tiny step", subSteps })).toBe("Find the receipt");
    expect(smallestStart({ concreteStep: "  ", subSteps })).toBe("Find the receipt");
  });
  it("with neither, is still a start: five minutes on it", () => {
    expect(smallestStart({ title: "Tax forms" })).toBe("five minutes on it");
  });
});
