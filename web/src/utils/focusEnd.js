import { moveToTomorrow } from "./dayMapPlan";
import { applyStepsPatch, stepsPatch, taskSteps } from "./taskSteps";
import { safeUUID } from "./uuid";

// End session (59h), after the session itself has ended: "Where did you
// stop?" becomes the task's next step, ahead of the steps still open; "End
// and move to tomorrow" moves the task there. Shared by the focus page and
// the focus bar (59e). Returns { tasks, before } — before is what Undo puts
// back after a move — or null when there is nothing to write.
//
// The note is kept to 300 characters: it is stored as concreteStep, which the
// database caps there, and a longer one would have the whole write refused
// (Codex review of #432).
export function endSessionTasks(tasks, task, { note = "", tomorrow = false, tomorrowStr, now = Date.now(), makeId = safeUUID } = {}) {
  if (!task) return null;
  const step = String(note || "").trim().slice(0, 300);
  if (!step && !tomorrow) return null;
  let next = step ? withNextStep(tasks, task, step, { now, makeId }) : tasks;
  let before = null;
  if (tomorrow) ({ tasks: next, before } = moveToTomorrow(next, [String(task.uuid || task.id)], tomorrowStr, now));
  return { tasks: next, before };
}

// A step put ahead of the steps still open, as the next one: where you stopped
// (59h), or a smaller step when stuck (59d). Kept to 300 characters, as above.
export function withNextStep(tasks, task, text, { now = Date.now(), makeId = safeUUID } = {}) {
  const step = String(text || "").trim().slice(0, 300);
  if (!task || !step) return tasks;
  const steps = taskSteps(task);
  const at = steps.findIndex(st => !st.done);
  const next = [...steps];
  next.splice(at === -1 ? steps.length : at, 0, { id: makeId(), text: step, done: false });
  return tasks.map(t => (t.uuid === task.uuid ? applyStepsPatch(t, stepsPatch(t, next), now) : t));
}

// I'm stuck → Switch to the next task (59d): the next task becomes the one
// thing, and this one returns to the top of Today's list.
export function switchToNextTasks(tasks, task, next, now = Date.now()) {
  if (!task || !next || next.uuid === task.uuid) return tasks;
  const top = Math.min(0, ...tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted).map(t => Number(t.orderIndex) || 0)) - 1;
  return tasks.map(t => {
    if (t.uuid === task.uuid) return { ...t, isNowFocus: false, orderIndex: top, lastUpdated: now };
    if (t.uuid === next.uuid) return { ...t, isNowFocus: true, lastUpdated: now };
    if (t.isNowFocus) return { ...t, isNowFocus: false, lastUpdated: now };
    return t;
  });
}
