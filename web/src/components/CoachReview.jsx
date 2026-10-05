import React, { useEffect, useMemo, useState } from "react";
import { useFocusLedger } from "../hooks/useFocusLedger";
import { formatMinutes } from "../utils/focusLedger";
import { frontsFromConfig } from "../utils/fronts";
import { getFocusWindows } from "../utils/focusWindows";
import { reviewFacts } from "../utils/coachReview";
import SectionHead from "./CoachSectionHead";
import "../styles/coachReview.css";

// Coach → Review (73a/b): one reading order, top to bottom. 01 Coach's brief
// (`renderBrief`, handed the same ledger read), then the numbers behind it in
// five numbered sections. The period switch sits in the tab row (CoachTab)
// and changes the facts only.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORY_ROWS = 5;
const parseDay = (ds) => { const [y, m, d] = ds.split("-").map(Number); return new Date(y, m - 1, d); };
const shortDate = (ds) => {
  const d = parseDay(ds);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" }).toUpperCase()}`;
};
const rangeDate = (ds) => { const d = parseDay(ds); return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`; };

const DAY_NAMES = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };
const HORIZON_LABEL = { today: "Today", week: "This week", month: "This month", quarter: "This quarter", later: "Later" };
const NUMBERS_TITLE = { today: "Today in numbers", "7d": "The week in numbers", "30d": "30 days in numbers" };
const PERIOD_NOUN = { today: "today", "7d": "in these 7 days", "30d": "in these 30 days" };

function DayChart({ days, period }) {
  const peak = Math.max(1, ...days.map(d => d.minutes || 0));
  const unread = days.every(d => d.minutes == null);
  const empty = !unread && days.every(d => !d.minutes);
  const dense = period === "30d";
  const last = days.length - 1;
  return (
    <div className="rv-daychart" data-dense={dense || undefined}>
      {(unread || empty) && (
        <p className="rv-chart-note">{unread ? "Focus time isn’t read here, so only the tasks done show." : "No focus time logged in these days."}</p>
      )}
      <ol className="rv-bars" style={{ "--rv-cols": days.length }}>
        {days.map((d, i) => {
          const mins = d.minutes;
          const label = `${shortDate(d.date)}: ${mins == null ? "focus not read" : `${formatMinutes(mins)} focused`}, ${d.ticks} ticked`;
          return (
            <li key={d.date} className={`rv-bar-col${i === last ? " is-today" : ""}`} aria-label={label}>
              {mins != null && (!dense || mins > 0) && <span className="rv-bar-fig">{mins ? formatMinutes(mins) : "0"}</span>}
              <span className={`rv-bar${!mins ? " is-zero" : ""}`} style={mins ? { height: `calc(${mins / peak} * (100% - 26px))` } : undefined} />
            </li>
          );
        })}
      </ol>
      <div className="rv-bar-labels" style={{ "--rv-cols": days.length }} aria-hidden="true">
        {days.map((d, i) => (
          <span key={d.date} className={`rv-bar-day${i === last ? " is-today" : ""}`}>
            <span>{dense ? (i % 5 === 0 || i === last ? parseDay(d.date).getDate() : "") : i === last ? "Today" : WEEKDAYS[parseDay(d.date).getDay()]}</span>
            <small className={d.ticks ? undefined : "is-quiet"}>{d.ticks ? (dense ? d.ticks : `${d.ticks} done`) : "–"}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function CoachReview({ payload = {}, uid, period = "7d", renderBrief = null, onOpenDayMap = null }) {
  const config = payload.config || {};
  const windows = getFocusWindows(config);
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
  const range = days.length === 1 ? rangeDate(days[0].date) : `${rangeDate(days[0].date)} – ${rangeDate(days.at(-1).date)}`;
  const frontPeak = Math.max(1, ...(facts.byFront || []).map(f => f.minutes));
  const catPeak = Math.max(1, ...facts.byCategory.map(c => c.done + c.open));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // The brief's lead: the period's focus, then the one sentence on it.
  const lead = facts.sentence && (
    <>
      {facts.focusedMinutes > 0 && `You focused for ${formatMinutes(facts.focusedMinutes)} ${PERIOD_NOUN[period]}. `}
      {facts.sentence.before}<strong>{facts.sentence.bold}</strong>{facts.sentence.after}
    </>
  );
  // 73: the best-weekday chart is gone; its finding opens the brief's Patterns.
  const weekdayLine = weekday.bestDay ? `${DAY_NAMES[weekday.bestDay]} is your best weekday over the last 30 days.` : null;

  return (
    <div className="rv">
      {renderBrief && (
        <section className="rv-sec rv-brief" aria-label="Coach's brief">
          {renderBrief({ focusRaw: status === "ready" ? raw || {} : null, frontNameOf, lead, weekdayLine })}
        </section>
      )}
      <section className="rv-facts" aria-label="The facts">
        <div className="rv-sec">
          <SectionHead num="02" title={NUMBERS_TITLE[period]} line={`${range}.`} />
          <dl className="rv-numbers rv-indent">
            <div className="rv-num-hero">
              <dt>{facts.focusedMinutes == null && status !== "loading" ? "focus time not read" : "focused"}</dt>
              <dd className="rv-hero-fig">{facts.focusedMinutes == null ? "—" : formatMinutes(facts.focusedMinutes)}</dd>
            </div>
            <div><dt>tasks done</dt><dd>{facts.completed}</dd></div>
            {period !== "today" && <div><dt>done per day</dt><dd>{facts.pace}</dd></div>}
            <div><dt>days with something done</dt><dd>{facts.daysWithTick} <small>of {facts.dayCount}</small></dd></div>
          </dl>
        </div>

        <div className="rv-sec">
          <SectionHead num="03" title={period === "today" ? "Focus today" : "Focus each day"} line={period === "today" ? "Minutes of focus today, and how many tasks you finished." : "Minutes of focus per day. Under each day, how many tasks you finished."} />
          <div className="rv-indent"><DayChart days={days} period={period} /></div>
        </div>

        <div className="rv-sec rv-pair">
          <div className="rv-card">
            <SectionHead num="04" title="Where the time went" line="Focus time by goal." />
            {facts.byFront && facts.byFront.length > 0 ? (
              <div className="rv-rows rv-indent">
                {facts.byFront.map(f => (
                  <div key={f.id || "none"} className="rv-row">
                    <span className="rv-row-top"><span className="rv-row-name">{cap(f.name)}</span><span className="rv-num">{formatMinutes(f.minutes)}</span></span>
                    <span className="rv-track"><span className="is-done" style={{ width: `${Math.max(3, (f.minutes / frontPeak) * 100)}%` }} /></span>
                  </div>
                ))}
              </div>
            ) : <p className="rv-empty rv-indent">{facts.byFront ? "No focus time in this period." : "Focus time not read."}</p>}
          </div>

          <div className="rv-card">
            <SectionHead num="05" title="By category" line="Done (dark) against still open (light)." />
            {facts.byCategory.length > 0 ? (
              <div className="rv-rows rv-indent">
                {facts.byCategory.slice(0, CATEGORY_ROWS).map(c => (
                  <div key={c.name} className="rv-row">
                    <span className="rv-row-top"><span className="rv-row-name">{c.name}</span><span className="rv-row-value">{c.done} done · {c.open} open</span></span>
                    <span className="rv-track">
                      {c.done > 0 && <span className="is-done" style={{ width: `${(c.done / catPeak) * 100}%` }} />}
                      {c.open > 0 && <span className="is-open" style={{ width: `${(c.open / catPeak) * 100}%` }} />}
                    </span>
                  </div>
                ))}
                {facts.byCategory.length > CATEGORY_ROWS && <p className="rv-empty">and {facts.byCategory.length - CATEGORY_ROWS} more</p>}
                <p className="rv-footnote">Done counts only tasks still on file.</p>
              </div>
            ) : <p className="rv-empty rv-indent">No tasks yet.</p>}
          </div>
        </div>

        <div className="rv-sec">
          <SectionHead num="06" title={`Still open · ${openNow.total} task${openNow.total === 1 ? "" : "s"}`} line="Everything not done yet, by when you planned it." />
          <div className="rv-open rv-indent">
            <div className="rv-stack" aria-hidden="true">
              {openNow.byHorizon.filter(h => h.count > 0).map(h => (
                <span key={h.id} className={`is-${h.id}`} style={{ flex: h.count }} />
              ))}
            </div>
            <p className="rv-stack-counts">
              {openNow.byHorizon.map((h, i) => <span key={h.id}>{i > 0 && " · "}{HORIZON_LABEL[h.id] || h.label} {h.count}</span>)}
            </p>
            <p className="rv-planned">
              Today has <strong className={openNow.over ? "is-over" : undefined}>{formatMinutes(openNow.plannedTodayMin)}</strong> planned and {formatMinutes(openNow.leftMin)} left in the day.
              {onOpenDayMap && <> <button type="button" className="rv-link" onClick={onOpenDayMap}>Sort in Day map ›</button></>}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
