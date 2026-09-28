import { describe, it, expect } from "vitest";
import { taskSteps, stepsPatch, applyStepsPatch, FIRST_STEP_ID } from "./taskSteps";

describe("taskSteps", () => {
  it("returns the task's steps when it has any", () => {
    const steps = [{ id: "a", text: "One", done: false }];
    expect(taskSteps({ subSteps: steps, concreteStep: "Other" })).toBe(steps);
  });
  it("shows an older task's first step as step 1", () => {
    expect(taskSteps({ concreteStep: "  Open the file " })).toEqual([{ id: FIRST_STEP_ID, text: "Open the file", done: false }]);
  });
  it("ignores the placeholder and a missing first step", () => {
    expect(taskSteps({ concreteStep: "Do first tiny step" })).toEqual([]);
    expect(taskSteps({})).toEqual([]);
    expect(taskSteps(null)).toEqual([]);
  });
});

describe("stepsPatch / applyStepsPatch", () => {
  it("keeps the first step equal to step 1", () => {
    const steps = [{ id: "a", text: "Write", done: false }, { id: "b", text: "Send", done: false }];
    expect(stepsPatch({ concreteStep: "Old" }, steps)).toEqual({ subSteps: steps, concreteStep: "Write" });
  });
  it("drops the first step with the last step, as a removed key", () => {
    const task = { uuid: "t", concreteStep: "Old", subSteps: [{ id: "a", text: "Old", done: false }] };
    const patch = stepsPatch(task, []);
    expect(patch).toHaveProperty("concreteStep", undefined);
    const next = applyStepsPatch(task, patch, 5);
    expect(next).toEqual({ uuid: "t", subSteps: [], lastUpdated: 5 });
    expect("concreteStep" in next).toBe(false);
  });
  it("leaves a task with no first step alone", () => {
    expect(stepsPatch({}, [])).toEqual({ subSteps: [] });
  });
});
