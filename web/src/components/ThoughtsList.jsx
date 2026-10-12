import React, { useState } from "react";
import { THOUGHTS_NOTE_AT, newestThoughtsFirst } from "../utils/thoughts";
import { parseThought } from "../utils/thoughtFormat";

// Thoughts in Mind Box (Q56.2; 65a): newest first, each with its age; on
// hover, focus or touch, "Make it a task" (Add, prefilled) and "Let go"
// (gone, with Undo). A phone shows 3 and "All N thoughts".

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PHONE_SHOWS = 3;

export function thoughtAge(createdAt, now = Date.now()) {
  if (!Number.isFinite(createdAt)) return "";
  const ms = Math.max(0, now - createdAt);
  if (ms < HOUR_MS) return "NOW";
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}H`;
  return `${Math.floor(ms / DAY_MS)}D`;
}

// 78 §5–6: a thought keeps its lines, bold and underline; no markers shown.
export function ThoughtText({ text }) {
  return parseThought(text).map((r, i) => {
    let node = r.text;
    if (r.u) node = <u>{node}</u>;
    if (r.b) node = <strong>{node}</strong>;
    return <React.Fragment key={i}>{node}</React.Fragment>;
  });
}

export default function ThoughtsList({ thoughts = [], onMakeTask, onLetGo, now = Date.now() }) {
  const [all, setAll] = useState(false);
  if (!thoughts.length) return null;
  const newestFirst = newestThoughtsFirst(thoughts);
  const oldest = thoughts.reduce((m, t) => (Number.isFinite(t.createdAt) ? Math.min(m, t.createdAt) : m), Infinity);
  const oldestDays = Number.isFinite(oldest) ? Math.floor((now - oldest) / DAY_MS) : 0;
  const n = thoughts.length;
  return (
    <section className={`thoughts${all ? " is-all" : ""}`} aria-label="Thoughts">
      <p className="thoughts-count">
        {n} {n === 1 ? "thought" : "thoughts"}{oldestDays > 0 ? ` · oldest ${oldestDays} ${oldestDays === 1 ? "day" : "days"}` : ""}
      </p>
      {n >= THOUGHTS_NOTE_AT && <p className="thoughts-note">{n} thoughts. Clear a few?</p>}
      <ul className="thoughts-list">
        {newestFirst.map((t, i) => (
          <li key={t.id} className={`thought-row${i >= PHONE_SHOWS ? " is-more" : ""}`} data-testid="thought-row">
            <span className="thought-text"><ThoughtText text={t.text} /></span>
            <span className="thought-age">{thoughtAge(t.createdAt, now)}</span>
            <span className="thought-actions">
              <button type="button" className="thought-btn" onClick={() => onMakeTask(t)}>Make it a task</button>
              <button type="button" className="thought-btn is-quiet" onClick={() => onLetGo(t)}>Let go</button>
            </span>
          </li>
        ))}
      </ul>
      {n > PHONE_SHOWS && !all && (
        <button type="button" className="thoughts-all" onClick={() => setAll(true)}>All {n} thoughts</button>
      )}
    </section>
  );
}
