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
  let next = tasks;
  if (step) {
    const steps = taskSteps(task);
    const at = steps.findIndex(st => !st.done);
    const withNote = [...steps];
    withNote.splice(at === -1 ? steps.length : at, 0, { id: makeId(), text: step, done: false });
    next = tasks.map(t => (t.uuid === task.uuid ? applyStepsPatch(t, stepsPatch(t, withNote), now) : t));
  }
  let before = null;
  if (tomorrow) ({ tasks: next, before } = moveToTomorrow(next, [String(task.uuid || task.id)], tomorrowStr, now));
  return { tasks: next, before };
}
