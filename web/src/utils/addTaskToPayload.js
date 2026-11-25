import { isEveningGuardBlocked } from "./eveningGuard";
import { sameThoughtContent } from "./thoughts";

// #680: Add task's save, built from the live payload (the functional save in
// useSync) rather than the dialog's render, so a change another device made
// while the dialog waited (the notification prompt) is kept.
//   - orderIndex counts the live open tasks of the task's horizon;
//   - a task made from a thought consumes that thought only if it still
//     matches what the dialog was opened from (an edit made elsewhere keeps
//     it; one deleted elsewhere stays deleted);
//   - the live Evening Guard still applies: null means nothing to save;
//   - everything else is the live payload, untouched.
// Pure: `task` (with its uuid and id) and `at` are made by the caller.
export function addTaskToPayload(live, task, { at = new Date(), fromThoughtId = null, sourceThought = null } = {}) {
  if (isEveningGuardBlocked(live.config, at)) return null;
  const tasks = live.tasks || [];
  const orderIndex = tasks.filter(t => t.horizonLevel === task.horizonLevel && !t.isDeleted).length;
  const next = { ...live, tasks: [...tasks, { ...task, orderIndex }] };
  if (fromThoughtId) {
    next.brainDump = (live.brainDump || []).filter(d => d.id !== fromThoughtId || !sameThoughtContent(d, sourceThought));
  }
  return next;
}
