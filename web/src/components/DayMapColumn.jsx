import React, { useState } from "react";
import { formatClock24, formatSpan, formatSpanCaps } from "../utils/dayMapPlan";
import { currentDayMinutes, getEstimate, getTaskId, routeCut } from "../hooks/useDayRoute";
import { eventAsks } from "../utils/fixedTime";
import { laterTodaySlot } from "../utils/dayMapBreaks";
import { mergeWindowSpans } from "../utils/focusWindows";
import DayMapFrom from "./DayMapFrom";
import DidItHappen from "./DidItHappen";
import FixTimeSheet from "./FixTimeSheet";
import { IconLock, IconPin } from "./ui/icons";
import "../styles/dayMap.css";

// Today's Day map view (Q59, 70b): the same list against the clock, behind
// the List | Day map switch. From (with the Day map page a link away), the
// route's stops (every open Today task) with the one thing at NOW, the DAY
// ENDS line where it falls, and Won't fit today with Move N to tomorrow and
// Park N. A stop opens that task. The route is Today's (useDayRoute there).
export default function DayMapColumn({ route, onOpenDayMap, onOpenTask, onDone, onMoveToTomorrow, onPark }) {
  const {
    windows, todayStr, scheduledTasks, anchorMinutes, rows, routeTasks, plan,
    setAnchor, applyAndSave, breaks,
  } = route;
  const [picking, setPicking] = useState(null); // "Did it happen?" → Pick a time…

  const nowMins = currentDayMinutes(windows);
  const overIndex = plan.overIndex;
  const { spare, wontFitMinutes, movable } = routeCut(routeTasks, plan);
  const routeIndex = new Map(routeTasks.map((t, i) => [getTaskId(t), i]));
  const firstOnTime = rows.find(r => r.kind === "stop" && !r.late);
  // The line falls before the first row of the first stop that won't fit,
  // as on the Day map page.
  const cut = overIndex === -1 ? rows.length
    : rows.findIndex(r => r.kind === "stop" && routeIndex.get(getTaskId(r.task)) >= overIndex);
  const rowIsOver = (r) => rows.indexOf(r) >= cut;

  // Q47.5: "Did it happen?" → Move → Later today (the next free slot it fits
  // before the day ends) or Pick a time…: a set time today, the route
  // reflowed around it, as the Day map's own sheet does.
  const laterFor = (task) => {
    return laterTodaySlot(rows, breaks, Math.max(nowMins, anchorMinutes), getEstimate(task), plan.dayEnd);
  };
  const fixAt = (task, at) => {
    applyAndSave(scheduledTasks.map(t => (getTaskId(t) === getTaskId(task) ? { ...t, dayMapFixedMinutes: at } : t)), anchorMinutes);
    setPicking(null);
  };
  const spans = mergeWindowSpans(windows);

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
    // Q36.3: still open 5 minutes after it ended, it asks (Q47.5).
    const asks = eventAsks(r, nowMins);
    const late = r.late && !asks;
    const until = oneThing ? routeTasks.find(t => getTaskId(t) === getTaskId(task))?.routeEndMinutes : null;
    return (
      <li key={`${getTaskId(task)}${r.continued ? `:continued:${r.start}` : ""}`}>
        <button
          type="button"
          className={`tdm-stop${isNow ? " is-now" : ""}${oneThing ? " is-one-thing" : ""}${late ? " is-late" : ""}${isOver ? " is-over" : ""}`}
          aria-label={`${isNow || late ? "Now" : formatClock24(r.start)} to ${formatClock24(r.end)}, ${task.title}`
            + `${oneThing ? ", the one thing" : ""}${r.fixed ? ", fixed time" : ""}${r.continued ? ", continued after the break" : ""}${isOver ? ", after the day ends" : ""}${asks ? ", did it happen?" : ""}`}
          onClick={() => onOpenTask(task)}
        >
          <span className="tdm-time">{isNow ? "NOW" : late ? "now" : formatClock24(r.start)}</span>
          <span className="tdm-title">
            {task.title}{r.continued ? " · continued" : ""}
            {r.fixed && <span className="dm-lock"><IconLock size={13} /></span>}
            {task.deferredUntil === todayStr && !r.continued && <span className="from-yesterday">FROM YESTERDAY</span>}
            {oneThing && (
              <span className="tdm-one-thing"><IconPin size={12} />THE ONE THING · UNTIL {formatClock24(until)}</span>
            )}
          </span>
          <span className="tdm-dur">{formatSpan(r.end - r.start)}</span>
        </button>
        {asks && (
          <DidItHappen
            title={task.title}
            laterAt={laterFor(task)}
            onDone={() => onDone(task)}
            onLater={(at) => fixAt(task, at)}
            onTomorrow={() => onMoveToTomorrow([getTaskId(task)])}
            onPickTime={() => setPicking(task)}
          />
        )}
      </li>
    );
  };

  return (
    <div className="today-daymap" role="region" aria-label="Day map">
      <div className="tdm-controls">
        <DayMapFrom anchorMinutes={anchorMinutes} onChangeAnchor={setAnchor} windows={windows} />
        {onOpenDayMap && <button type="button" className="tdm-page-link" onClick={onOpenDayMap}>Day map page ›</button>}
      </div>

      {scheduledTasks.length === 0 ? (
        <p className="tdm-empty">Nothing on Today yet.</p>
      ) : (
        <>
          <ol className="tdm-route" aria-label="Today's route">
            {rows.filter(r => !rowIsOver(r)).map(row)}
          </ol>
          <p className="tdm-dayend">
            <span>DAY ENDS {formatClock24(plan.dayEnd)}{spare > 0 && plan.wontFit.length === 0 ? ` · ${formatSpanCaps(spare)} SPARE` : ""}</span>
          </p>
          {plan.wontFit.length > 0 && (
            <section className="tdm-wontfit-block" aria-label="Won't fit today">
              <h3 className="tdm-wontfit">Won’t fit today <span className="tdm-wontfit-sum">{plan.wontFit.length} · {formatSpanCaps(wontFitMinutes)}</span></h3>
              <ol className="tdm-route" aria-label="Won't fit today">
                {rows.filter(rowIsOver).map(row)}
              </ol>
              {movable.length > 0 && (
                <div className="tdm-wontfit-actions">
                  <button type="button" className="tdm-wontfit-btn" onClick={() => onMoveToTomorrow(movable.map(getTaskId))}>
                    Move {movable.length} to tomorrow
                  </button>
                  {onPark && (
                    <button type="button" className="tdm-wontfit-btn" onClick={() => onPark(movable.map(getTaskId))}>
                      Park {movable.length}
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
      {picking && (
        <FixTimeSheet
          routeTasks={routeTasks}
          stops={scheduledTasks}
          task={picking}
          from={anchorMinutes}
          breaks={breaks}
          nowMins={nowMins}
          dayStart={spans[0]?.[0] ?? 0}
          dayEnd={Math.max(0, ...spans.map(([, end]) => end))}
          durationOf={getEstimate}
          getTaskId={getTaskId}
          onFix={fixAt}
          // A missed call: the sheet starts from now and offers Tomorrow, as
          // the Day map's does (Codex review of #453).
          onTomorrow={() => { onMoveToTomorrow([getTaskId(picking)]); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
