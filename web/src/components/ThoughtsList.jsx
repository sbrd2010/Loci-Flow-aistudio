import React, { useState } from "react";
import { THOUGHTS_MAX, THOUGHTS_NOTE_AT, newestThoughtsFirst, thoughtText } from "../utils/thoughts";
import { parseThought } from "../utils/thoughtFormat";
import { IconSquareCheck, IconX } from "./ui/icons";

// Thoughts in Mind Box › Brain dump (78 §6): newest first, each with its
// age. Hover, keyboard focus or a tap tints the row and swaps the age for
// "Make it a task" (Enter) and "Let go" (Del/Backspace); ↑/↓ move between
// rows. A phone shows 3 and "All N thoughts →" (78 §7).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const PHONE_SHOWS = 3;

export function thoughtAge(createdAt, now = Date.now()) {
  if (!Number.isFinite(createdAt)) return "";
  const ms = Math.max(0, now - createdAt);
  if (ms < HOUR_MS) return "NOW";
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}H`;
  return `${Math.floor(ms / DAY_MS)}D`;
}

export function oldestDays(thoughts, now = Date.now()) {
  const oldest = (thoughts || []).reduce((m, t) => (Number.isFinite(t.createdAt) ? Math.min(m, t.createdAt) : m), Infinity);
  return Number.isFinite(oldest) ? Math.floor((now - oldest) / DAY_MS) : 0;
}

export const oldestLabel = (days) => (days > 0 ? `oldest ${days} ${days === 1 ? "day" : "days"}` : "");

// 78 §5–6: a thought keeps its lines, bold and underline; no markers shown.
export function ThoughtText({ text }) {
  return parseThought(text).map((r, i) => {
    let node = r.text;
    if (r.u) node = <u>{node}</u>;
    if (r.b) node = <strong>{node}</strong>;
    return <React.Fragment key={i}>{node}</React.Fragment>;
  });
}

export default function ThoughtsList({
  thoughts = [],
  onMakeTask,
  onLetGo,
  onShowAll,
  countAction = null,
  oldestFirst = false,
  onFlipOrder,
  all = false, // the phone's All N page: every row, no head
  now = Date.now(),
}) {
  const [picked, setPicked] = useState(null);
  const n = thoughts.length;
  if (!n) {
    return <p className="thoughts-empty">Nothing here yet. Type the first thing that’s bothering you, however small.</p>;
  }
  const ordered = newestThoughtsFirst(thoughts);
  if (oldestFirst) ordered.reverse();
  const days = oldestDays(thoughts, now);

  const rowKeys = (e, t) => {
    if (e.target !== e.currentTarget) return; // a button inside keeps its own keys
    const row = e.currentTarget;
    const rows = [...row.parentElement.querySelectorAll(".thought-row")].filter(r => r.offsetParent !== null);
    const at = rows.indexOf(row);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[at + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onMakeTask(t);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      // Focus stays in the list: the next row, or the one above at the end.
      (rows[at + 1] || rows[at - 1])?.focus();
      onLetGo(t);
    }
  };

  return (
    <section className={`thoughts${all ? " is-all" : ""}${n > PHONE_SHOWS ? " has-more" : ""}`} aria-label="Thoughts">
      {!all && (
        <div className="thoughts-head">
          <p className="thoughts-count">
            {n} {n === 1 ? "thought" : "thoughts"}{days > 0 ? ` · ${oldestLabel(days)}` : ""}
          </p>
          <p className="thoughts-latest">{oldestFirst ? "OLDEST" : "LATEST"} · {Math.min(PHONE_SHOWS, n)} OF {n}</p>
          {countAction}
        </div>
      )}
      {/* While flipped, the way back stays even outside 40–49 (Codex review of #519). */}
      {onFlipOrder && ((n >= THOUGHTS_NOTE_AT && n < THOUGHTS_MAX) || oldestFirst) && (
        <p className="thoughts-note">
          {n >= THOUGHTS_NOTE_AT && n < THOUGHTS_MAX && <span>{n} thoughts. Clear a few? </span>}
          <button type="button" className="thoughts-note-link" onClick={onFlipOrder}>
            {oldestFirst ? "Show the newest first" : "Show the oldest first"}
          </button>
        </p>
      )}
      <ul className="thoughts-list">
        {ordered.map((t, i) => (
          <li
            key={t.id}
            className={`thought-row${i >= PHONE_SHOWS ? " is-more" : ""}${picked === t.id ? " is-picked" : ""}`}
            data-testid="thought-row"
            tabIndex={0}
            onKeyDown={(e) => rowKeys(e, t)}
            onClick={(e) => { if (!e.target.closest("button")) setPicked(p => (p === t.id ? null : t.id)); }}
          >
            <span className="thought-text"><ThoughtText text={thoughtText(t)} /></span>
            <span className="thought-age">{thoughtAge(t.createdAt, now)}</span>
            <span className="thought-actions">
              <button type="button" className="thought-btn is-make" onClick={() => onMakeTask(t)}>
                <IconSquareCheck size={17} />Make it a task
              </button>
              <button type="button" className="thought-btn is-quiet" onClick={() => onLetGo(t)}>
                <IconX size={17} />Let go
              </button>
            </span>
          </li>
        ))}
      </ul>
      {!all && n > PHONE_SHOWS && onShowAll && (
        <button type="button" className="thoughts-all" onClick={onShowAll}>All {n} thoughts →</button>
      )}
    </section>
  );
}
