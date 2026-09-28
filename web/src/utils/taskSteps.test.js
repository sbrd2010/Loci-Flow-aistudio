import { describe, it, expect } from "vitest";
import { taskSteps, stepsPatch, applyStepsPatch, FIRST_STEP_ID } from "./taskSteps";

describe("taskSteps", () => {
  it("returns the task's steps when its first step is one of them", () => {
    const steps = [{ id: "a", text: "One", done: false }];
    expect(taskSteps({ subSteps: steps, concreteStep: " one " })).toBe(steps);
    expect(taskSteps({ subSteps: steps })).toBe(steps);
  });
  // Codex review of #418: Add task and Mind Box store the first action apart
  // from the steps after it. It is step 1, not dropped.
  it("puts a first step stored apart from the steps before them", () => {
    const steps = [{ id: "a", text: "Then this", done: true }];
    expect(taskSteps({ subSteps: steps, concreteStep: "Open the file" })).toEqual([
      { id: FIRST_STEP_ID, text: "Open the file", done: false }, ...steps,
    ]);
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
  it("gives a first step shown from the old field an id of its own, keeping it", () => {
    const task = { concreteStep: "Open the file", subSteps: [{ id: "a", text: "Then this", done: false }] };
    const patch = stepsPatch(task, taskSteps(task).map(st => (st.id === "a" ? { ...st, done: true } : st)));
    expect(patch.concreteStep).toBe("Open the file");
    expect(patch.subSteps.map(st => st.text)).toEqual(["Open the file", "Then this"]);
    expect(patch.subSteps[0].id).not.toBe(FIRST_STEP_ID);
    expect(patch.subSteps[0].id).toBeTruthy();
  });

  // Codex review of #418: concreteStep is the next action Focus, Coach and
  // Scattered read, so a step ticked done stops being it.
  it("keeps the next action on the first step not yet done, and drops it when all are done", () => {
    const a = { id: "a", text: "Write", done: true };
    const b = { id: "b", text: "Send", done: false };
    expect(stepsPatch({ concreteStep: "Write" }, [a, b]).concreteStep).toBe("Send");
    const all = stepsPatch({ concreteStep: "Send" }, [a, { ...b, done: true }]);
    expect(all).toHaveProperty("concreteStep", undefined);
    expect(all.subSteps.map(st => st.text)).toEqual(["Write", "Send"]);
    // Its steps still show once, with no step 1 put back from the old field.
    expect(taskSteps(applyStepsPatch({ concreteStep: "Send" }, stepsPatch({ concreteStep: "Write" }, [a, b])))).toEqual([a, b]);
  });

  it("leaves a task with no first step alone", () => {
    expect(stepsPatch({}, [])).toEqual({ subSteps: [] });
  });
});
