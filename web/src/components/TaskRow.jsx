import React from "react";

export default function TaskRow({ task, onToggleComplete, onPin, onDelete, onEdit, onMoveUp, onMoveDown }) {
  const { title, concreteStep, priority, isCompleted, isNowFocus } = task;

  return (
    <div className={`task-row ${isCompleted ? "completed" : ""}`}>
      {/* Interactive Custom Checkbox */}
      <div className="checkbox-container" onClick={() => onToggleComplete(task)}>
        <div className={`custom-checkbox ${isCompleted ? "checked" : ""}`}>
          {isCompleted && <span className="checkmark">✓</span>}
        </div>
      </div>

      {/* Task Content */}
      <div className="task-middle">
        <div className="task-row-top">
          <span className={`priority-badge ${priority.toLowerCase()}`}>
            {priority}
          </span>
          <span className="task-title-text" title={title}>
            {title}
          </span>
        </div>
        {concreteStep && (
          <span className="task-step-text" title={concreteStep}>
            ⚡ micro: {concreteStep}
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="task-actions">
        {!isCompleted && (onMoveUp || onMoveDown) && (
          <div className="reorder-btns">
            {onMoveUp && (
              <button className="action-btn-reorder" onClick={() => onMoveUp(task)} title="Move up">↑</button>
            )}
            {onMoveDown && (
              <button className="action-btn-reorder" onClick={() => onMoveDown(task)} title="Move down">↓</button>
            )}
          </div>
        )}
        {!isCompleted && onEdit && (
          <button
            className="action-btn"
            onClick={() => onEdit(task)}
            title="Edit task"
          >
            ✏
          </button>
        )}
        {!isCompleted && onPin && (
          <button
            className={`action-btn action-btn-pin ${isNowFocus ? "active" : ""}`}
            onClick={() => onPin(task)}
            title={isNowFocus ? "Unpin from Focus Block" : "Pin to Focus Block"}
            style={isNowFocus ? { color: "var(--warning)" } : {}}
          >
            {isNowFocus ? "📍" : "📌"}
          </button>
        )}
        <button
          className="action-btn action-btn-delete"
          onClick={() => onDelete(task)}
          title="Soft Delete Task"
        >
          🗑
        </button>
      </div>
    </div>
  );
}
