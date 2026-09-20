import React, { useEffect, useMemo, useState } from "react";
import { useFocusLedger } from "../hooks/useFocusLedger";
import { weekSummary, formatMinutes, commonestStartHour } from "../utils/focusLedger";
import { frontsFromConfig } from "../utils/fronts";
import { getFocusWindows, isHourInWindow, formatMinutesToTime, getLociDayStr } from "../utils/focusWindows";
import "../styles/theWeek.css";

// Screen 8 — "The week": the ledger, summed, with one sentence of meaning.
// No tiles, no donuts, no percentage badges.
//
// Everything here reads from the focus ledger the app has always written, and
// every figure is a duration.
//
// Addendum F asked for a MOVES fallback when no time is logged, to avoid a
// fabricated 0h00m. That fallback was removed: it assumed moves were a signal
// independent of timed sessions, and here they are not. dailyTotals counts a
// move only for an event yielding at least a minute, and totalMinutes sums
// those same minutes — so no minutes implies no moves, always. The branch could
// only ever render "0". An empty week now says so in words instead.

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const CHART_HEIGHT = 96;

function dayInitial(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  return DAY_INITIALS[new Date(y, m - 1, d).getDay()];
}

function formatRange(perDay) {
  if (!perDay.length) return "";
  const fmt = (ds) => {
    const [y, m, d] = ds.split("-").map(Number);
    return `${d} ${new Date(y, m - 1, d).toLocaleString("en-GB", { month: "short" }).toUpperCase()}`;
  };
  return `${fmt(perDay[0].date)} — ${fmt(perDay[perDay.length - 1].date)}`;
}

// The one sentence. Every branch states something demonstrably true of the
// week's own numbers; none of it is encouragement, and none of it shames.
export function patternSentence(summary, frontNameOf) {
  const { perDay, totalMinutes, totalMoves, daysMoved, byFront } = summary;
  if (totalMoves === 0) {
    return { before: "Nothing is logged this week. ", bold: "That is a record too", after: ", not a gap." };
  }

  // byFront is only ever populated from events with countable minutes, so a
  // non-empty map guarantees totalMinutes > 0.
  if (byFront.size > 0) {
    const [topId, topMins] = [...byFront.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topMins / totalMinutes > 0.5) {
      return { before: "More than half of it went to ", bold: frontNameOf(topId), after: "." };
    }
  }

  // Ranked by the same measure the share is then computed in. Sorting by moves
  // and measuring in minutes picked the wrong day whenever a day of several
  // short moves outnumbered a day holding one long session.
  const best = [...perDay].sort((a, b) => b.minutes - a.minutes)[0];
  if (best && best.minutes > 0 && daysMoved > 1) {
    const share = best.minutes / totalMinutes;
    if (share > 0.4) {
      return { before: "Most of the week happened on ", bold: "one day", after: "." };
    }
  }

  return {
    before: "You moved on ",
    bold: `${daysMoved} of the last ${perDay.length} days`,
    after: ".",
  };
}

export default function TheWeek({ payload = {}, uid, onBack, saveConfigPatch, onOpenOldInsights }) {
  const { tasks = [], config = {} } = payload;
  const windows = useMemo(() => getFocusWindows(config), [config]);
  const raw = useFocusLedger(uid, 7, windows);

  // The current loci day, polled. Nothing else here is clock-driven, so a screen
  // left open across the day boundary kept a `now` from yesterday: the range,
  // the highlighted "today" bar and the ledger hook's oldest key all stayed on
  // the previous day until something else happened to re-render.
  const [dayKey, setDayKey] = useState(() => getLociDayStr(new Date(), windows));
  useEffect(() => {
    const id = setInterval(
      () => setDayKey(prev => {
        const next = getLociDayStr(new Date(), windows);
        return next === prev ? prev : next; // same string ⇒ same state ⇒ no render
      }),
      60_000,
    );
    return () => clearInterval(id);
  }, [windows]);

  const now = useMemo(() => new Date(), [raw, tasks, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(
    () => weekSummary(raw, tasks, now, windows),
    [raw, tasks, now, windows],
  );

  const fronts = useMemo(() => frontsFromConfig(config), [config]);
  const frontNameOf = (id) => fronts.find(f => f.id === id)?.name || "work on no front";

  const { perDay, totalMinutes, totalMoves, byFront } = summary;
  const peak = Math.max(...perDay.map(d => d.minutes), 1);
  const sentence = patternSentence(summary, frontNameOf);

  // "Protect tomorrow's 08:00?" is only offered when the ledger actually shows
  // a habitual start hour, and only when no focus window already covers it.
  const suggestHour = commonestStartHour(summary.events);
  const alreadyProtected = suggestHour !== null && windows.some(w => isHourInWindow(suggestHour, w));
  const canSuggest = suggestHour !== null && !alreadyProtected && typeof saveConfigPatch === "function";

  const protectHour = () => {
    const pad = (n) => String(n).padStart(2, "0");
    // ALWAYS seed from the effective windows. Reading config.focusWindows
    // directly is wrong in two ways that both end the same: when the key is
    // absent (an account on dayStartHour/dayEndHour, or the default schedule)
    // and when it is present but every row is invalid — in both cases
    // getFocusWindows falls back to the legacy range, so persisting the stored
    // value plus one hour leaves an array whose only usable row is that hour.
    // It would then take precedence and silently replace the whole workday.
    // Seeding from `windows` also normalizes, dropping rows that never parsed.
    const existing = windows.map(w => ({
      start: formatMinutesToTime(w.startMin),
      end: formatMinutesToTime(w.endMin),
    }));
    saveConfigPatch({
      // Wrap at midnight: parseTimeToMinutes rejects hour 24, so a 23:00
      // suggestion saved as "24:00" is silently discarded by getFocusWindows
      // and "Block it" protects nothing while appearing to work.
      focusWindows: [...existing, { start: `${pad(suggestHour)}:00`, end: `${pad((suggestHour + 1) % 24)}:00` }],
    });
  };

  const rows = [...byFront.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="week">
      <header className="week-head">
        {onBack && <button type="button" className="week-back" onClick={onBack}>Back</button>}
        <span className="week-range">{formatRange(perDay)}</span>
      </header>

      <div className="week-figure">{formatMinutes(totalMinutes)}</div>
      <div className="week-kicker">
        {`FOCUSED · ${totalMoves} ${totalMoves === 1 ? "MOVE" : "MOVES"} LOGGED`}
      </div>

      <p className="week-sentence">
        {sentence.before}<strong>{sentence.bold}</strong>{sentence.after}
      </p>

      <div className="week-chart" style={{ height: `${CHART_HEIGHT}px` }}>
        {perDay.map((d, i) => {
          const value = d.minutes;
          const isToday = i === perDay.length - 1;
          return (
            <div key={d.date} className="week-col">
              <div className="week-bar-track">
                <div
                  className={`week-bar${isToday ? " is-today" : ""}`}
                  style={{ height: `${Math.round((value / peak) * 100)}%` }}
                />
              </div>
              <span className="week-tick">{dayInitial(d.date)}</span>
            </div>
          );
        })}
      </div>

      <div className="week-breakdown-kicker">WHERE IT WENT</div>
      {rows.length === 0 ? (
        <p className="week-empty">No sessions yet this week.</p>
      ) : (
        <ul className="week-rows">
          {rows.map(([frontId, mins]) => (
            <li key={frontId ?? "none"} className="week-row">
              <span className="week-row-name">{frontNameOf(frontId)}</span>
              {/* A zero reads in clay — the one place the alert colour is
                  allowed outside a deadline, per the screen's own spec. */}
              <span className={`week-row-figure${mins === 0 ? " is-zero" : ""}`}>
                {formatMinutes(mins)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canSuggest && (
        <footer className="week-foot">
          <span className="week-suggest">
            You usually start at {String(suggestHour).padStart(2, "0")}:00. Protect it?
          </span>
          <button type="button" className="week-block" onClick={protectHour}>Block it</button>
        </footer>
      )}

      {onOpenOldInsights && (
        <button type="button" className="week-old-link" onClick={onOpenOldInsights}>
          Completion stats and the AI recap
        </button>
      )}
    </div>
  );
}
