import React, { useState } from "react";
import { dayProgress, formatClock24, formatSpan } from "../utils/dayMapPlan";
import { currentDayMinutes, getEstimate, getTaskId, useDayRoute } from "../hooks/useDayRoute";
import DayClockBar from "./DayClockBar";
import DayMapFrom from "./DayMapFrom";
import { IconChevronDown, IconLock, IconPin, IconPlus } from "./ui/icons";
import "../styles/dayMap.css";

// Today's Day map column (54a/c/e): how far over the day is, the route's
// controls (From · Auto-fill · Clear route), the day clock, the route's stops
// with the one thing at NOW and the DAY ENDS line where it falls, "Move N to
// tomorrow", and Unscheduled. A stop opens that task; the heading opens the
// Day map page. Clear route's Undo is Today's (onRouteCleared).
export default function DayMapColumn({ payload, savePayload, onOpenDayMap, onOpenTask, onMoveToTomorrow, onRouteCleared, covered = false }) {
  const {
    windows, scheduledTasks, unscheduledTasks, anchorMinutes, rows, routeTasks, plan,
    setAnchor, addToRoute, autoFill, clearRoute,
  } = useDayRoute({ payload, savePayload });
  const [poolOpen, setPoolOpen] = useState(false);

  const progress = dayProgress(new Date(), windows);
  const nowMins = currentDayMinutes(windows);
  const overIndex = plan.overIndex;
  const fitting = overIndex === -1 ? routeTasks : routeTasks.slice(0, overIndex);
  const lastFitting = fitting[fitting.length - 1];
  // Free from the later of the last stop's end and the route's start: a
  // fixed stop the day has passed ends before now (Codex review of #421).
  const free = lastFitting ? plan.dayEnd - Math.max(lastFitting.routeEndMinutes, plan.dayEnd - plan.dayLeft) : 0;
  const wontFitMinutes = plan.wontFit.reduce((sum, t) => sum + getEstimate(t), 0);
  // The one thing is never moved from here: a session on it is Today's to end.
  const movable = plan.wontFit.filter(t => !t.isNowFocus);
  const routeIndex = new Map(routeTasks.map((t, i) => [getTaskId(t), i]));
  const firstOnTime = rows.find(r => r.kind === "stop" && !r.late);
  // The line falls before the first row of the first stop that won't fit,
  // as on the Day map page.
  const cut = overIndex === -1 ? rows.length
    : rows.findIndex(r => r.kind === "stop" && routeIndex.get(getTaskId(r.task)) >= overIndex);
  const rowIsOver = (r) => rows.indexOf(r) >= cut;

  // The rows as the Day map lays them out (utils/dayMapRoute): stops, the
  // rest of one a break split, the break, free time before a fixed stop.
  const row = (r) => {
    const span = `${formatClock24(r.start)} to ${formatClock24(r.end)}`;
    if (r.kind !== "stop") {
      const title = r.kind === "break" ? r.name : `free ${formatSpan(r.end - r.start)}`;
      return (
        <li key={`${r.kind}:${r.start}${r.added != null ? `:${r.added}` : ""}`} className={`tdm-stop is-${r.kind}`} aria-label={`${span}, ${r.kind === "break" ? r.name : "free"}`}>
          <span className="tdm-time">{formatClock24(r.start)}</span>
          <span className="tdm-title">{title}</span>
          <span className="tdm-dur">{r.kind === "break" ? formatSpan(r.end - r.start) : ""}</span>
        </li>
      );
    }
    const { task } = r;
    const isNow = r === firstOnTime && r.start <= nowMins + 15;
    const isOver = rowIsOver(r);
    // The one thing, at NOW: until the end of its stop (a break splits it).
    const oneThing = isNow && task.isNowFocus && !r.continued;
    const until = oneThing ? routeTasks.find(t => getTaskId(t) === getTaskId(task))?.routeEndMinutes : null;
    return (
      <li key={`${getTaskId(task)}${r.continued ? `:continued:${r.start}` : ""}`}>
        <button
          type="button"
          className={`tdm-stop${isNow ? " is-now" : ""}${oneThing ? " is-one-thing" : ""}${r.late ? " is-late" : ""}${isOver ? " is-over" : ""}`}
          aria-label={`${isNow || r.late ? "Now" : formatClock24(r.start)} to ${formatClock24(r.end)}, ${task.title}`
            + `${oneThing ? ", the one thing" : ""}${r.fixed ? ", fixed time" : ""}${r.continued ? ", continued after the break" : ""}${isOver ? ", after the day ends" : ""}`}
          onClick={() => onOpenTask(task)}
        >
          <span className="tdm-time">{isNow ? "NOW" : r.late ? "now" : formatClock24(r.start)}</span>
          <span className="tdm-title">
            {task.title}{r.continued ? " · continued" : ""}
            {r.fixed && <span className="dm-lock"><IconLock size={13} /></span>}
            {oneThing && (
              <span className="tdm-one-thing"><IconPin size={12} />THE ONE THING · UNTIL {formatClock24(until)}</span>
            )}
          </span>
          <span className="tdm-dur">{formatSpan(r.end - r.start)}</span>
        </button>
      </li>
    );
  };

  return (
    // An open task's drawer takes this column's place (52): hidden, not gone,
    // so Esc can hand focus back to the stop that opened it.
    <aside className={`today-daymap${covered ? " is-covered" : ""}`} aria-label="Day map" data-flip-column="">
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
      {scheduledTasks.length > 0 && (
        <div className="tdm-controls">
          <DayMapFrom anchorMinutes={anchorMinutes} onChangeAnchor={setAnchor} windows={windows} />
          <span className="tdm-controls-end">
            <button type="button" className="dm-text-btn" onClick={autoFill} disabled={!unscheduledTasks.length}>Auto-fill</button>
            <button type="button" className="dm-text-btn" onClick={() => { const before = clearRoute(); if (before) onRouteCleared(before); }}>Clear route</button>
          </span>
        </div>
      )}
      {progress && <div className="tdm-clock"><DayClockBar progress={progress} /></div>}

      {scheduledTasks.length === 0 ? (
        <p className="tdm-empty">
          Nothing on the route yet
          {unscheduledTasks.length > 0
            ? <> · <button type="button" className="tdm-empty-link" onClick={autoFill}>Auto-fill</button></>
            : "."}
        </p>
      ) : (
        <>
          <ol className="tdm-route" aria-label="Today's route">
            {rows.filter(r => !rowIsOver(r)).map(row)}
          </ol>
          <p className="tdm-dayend">
            <span>DAY ENDS {formatClock24(plan.dayEnd)}{free > 0 ? ` · ${formatSpan(free)} FREE` : ""}</span>
          </p>
          {plan.wontFit.length > 0 && (
            <>
              <h3 className="tdm-wontfit">WON’T FIT TODAY · {formatSpan(wontFitMinutes)}</h3>
              <ol className="tdm-route" aria-label="Won't fit today">
                {rows.filter(rowIsOver).map(row)}
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
      {unscheduledTasks.length > 0 && (
        <section className="tdm-pool" aria-label="Unscheduled">
          <button type="button" className="tdm-pool-toggle" aria-expanded={poolOpen} onClick={() => setPoolOpen(o => !o)}>
            <span className="tdm-pool-name">Unscheduled <span className="tdm-pool-count">{unscheduledTasks.length}</span></span>
            <IconChevronDown size={18} />
          </button>
          {poolOpen && (
            <ul className="tdm-pool-list">
              {unscheduledTasks.map(t => (
                <li key={getTaskId(t)} className="tdm-pool-row">
                  <span className="tdm-pool-title">{t.title}</span>
                  <span className="tdm-dur">{formatSpan(getEstimate(t))}</span>
                  <button type="button" className="dm-pool-add" aria-label={`Add to route: ${t.title}`} onClick={() => addToRoute(getTaskId(t))}>
                    <IconPlus size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  );
}
