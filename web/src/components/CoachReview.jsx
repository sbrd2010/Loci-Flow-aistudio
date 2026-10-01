import React, { useEffect, useMemo, useState } from "react";
import { useFocusLedger } from "../hooks/useFocusLedger";
import { formatMinutes } from "../utils/focusLedger";
import { frontsFromConfig } from "../utils/fronts";
import { getFocusWindows } from "../utils/focusWindows";
import { REVIEW_PERIODS, reviewFacts } from "../utils/coachReview";
import "../styles/coachReview.css";

// Coach → Review (Q51, 62a–g): the facts on the left, Coach's brief beside
// them (`brief`). The period switch changes the facts only.

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORY_ROWS = 5;
const parseDay = (ds) => { const [y, m, d] = ds.split("-").map(Number); return new Date(y, m - 1, d); };
const shortDate = (ds) => {
  const d = parseDay(ds);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" }).toUpperCase()}`;
};

function DayChart({ days, period }) {
  const peak = Math.max(1, ...days.map(d => d.minutes || 0));
  const unread = days.every(d => d.minutes == null);
  const empty = !unread && days.every(d => !d.minutes);
  const dense = period === "30d";
  const last = days.length - 1;
  return (
    <div className="rv-daychart" data-dense={dense || undefined}>
      <span className="rv-kicker">Each day · focus and ticks</span>
      {(unread || empty) && (
        <p className="rv-chart-note">{unread ? "Focus time isn’t read here, so only the ticks show." : "No focus time logged in these days."}</p>
      )}
      <ol className="rv-bars" style={{ "--rv-cols": days.length }}>
        {days.map((d, i) => {
          const mins = d.minutes;
          const label = `${shortDate(d.date)}: ${mins == null ? "focus not read" : `${formatMinutes(mins)} focused`}, ${d.ticks} ticked`;
          return (
            <li key={d.date} className={`rv-bar-col${i === last ? " is-today" : ""}`} aria-label={label}>
              {mins != null && (!dense || mins > 0) && <span className="rv-bar-fig">{formatMinutes(mins)}</span>}
              <span className={`rv-bar${!mins ? " is-zero" : ""}`} style={mins ? { height: `calc(${mins / peak} * (100% - 22px))` } : undefined} />
            </li>
          );
        })}
      </ol>
      <div className="rv-bar-labels" style={{ "--rv-cols": days.length }} aria-hidden="true">
        {days.map((d, i) => (
          <span key={d.date} className={i === last ? "is-today" : undefined}>
            {dense ? (i % 5 === 0 || i === last ? parseDay(d.date).getDate() : "") : WEEKDAYS[parseDay(d.date).getDay()]}
          </span>
        ))}
        {!dense && days.map(d => (
          <span key={`t${d.date}`} className={d.ticks ? undefined : "is-quiet"}>{d.ticks ? `✓${d.ticks}` : "·"}</span>
        ))}
      </div>
    </div>
  );
}

export default function CoachReview({ payload = {}, uid, brief = null }) {
  const config = payload.config || {};
  const windows = getFocusWindows(config);
  const [period, setPeriod] = useState("7d");
  // A minute tick, so "left today" and the day ranges move on while Review
  // stays open (and roll over at the end of the Loci day).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const { raw, status } = useFocusLedger(uid, 30, windows);
  const fronts = useMemo(() => frontsFromConfig(payload.config || {}), [payload.config]);
  const frontNameOf = (id) => (!id ? "work on no front" : fronts.find(f => f.id === id)?.name || "a front you've closed");

  const facts = reviewFacts({
    tasks: payload.tasks || [],
    contributions: payload.contributions || [],
    config,
    focusRaw: status === "ready" ? raw || {} : null,
    period,
    now: new Date(),
    windows,
    frontNameOf,
  });
  const { days, openNow, weekday } = facts;
  const range = days.length === 1 ? shortDate(days[0].date) : `${shortDate(days[0].date)} – ${shortDate(days.at(-1).date)}`;
  const frontPeak = Math.max(1, ...(facts.byFront || []).map(f => f.minutes));
  const catPeak = Math.max(1, ...facts.byCategory.map(c => c.done + c.open));
  const dowCounts = DOW_KEYS.map(k => weekday.counts[k] || 0);
  const dowPeak = Math.max(1, ...dowCounts);
  const bestIdx = weekday.bestDay ? DOW_KEYS.indexOf(weekday.bestDay) : -1;

  return (
    <div className="rv">
      <div className="rv-period" role="radiogroup" aria-label="Period">
        {REVIEW_PERIODS.map(p => (
          <button key={p.key} type="button" role="radio" aria-checked={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>
      <div className="rv-grid">
        <section className="rv-facts" aria-label="The facts">
          <div className="rv-hero">
            <div className="rv-hero-main">
              <span className="rv-hero-fig">{facts.focusedMinutes == null ? "—" : formatMinutes(facts.focusedMinutes)}</span>
              <span className="rv-kicker is-quiet">
                {facts.focusedMinutes == null && status !== "loading" ? "Focus time not read" : `Focused · ${range}`}
              </span>
            </div>
            <dl className="rv-hero-stats">
              <div><dt>Completed</dt><dd>{facts.completed}</dd></div>
              <div><dt>A day</dt><dd>{facts.pace}</dd></div>
              <div><dt>Days with a tick</dt><dd>{facts.daysWithTick} <small>of {facts.dayCount}</small></dd></div>
            </dl>
          </div>
          {facts.sentence && (
            <p className="rv-sentence">{facts.sentence.before}<strong>{facts.sentence.bold}</strong>{facts.sentence.after}</p>
          )}

          <DayChart days={days} period={period} />

          <div className="rv-small">
            <div className="rv-card">
              <span className="rv-kicker">Where the time went</span>
              {facts.byFront && facts.byFront.length > 0 ? (
                <div className="rv-rows rv-rows-front">
                  {facts.byFront.map(f => (
                    <React.Fragment key={f.id || "none"}>
                      <span className="rv-row-name">{f.name.charAt(0).toUpperCase() + f.name.slice(1)}</span>
                      <span className="rv-line"><span style={{ width: `${Math.max(3, (f.minutes / frontPeak) * 100)}%` }} /></span>
                      <span className="rv-num">{formatMinutes(f.minutes)}</span>
                    </React.Fragment>
                  ))}
                </div>
              ) : <p className="rv-empty">{facts.byFront ? "No focus time in this period." : "Focus time not read."}</p>}
            </div>

            <div className="rv-card">
              <span className="rv-kicker rv-kicker-split">By category <span>Done · open</span></span>
              {facts.byCategory.length > 0 ? (
                <div className="rv-rows rv-rows-cat">
                  {facts.byCategory.slice(0, CATEGORY_ROWS).map(c => (
                    <React.Fragment key={c.name}>
                      <span className="rv-row-name">{c.name}</span>
                      <span className="rv-split">
                        {c.done > 0 && <span className="is-done" style={{ width: `${(c.done / catPeak) * 100}%` }} />}
                        {c.open > 0 && <span className="is-open" style={{ width: `${(c.open / catPeak) * 100}%` }} />}
                      </span>
                      <span className="rv-num">{c.done} · {c.open}</span>
                    </React.Fragment>
                  ))}
                </div>
              ) : <p className="rv-empty">No tasks yet.</p>}
              {facts.byCategory.length > CATEGORY_ROWS && <p className="rv-empty">and {facts.byCategory.length - CATEGORY_ROWS} more</p>}
              {facts.byCategory.length > 0 && <p className="rv-footnote">Done counts only tasks still on file.</p>}
            </div>

            <div className="rv-card">
              <span className="rv-kicker">Best weekday · last 30 days</span>
              <div className="rv-dow" aria-hidden="true">
                {dowCounts.map((n, i) => (
                  <span key={i} className={i === bestIdx ? "is-best" : undefined} style={{ height: n ? `${(n / dowPeak) * 100}%` : "2px" }} />
                ))}
              </div>
              <div className="rv-dow-labels">
                {dowCounts.map((n, i) => (
                  <span key={i} className={i === bestIdx ? "is-best" : undefined} aria-label={`${DOW_KEYS[i]}: ${n} ticked`}>{DAY_LETTERS[i]} {n}</span>
                ))}
              </div>
            </div>

            <div className="rv-card">
              <span className="rv-kicker">Open now · {openNow.total}</span>
              <div className="rv-stack" aria-hidden="true">
                {openNow.byHorizon.filter(h => h.count > 0).map(h => (
                  <span key={h.id} className={`is-${h.id}`} style={{ flex: h.count }} />
                ))}
              </div>
              <div className="rv-stack-counts">
                {openNow.byHorizon.map(h => <span key={h.id}>{h.label.toUpperCase()} <strong>{h.count}</strong></span>)}
              </div>
              <p className="rv-planned">
                <strong className={openNow.over ? "is-over" : undefined}>{formatMinutes(openNow.plannedTodayMin)}</strong> planned today, {formatMinutes(openNow.leftMin)} left.
              </p>
            </div>
          </div>
        </section>
        {brief && <aside className="rv-brief" aria-label="Coach's brief">{brief}</aside>}
      </div>
    </div>
  );
}
