import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../styles/goalRecord.css";
import { cssZoom } from "../utils/cssZoom";

// The goal record (Q57.2, frames 63a–l), opened by tapping Today's gold band:
// the recent days, one sentence, and the next goal task with "Make it the one
// thing" (or "Done today · <title>" once today counts). 840 and wider: a
// 400px popover under the band's right edge, flipped above when the window is
// too short below. Under 840: a bottom sheet. Esc, outside, the band again or
// a swipe down closes it.

const WIDE = "(min-width: 840px)";
const DAY_LONG = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function useWideQuery() {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(WIDE).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return wide;
}

const weekday = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getDay();
};

// "2 of 6 past days…" with the figures in mono (63a).
function Sentence({ text }) {
  const m = /^(\d+ of \d+)(.*)$/.exec(text);
  return (
    <p className="gr-sentence">
      {m ? <><strong className="gr-figs">{m[1]}</strong>{m[2]}</> : text}
    </p>
  );
}

export default function GoalRecord({ goal, record, weekdays = false, next = null, doneToday = null, onMakeOneThing, onEditGoal, onClose, bandRef }) {
  const wide = useWideQuery();
  const panelRef = useRef(null);
  const [above, setAbove] = useState(false);
  const [maxHeight, setMaxHeight] = useState(null);

  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // A short window flips the popover above the band's bottom edge, and it
  // scrolls inside; it never covers the header.
  useLayoutEffect(() => {
    if (!wide) { setAbove(false); setMaxHeight(null); return; }
    const band = bandRef?.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!band || !panel) return;
    // In CSS px: scrollHeight already is; rects and innerHeight are screen px.
    const z = cssZoom();
    const natural = panel.scrollHeight;
    const headerBottom = document.querySelector(".shell-header")?.getBoundingClientRect().bottom || 0;
    const below = (window.innerHeight - band.bottom) / z - 8 - 12;
    const aboveRoom = (band.bottom - headerBottom) / z - 8 - 12;
    if (natural <= below || below >= aboveRoom) {
      setAbove(false);
      setMaxHeight(natural > below ? Math.max(0, below) : null);
    } else {
      setAbove(true);
      setMaxHeight(natural > aboveRoom ? Math.max(0, aboveRoom) : null);
    }
  }, [wide, bandRef]);

  // Swipe down on the sheet's top closes it (63b). Once the body has
  // scrolled, a downward drag scrolls it back instead.
  const drag = useRef(null);
  const onPointerDown = (e) => {
    // A gesture the browser took over for scrolling ends in pointercancel,
    // not pointerup: start each one clean so an old start can't close it.
    drag.current = null;
    if (!wide && !(panelRef.current?.querySelector(".gr-body")?.scrollTop > 0)) drag.current = e.clientY;
  };
  const onPointerUp = (e) => {
    if (drag.current != null && e.clientY - drag.current > 60) onClose();
    drag.current = null;
  };

  const kicker = weekdays ? "LAST 5 WEEKDAYS" : "LAST 7 DAYS";
  const bonusDays = record.days.filter(d => d.bonus).length;
  const slots = Math.max(record.days.length, weekdays ? 5 + bonusDays : 7);
  const edit = <button type="button" className="gr-edit" onClick={onEditGoal}>Edit goal</button>;

  return (
    <>
      <div className={`gr-scrim${wide ? "" : " is-sheet"}`} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`goal-record ${wide ? "is-popover" : "is-sheet"}${above ? " is-above" : ""}`}
        role="dialog"
        aria-label={`Goal record: ${goal.name}`}
        tabIndex={-1}
        style={maxHeight != null ? { maxHeight } : undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; }}
      >
        <div className="gr-body">
          {!wide && (
            <div className="gr-goal">
              <span className="gr-grip" aria-hidden="true" />
              <span className="gr-kicker is-gold">
                YOUR GOAL{Number.isFinite(goal.daysLeft) ? ` · ${goal.daysLeft} ${goal.daysLeft === 1 ? "DAY" : "DAYS"}` : ""}
              </span>
              <span className="gr-goal-name">{goal.name}</span>
              {goal.target && <span className="gr-goal-target">Target · {goal.target}</span>}
            </div>
          )}
          {wide && (
            <div className="gr-head">
              <span className="gr-kicker is-gold">{kicker}</span>
              {onEditGoal && edit}
            </div>
          )}
          {/* Fixed slots, today at the right: days before the goal was set
              stay empty rather than spreading the rest out. */}
          <ol className="gr-days" aria-label={kicker.toLowerCase()} style={{ gridTemplateColumns: `repeat(${slots}, 1fr)` }}>
            {record.days.map((d, i) => {
              const state = d.done ? "done" : d.isToday ? "today" : "empty";
              const name = d.isToday ? "TODAY" : DAY_LONG[weekday(d.day)];
              return (
                <li key={d.day} className={`gr-day${d.bonus ? " is-bonus" : ""}`} style={i === 0 ? { gridColumnStart: slots - record.days.length + 1 } : undefined}
                  aria-label={`${d.isToday ? "Today" : name}${d.bonus ? ", weekend" : ""}: ${d.done ? "a goal task done" : d.isToday ? "not yet" : "none"}`}>
                  <span className={`gr-dot is-${state}`} aria-hidden="true" />
                  <span className={`gr-lab${d.isToday ? " is-today" : ""}`} aria-hidden="true">
                    <span className="gr-lab-long">{name}</span>
                    <span className="gr-lab-short">{name[0]}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {record.sentence && <Sentence text={record.sentence} />}
          {record.todayCounts && doneToday && (
            <p className="gr-done-today">Done today · {doneToday.title}</p>
          )}
          {!record.todayCounts && next && (
            <div className="gr-next">
              <span className="gr-kicker">NEXT GOAL TASK</span>
              <span className="gr-next-title">
                {next.title}
                {Number(next.timeEstimateMinutes) > 0 && <span className="gr-next-est"> · {next.timeEstimateMinutes}m</span>}
              </span>
              {wide && <button type="button" className="gr-make" onClick={() => onMakeOneThing(next)}>Make it the one thing</button>}
            </div>
          )}
        </div>
        {!wide && (
          <div className="gr-foot">
            {!record.todayCounts && next && (
              <button type="button" className="gr-make" onClick={() => onMakeOneThing(next)}>Make it the one thing</button>
            )}
            {onEditGoal && edit}
          </div>
        )}
      </div>
    </>
  );
}
