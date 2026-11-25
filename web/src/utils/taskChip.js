import { buildParkTaskTasks, buildSetNowFocusTasks } from "./coachActions";
import { isEventTask } from "./dayMapRoute";
import { isOnToday } from "./deferral";

// #680 Phase 1b: a Coach task chip ("Make it your now task", "Today, as your
// now task", "Move to Today", "Park"), decided at confirm time against the
// live payload rather than the payload of the render that opened the
// confirm dialog: everything else (settings, Mind Box, contributions, chat)
// is the live copy, untouched.
//
// Returns { next, transition } or null for "nothing to do":
//   - the target is gone, deleted or completed (no resurrection, no pinning
//     a finished task);
//   - focus / focus+today on a task at a set time (Q36.3; today and park
//     stay allowed for one, as the chips are drawn);
//   - "focus" on a target no longer on Today: not widened into a move;
//   - the target is already in the chip's state (nothing is restamped).
// `transition` (from the live state before) drives the caller's focus
// session and ledger, applied only once the save is accepted.
// Pure: `now` and `todayStr` are passed in.
export function planTaskChip(live, action, taskUuid, { now, todayStr }) {
  const tasks = live?.tasks || [];
  const target = tasks.find(t => t.uuid === taskUuid && !t.isDeleted);
  if (!target || target.isCompleted) return null;
  const focusing = action === "focus" || action === "focus+today";
  if (focusing && isEventTask(target)) return null;
  const onToday = isOnToday(target, todayStr);
  const other = tasks.find(t => t.uuid !== taskUuid && t.isNowFocus && !t.isDeleted) || null;
  const transition = { task: target, fromHorizon: target.horizonLevel, wasOnToday: onToday, wasParked: !!target.isParked, unpinnedUuid: null };
  let nextTasks;
  if (action === "focus") {
    if (!onToday || target.isNowFocus) return null;
    nextTasks = buildSetNowFocusTasks(tasks, taskUuid, now);
    transition.unpinnedUuid = other?.uuid ?? null;
  } else if (action === "focus+today") {
    if (onToday && target.isNowFocus && !target.isParked) return null;
    const maxOrder = tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted).reduce((m, t) => Math.max(m, t.orderIndex ?? 0), -1);
    nextTasks = tasks.map(t => {
      if (t.uuid === taskUuid) return { ...t, horizonLevel: "today", deferredUntil: null, isNowFocus: true, isParked: false, orderIndex: maxOrder + 1, lastUpdated: now };
      return t.isNowFocus ? { ...t, isNowFocus: false, lastUpdated: now } : t;
    });
    transition.unpinnedUuid = other?.uuid ?? null;
  } else if (action === "today") {
    if (onToday && !target.isParked) return null;
    const maxOrder = tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted).reduce((m, t) => Math.max(m, t.orderIndex ?? 0), -1);
    nextTasks = tasks.map(t => (t.uuid === taskUuid
      ? { ...t, horizonLevel: "today", deferredUntil: null, isNowFocus: false, isParked: false, orderIndex: maxOrder + 1, lastUpdated: now }
      : t));
    transition.unpinnedUuid = target.isNowFocus ? taskUuid : null;
  } else if (action === "park") {
    if (target.isParked) return null;
    nextTasks = buildParkTaskTasks(tasks, taskUuid, now);
    transition.unpinnedUuid = target.isNowFocus ? taskUuid : null;
  } else {
    return null;
  }
  return { next: { ...live, tasks: nextTasks }, transition };
}
