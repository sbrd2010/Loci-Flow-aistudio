// A task's steps, as the sheet shows and edits them (52): the first step is
// step 1 of STEPS, not a field of its own. The model still stores
// `concreteStep` (Focus, Coach and Scattered read it as the next action), so
// every write through here keeps it equal to the first step not yet done —
// and removes it once every step is done.
//
// A task from before this rule may carry a concreteStep as its own first
// action, with or without steps after it (Add task and Mind Box write both).
// Unless one of the steps already is it, it is shown as step 1, and becomes a
// real step the first time the steps change — never dropped by that write.

import { safeUUID } from "./uuid";

const PLACEHOLDER = "Do first tiny step";
export const FIRST_STEP_ID = "first-step";

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function taskSteps(task) {
  const steps = Array.isArray(task?.subSteps) ? task.subSteps : [];
  const first = typeof task?.concreteStep === "string" ? task.concreteStep.trim() : "";
  if (!first || first === PLACEHOLDER || steps.some(st => typeof st?.text === "string" && same(st.text, first))) return steps;
  return [{ id: FIRST_STEP_ID, text: first, done: false }, ...steps];
}

// The patch that stores `steps` and keeps the next action in step: the first
// step not yet done. With none left open it goes (omitted, not emptied). A
// first step shown from the old field is stored with an id of its own.
export function stepsPatch(task, steps) {
  const patch = { subSteps: steps.map(st => (st.id === FIRST_STEP_ID ? { ...st, id: safeUUID() } : st)) };
  const next = steps.find(st => !st.done && st.text);
  if (next) patch.concreteStep = next.text;
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
