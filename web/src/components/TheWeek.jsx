import React, { useMemo } from "react";
import { useFocusLedger } from "../hooks/useFocusLedger";
import { weekSummary, formatMinutes, commonestStartHour } from "../utils/focusLedger";
import { frontsFromConfig } from "../utils/fronts";
import { getFocusWindows } from "../utils/focusWindows";
import "../styles/theWeek.css";

// Screen 8 — "The week": the ledger, summed, with one sentence of meaning.
// No tiles, no donuts, no percentage badges.
//
// Everything here reads from the focus ledger the app has always written.
// Where minutes exist the figures are durations; where they don't — a new
// account, or demo mode, which has no uid and therefore no ledger — the screen
// renders MOVES instead, which is addendum F's own fallback rather than a
// fabricated 0h00m.

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
function patternSentence(summary, frontNameOf) {
  const { perDay, totalMinutes, totalMoves, daysMoved, byFront, hasMinutes } = summary;
  if (totalMoves === 0) {
    return { before: "Nothing is logged this week. ", bold: "That is a record too", after: ", not a gap." };
  }

  if (hasMinutes && byFront.size > 0) {
    const [topId, topMins] = [...byFront.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topMins / totalMinutes > 0.5) {
      return { before: "More than half of it went to ", bold: frontNameOf(topId), after: "." };
    }
  }

  const best = [...perDay].sort((a, b) => b.moves - a.moves)[0];
  if (best && best.moves > 0 && daysMoved > 1) {
    const share = hasMinutes ? best.minutes / totalMinutes : best.moves / totalMoves;
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

  const now = useMemo(() => new Date(), [raw, tasks]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(
    () => weekSummary(raw, tasks, now, windows),
    [raw, tasks, now, windows],
  );

  const fronts = useMemo(() => frontsFromConfig(config), [config]);
  const frontNameOf = (id) => fronts.find(f => f.id === id)?.name || "work on no front";

  const { perDay, totalMinutes, totalMoves, byFront, hasMinutes } = summary;
  const peak = Math.max(...perDay.map(d => (hasMinutes ? d.minutes : d.moves)), 1);
  const sentence = patternSentence(summary, frontNameOf);

  // "Protect tomorrow's 08:00?" is only offered when the ledger actually shows
  // a habitual start hour, and only when no focus window already covers it.
  const suggestHour = commonestStartHour(summary.events);
  const alreadyProtected = suggestHour !== null
    && windows.some(w => suggestHour * 60 >= w.startMin && suggestHour * 60 < w.endMin);
  const canSuggest = suggestHour !== null && !alreadyProtected && typeof saveConfigPatch === "function";

  const protectHour = () => {
    const pad = (n) => String(n).padStart(2, "0");
    const existing = Array.isArray(config.focusWindows) ? config.focusWindows : [];
    saveConfigPatch({
      focusWindows: [...existing, { start: `${pad(suggestHour)}:00`, end: `${pad(suggestHour + 1)}:00` }],
    });
  };

  const rows = [...byFront.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="week">
      <header className="week-head">
        {onBack && <button type="button" className="week-back" onClick={onBack}>Back</button>}
        <span className="week-range">{formatRange(perDay)}</span>
      </header>

      <div className="week-figure">{hasMinutes ? formatMinutes(totalMinutes) : String(totalMoves)}</div>
      <div className="week-kicker">
        {hasMinutes
          ? `FOCUSED · ${totalMoves} ${totalMoves === 1 ? "MOVE" : "MOVES"} LOGGED`
          : `${totalMoves === 1 ? "MOVE" : "MOVES"} · ${rows.length || "NO"} ${rows.length === 1 ? "FRONT" : "FRONTS"}`}
      </div>

      <p className="week-sentence">
        {sentence.before}<strong>{sentence.bold}</strong>{sentence.after}
      </p>

      <div className="week-chart" style={{ height: `${CHART_HEIGHT}px` }}>
        {perDay.map((d, i) => {
          const value = hasMinutes ? d.minutes : d.moves;
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
                {hasMinutes ? formatMinutes(mins) : `${mins}m`}
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
