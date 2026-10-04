import React from "react";
import { THOUGHTS_NOTE_AT, newestThoughtsFirst } from "../utils/thoughts";

// Thoughts in Mind Box (Q56.2): newest first, each with its age, "Make it a
// task" (Add, prefilled) and "Let go" (gone, with Undo).

const DAY_MS = 24 * 60 * 60 * 1000;
export function thoughtAge(createdAt, now = Date.now()) {
  if (!Number.isFinite(createdAt)) return "";
  const days = Math.floor((now - createdAt) / DAY_MS);
  return days <= 0 ? "TODAY" : `${days}D`;
}

export default function ThoughtsList({ thoughts = [], onMakeTask, onLetGo, now = Date.now() }) {
  if (!thoughts.length) return null;
  const newestFirst = newestThoughtsFirst(thoughts);
  const oldest = thoughts.reduce((m, t) => (Number.isFinite(t.createdAt) ? Math.min(m, t.createdAt) : m), Infinity);
  const oldestDays = Number.isFinite(oldest) ? Math.floor((now - oldest) / DAY_MS) : 0;
  return (
    <section className="thoughts" aria-labelledby="thoughts-title">
      <h3 className="thoughts-kicker" id="thoughts-title">
        THOUGHTS · {thoughts.length}{oldestDays > 0 ? ` · OLDEST ${oldestDays} ${oldestDays === 1 ? "DAY" : "DAYS"}` : ""}
      </h3>
      {thoughts.length >= THOUGHTS_NOTE_AT && (
        <p className="thoughts-note">{thoughts.length} thoughts. Clear a few?</p>
      )}
      <ul className="thoughts-list">
        {newestFirst.map(t => (
          <li key={t.id} className="thought-row" data-testid="thought-row">
            <span className="thought-text">{t.text}</span>
            <span className="thought-age">{thoughtAge(t.createdAt, now)}</span>
            <span className="thought-actions">
              <button type="button" className="thought-btn" onClick={() => onMakeTask(t)}>Make it a task</button>
              <button type="button" className="thought-btn" onClick={() => onLetGo(t)}>Let go</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
