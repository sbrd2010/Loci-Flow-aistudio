import { describe, it, expect } from "vitest";
import { stuckStepLabels } from "./StuckSheet";

// I'm stuck in Focus mode: "Make the step smaller" only makes sense when there
// is a step. A task with none asks for a first one; with all done, the next.
describe("stuckStepLabels", () => {
  it("offers to make the open step smaller", () => {
    expect(stuckStepLabels("Open the inbox", true)).toEqual({ button: "Make the step smaller", field: "A smaller step" });
  });
  it("asks for a first step when the task has none", () => {
    expect(stuckStepLabels(undefined, false)).toEqual({ button: "Write a first step", field: "A first step" });
  });
  it("asks for the next step when every step is done", () => {
    expect(stuckStepLabels(undefined, true)).toEqual({ button: "Write the next step", field: "The next step" });
  });
});
