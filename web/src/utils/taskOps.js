// Pure helper for the task-completion toggle — extracted for unit-testability.
// TodayTab.handleToggleComplete uses this to build the updated task array.
export function buildToggleCompletedTasks(tasks, taskUuid, isCompleting, dateStr) {
  return tasks.map((t) =>
    t.uuid === taskUuid
      ? {
          ...t,
          isCompleted: isCompleting,
          isNowFocus: false,
          dateCompletedString: isCompleting ? dateStr : null,
          lastUpdated: Date.now(),
        }
      : t
  );
}
