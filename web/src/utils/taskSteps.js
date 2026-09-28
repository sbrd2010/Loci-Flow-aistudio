// A task's steps, as the sheet shows and edits them (52): the first step is
// step 1 of STEPS, not a field of its own. The model still stores
// `concreteStep` (Focus, the wall and Coach read it), so every write through
// here keeps it equal to steps[0].
//
// A task from before this rule may carry a concreteStep and no steps. It is
// shown as step 1, and becomes a real step the first time the steps change.

const PLACEHOLDER = "Do first tiny step";
export const FIRST_STEP_ID = "first-step";

export function taskSteps(task) {
  const steps = Array.isArray(task?.subSteps) ? task.subSteps : [];
  if (steps.length) return steps;
  const first = typeof task?.concreteStep === "string" ? task.concreteStep.trim() : "";
  return first && first !== PLACEHOLDER ? [{ id: FIRST_STEP_ID, text: first, done: false }] : [];
}

// The patch that stores `steps` and keeps the first step in step. With no
// steps left the first step goes too (it is omitted, not emptied).
export function stepsPatch(task, steps) {
  const patch = { subSteps: steps };
  if (steps.length) patch.concreteStep = steps[0].text;
  else if (task?.concreteStep) patch.concreteStep = undefined;
  return patch;
}

// Apply a patch from stepsPatch to a task: an undefined concreteStep removes
// the key rather than storing undefined.
export function applyStepsPatch(task, patch, now = Date.now()) {
  const next = { ...task, ...patch, lastUpdated: now };
  if (next.concreteStep === undefined) delete next.concreteStep;
  return next;
}
