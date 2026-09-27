import React from "react";
import { dayProgress, formatClock24, formatSpan } from "../utils/dayMapPlan";
import { currentDayMinutes, getEstimate, getTaskId, useDayRoute } from "../hooks/useDayRoute";
import DayClockBar from "./DayClockBar";
import "../styles/dayMap.css";

// Today's third column from 1600px (50k–l): the Day map, read-only and
// compact. How far over the day is, the day clock, the route's stops with the
// DAY ENDS line where it falls, and "Move N to tomorrow". A stop opens that
// task; the heading opens the Day map itself, where the route is edited.
export default function DayMapColumn({ payload, savePayload, onOpenDayMap, onOpenTask, onMoveToTomorrow }) {
  const { windows, scheduledTasks, plan } = useDayRoute({ payload, savePayload });

  const progress = dayProgress(new Date(), windows);
  const nowMins = currentDayMinutes(windows);
  const overIndex = plan.overIndex;
  const fitting = overIndex === -1 ? scheduledTasks : scheduledTasks.slice(0, overIndex);
  const lastFitting = fitting[fitting.length - 1];
  const fitEnd = lastFitting ? Number(lastFitting.dayMapStartMinutes) + getEstimate(lastFitting) : null;
  const free = fitEnd == null ? 0 : plan.dayEnd - fitEnd;
  const wontFitMinutes = plan.wontFit.reduce((sum, t) => sum + getEstimate(t), 0);
  // The one thing is never moved from here: a session on it is Today's to end.
  const movable = plan.wontFit.filter(t => !t.isNowFocus);

  const stop = (task, index) => {
    const start = Number(task.dayMapStartMinutes ?? 0);
    const isNow = index === 0 && start <= nowMins + 15;
    const isOver = overIndex !== -1 && index >= overIndex;
    const duration = getEstimate(task);
    return (
      <li key={getTaskId(task)}>
        <button
          type="button"
          className={`tdm-stop${isNow ? " is-now" : ""}${isOver ? " is-over" : ""}`}
          aria-label={`${isNow ? "Now" : formatClock24(start)} to ${formatClock24(start + duration)}, ${task.title}${isOver ? ", after the day ends" : ""}`}
          onClick={() => onOpenTask(task)}
        >
          <span className="tdm-time">{isNow ? "NOW" : formatClock24(start)}</span>
          <span className="tdm-title">{task.title}</span>
          <span className="tdm-dur">{formatSpan(duration)}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className="today-daymap" aria-label="Day map" data-flip-column="">
      <div className="tdm-head">
        <h2 className="tdm-heading">
          <button type="button" className="tdm-open" onClick={onOpenDayMap}>Day map</button>
        </h2>
        {scheduledTasks.length > 0 && (
          plan.overBy > 0
            ? <span className="tdm-status is-over">{formatSpan(plan.overBy)} over</span>
            : <span className="tdm-status">{formatSpan(plan.planned)} / {formatSpan(plan.dayLeft)}</span>
        )}
      </div>
      {progress && <div className="tdm-clock"><DayClockBar progress={progress} /></div>}

      {scheduledTasks.length === 0 ? (
        <p className="tdm-empty">
          Nothing on the route yet.{" "}
          <button type="button" className="tdm-empty-link" onClick={onOpenDayMap}>Lay out the day</button>
        </p>
      ) : (
        <>
          <ol className="tdm-route" aria-label="Today's route">
            {fitting.map((t, i) => stop(t, i))}
          </ol>
          <p className="tdm-dayend">
            <span>DAY ENDS {formatClock24(plan.dayEnd)}{free > 0 ? ` · ${formatSpan(free)} FREE` : ""}</span>
          </p>
          {plan.wontFit.length > 0 && (
            <>
              <h3 className="tdm-wontfit">WON’T FIT TODAY · {formatSpan(wontFitMinutes)}</h3>
              <ol className="tdm-route" aria-label="Won't fit today">
                {plan.wontFit.map((t, i) => stop(t, overIndex + i))}
              </ol>
            </>
          )}
          {movable.length > 0 && (
            <button type="button" className="tdm-move" onClick={() => onMoveToTomorrow(movable.map(getTaskId))}>
              Move {movable.length} to tomorrow
            </button>
          )}
        </>
      )}
    </aside>
  );
}
