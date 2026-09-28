import { useRef, useState } from "react";
import { safeUUID } from "../utils/uuid";
import { celebrate } from "../utils/celebrations";
import { getFocusWindows, getLociDayStr } from "../utils/focusWindows";
import { buildTaskMutationEvent, buildFocusTerminalEvent, eventPatch, eventsPatch } from "../utils/activityLog";

// What a task's sheet does to the task, with the one Undo toast: done, park,
// delete, a step removed, moved to Today, and field edits. Plan's horizons
// and the Day map share it, so a task behaves the same from either.
export default function useTaskActions({ payload, savePayload, savePayloadAsync, uid, writeActivityEvents, focusTimer = {} }) {
  const config = payload?.config || {};
  const windows = getFocusWindows(config);
  // Each action writes from the latest payload: the sheet stays open across
  // saves, so a closure's `tasks` can be a render behind.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const [undo, setUndo] = useState(null);

  const isVisibleRoadmapTask = (t) => !t.isDeleted && !t.isCompleted && !t.isParked;

  const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const incrementContribution = (newContributions, dateStr) => {
    const index = newContributions.findIndex((c) => c.dateString === dateStr);
    const uid = payload.userId || payload.config?.userId || "";
    const compositeKey = `${uid}_${dateStr}`;
    if (index === -1) {
      newContributions.push({ compositeKey, userId: uid, dateString: dateStr, count: 1, lastUpdated: Date.now() });
    } else {
      newContributions[index] = { ...newContributions[index], count: newContributions[index].count + 1, lastUpdated: Date.now() };
    }
    return newContributions;
  };

  const latestTasks = () => payloadRef.current?.tasks || [];
  const patchTask = (uuid, patch) => {
    const latest = payloadRef.current;
    savePayload({ ...latest, tasks: latestTasks().map(t => t.uuid === uuid ? { ...t, ...patch, lastUpdated: Date.now() } : t) });
  };

  const handleMoveToToday = (task) => {
    const todayTasksCount = latestTasks().filter((t) => t.horizonLevel === "today" && isVisibleRoadmapTask(t)).length;
    const event = buildTaskMutationEvent("task_moved", task, {
      fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: "today" }, windows,
    });
    savePayloadAsync({
      ...payloadRef.current,
      tasks: latestTasks().map((t) =>
        t.uuid === task.uuid ? { ...t, horizonLevel: "today", deferredUntil: null, orderIndex: todayTasksCount, lastUpdated: Date.now() } : t
      )
    })
      .then(() => writeActivityEvents(eventPatch(uid, event)))
      .catch(() => {});
    setUndo({ kind: "today", task, at: Date.now() });
  };

  // A horizon change from the sheet's picker. To Today it leaves Plan, so it
  // goes the way Move to Today does, with Undo.
  const handleChangeHorizon = (task, horizon) => {
    if (horizon === "today") { handleMoveToToday(task); return; }
    const event = buildTaskMutationEvent("task_moved", task, {
      fromState: { horizonLevel: task.horizonLevel }, toState: { horizonLevel: horizon }, windows,
    });
    const orderIndex = latestTasks().filter(t => t.horizonLevel === horizon && isVisibleRoadmapTask(t)).length;
    savePayloadAsync({ ...payloadRef.current, tasks: latestTasks().map(t => t.uuid === task.uuid ? { ...t, horizonLevel: horizon, orderIndex, lastUpdated: Date.now() } : t) })
      .then(() => writeActivityEvents(eventPatch(uid, event)))
      .catch(() => {});
  };

  const handleTogglePin = (task) => patchTask(task.uuid, { isHorizonPinned: !task.isHorizonPinned });

  const handlePark = (task) => {
    const now = Date.now();
    const event = buildTaskMutationEvent("task_parked", task, { windows, now });
    // Parking clears isNowFocus: a session running on this task (one started
    // from Coach, say) ends here, recorded, as Done and Delete end theirs.
    const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
      ? focusTimer.endFocusSession("user_abandoned")
      : null;
    savePayloadAsync({ ...payloadRef.current, tasks: latestTasks().map(t => t.uuid === task.uuid ? { ...t, isParked: true, isNowFocus: false, lastUpdated: Date.now() } : t) })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setUndo({ kind: "park", task, wasFocus: !!task.isNowFocus, at: now });
  };

  const handleToggleStep = (task, stepId) => {
    const current = latestTasks().find(t => t.uuid === task.uuid);
    if (!current) return;
    patchTask(task.uuid, { subSteps: (current.subSteps || []).map(st => st.id === stepId ? { ...st, done: !st.done } : st) });
  };
  const handleAddStep = (task, text) => {
    const current = latestTasks().find(t => t.uuid === task.uuid);
    if (!current) return;
    patchTask(task.uuid, { subSteps: [...(current.subSteps || []), { id: safeUUID(), text, done: false }] });
  };
  // A step goes at once, with Undo (52: Undo, not confirm).
  const handleDeleteStep = (task, stepId) => {
    const current = latestTasks().find(t => t.uuid === task.uuid);
    const step = (current?.subSteps || []).find(st => st.id === stepId);
    if (!step) return;
    patchTask(task.uuid, { subSteps: current.subSteps.filter(st => st.id !== stepId) });
    setUndo({ kind: "step", task: current, step, atIndex: current.subSteps.indexOf(step), at: Date.now() });
  };

  const handleMarkDone = (task) => {
    celebrate();
    const actionAt = Date.now();
    const todayDateStr = getTodayDateString();
    const lociTodayStr = getLociDayStr(new Date(), getFocusWindows(config));
    const event = buildTaskMutationEvent("task_completed", task, { windows, now: actionAt });
    // Marking the actively focused task done clears isNowFocus below without
    // ending its session — end it here, same as Today's handleToggleComplete.
    const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
      ? focusTimer.endFocusSession("completed_task")
      : null;
    savePayloadAsync({
      ...payloadRef.current,
      tasks: latestTasks().map((t) =>
        t.uuid === task.uuid ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: lociTodayStr, lastUpdated: Date.now() } : t
      ),
      contributions: incrementContribution([...(payloadRef.current.contributions || [])], todayDateStr)
    })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          // Use endedFocusSession.task, not `task` — if the pin moved to
          // `task` via a path that never ended the PREVIOUS session, this
          // call actually closed out that older session, which may belong to
          // a different task entirely.
          events.push(buildFocusTerminalEvent("focus_completed", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now: actionAt }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setUndo({ kind: "done", task, wasFocus: !!task.isNowFocus, at: actionAt, dateStr: todayDateStr });
  };

  const handleDelete = (task) => {
    const now = Date.now();
    const event = buildTaskMutationEvent("task_deleted", task, { windows, now });
    // Deleting the actively focused task (e.g. one started from Coach)
    // drops it out of activeTask (isDeleted-filtered) without ever
    // clearing isNowFocus itself — end its session here or it's left
    // open with no terminal event.
    const endedFocusSession = task.isNowFocus && typeof focusTimer.endFocusSession === "function"
      ? focusTimer.endFocusSession("user_abandoned")
      : null;
    savePayloadAsync({ ...payloadRef.current, tasks: latestTasks().map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t) })
      .then(() => {
        const events = [event];
        if (endedFocusSession) {
          events.push(buildFocusTerminalEvent("focus_abandoned", endedFocusSession.task, endedFocusSession.focusSessionId, { ...endedFocusSession, windows, now }));
        }
        writeActivityEvents(eventsPatch(uid, events));
      })
      .catch(() => {});
    setUndo({ kind: "delete", task, at: now });
  };

  // Undo puts back only what the action changed, on the task as it is now.
  const handleUndo = () => {
    if (!undo) return;
    const { kind, task } = undo;
    setUndo(null);
    const latest = payloadRef.current;
    const current = latestTasks().find(t => t.uuid === task.uuid);
    if (!current) return;
    const put = (patch, eventType, opts = {}) => {
      const next = { ...latest, ...opts, tasks: latestTasks().map(t => t.uuid === task.uuid ? { ...t, ...patch, lastUpdated: Date.now() } : t) };
      if (!eventType) { savePayload(next); return; }
      const event = buildTaskMutationEvent(eventType, current, { windows, ...(eventType === "task_moved" ? { fromState: { horizonLevel: current.horizonLevel }, toState: { horizonLevel: task.horizonLevel } } : {}) });
      savePayloadAsync(next).then(() => writeActivityEvents(eventPatch(uid, event))).catch(() => {});
    };
    // Park and Done clear the focus flag; Undo gives it back — unless another
    // task has become the one thing since (as Today's Undo does).
    const refocus = undo.wasFocus && !latestTasks().some(t => t.isNowFocus && t.uuid !== task.uuid && !t.isDeleted && !t.isCompleted)
      ? { isNowFocus: true } : {};
    if (kind === "delete" && current.isDeleted) put({ isDeleted: false }, "task_restored");
    else if (kind === "park" && current.isParked) put({ isParked: false, ...refocus });
    else if (kind === "today" && current.horizonLevel === "today") put({ horizonLevel: task.horizonLevel, orderIndex: task.orderIndex, deferredUntil: task.deferredUntil ?? null }, "task_moved");
    else if (kind === "step") {
      // Back where it was; steps added since stay where they are.
      const steps = [...(current.subSteps || [])];
      steps.splice(Math.min(undo.atIndex, steps.length), 0, undo.step);
      put({ subSteps: steps });
    }
    else if (kind === "done" && current.isCompleted) {
      const contributions = [...(latest.contributions || [])];
      const idx = contributions.findIndex(c => c.dateString === undo.dateStr);
      if (idx !== -1 && contributions[idx].count > 0) contributions[idx] = { ...contributions[idx], count: contributions[idx].count - 1, lastUpdated: Date.now() };
      put({ isCompleted: false, dateCompletedString: null, ...refocus }, "task_reopened", { contributions });
    }
  };
  const UNDO_LABELS = { done: "Marked done", delete: "Deleted", park: "Parked", today: "Moved to Today" };
  const undoText = !undo ? "" : undo.kind === "step" ? `Step removed: ${undo.step.text}` : `${UNDO_LABELS[undo.kind]}: ${undo.task.title}`;


  return {
    undo, setUndo, undoText, handleUndo,
    patchTask, handleMoveToToday, handleChangeHorizon, handleTogglePin, handlePark,
    handleToggleStep, handleAddStep, handleDeleteStep, handleMarkDone, handleDelete,
  };
}
