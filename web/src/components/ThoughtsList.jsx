import React, { useState } from "react";
import { THOUGHT_MAX_CHARS, THOUGHTS_MAX, THOUGHTS_NOTE_AT, newestThoughtsFirst, sameThoughtContent, thoughtDate, thoughtText } from "../utils/thoughts";
import { highlightPaint, notebookRuns, notebookText } from "../utils/thoughtNotebook";
import { IconPencil, IconSquareCheck, IconX } from "./ui/icons";
import ThoughtEditor from "./ui/ThoughtEditor";

// Thoughts in Mind Box › Brain dump (78 §6): newest first, each with its
// age. Hover, keyboard focus or a tap tints the row and swaps the age for
// "Make it a task" (Enter) and "Let go" (Del/Backspace); ↑/↓ move between
// rows. A phone shows 3 and "All N thoughts →" (78 §7). Each thought shows
// one line until a tap, click or Space opens it in full.

const DAY_MS = 24 * 60 * 60 * 1000;
export const PHONE_SHOWS = 3;

export function oldestDays(thoughts, now = Date.now()) {
  const oldest = (thoughts || []).reduce((m, t) => (Number.isFinite(t.createdAt) ? Math.min(m, t.createdAt) : m), Infinity);
  return Number.isFinite(oldest) ? Math.floor((now - oldest) / DAY_MS) : 0;
}

export const oldestLabel = (days) => (days > 0 ? `oldest ${days} ${days === 1 ? "day" : "days"}` : "");

// 78 §5–6: a thought keeps its lines, bold and underline; no markers shown.
export function ThoughtText({ text, highlights }) {
  return notebookRuns(text, highlights).map((r, i) => {
    let node = r.text;
    if (r.u) node = <u>{node}</u>;
    if (r.b) node = <strong>{node}</strong>;
    if (r.h) node = <mark className="thought-highlight" style={{ backgroundColor: highlightPaint(r.h) }}>{node}</mark>;
    return <React.Fragment key={i}>{node}</React.Fragment>;
  });
}

export default function ThoughtsList({
  thoughts = [],
  onMakeTask,
  onLetGo,
  onEdit,
  editing = null,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
  onSaveCopy,
  onShowAll,
  countAction = null,
  oldestFirst = false,
  onFlipOrder,
  all = false, // the phone's All N page: every row, no head
  now = Date.now(),
}) {
  const [picked, setPicked] = useState(null);
  const n = thoughts.length;
  if (!n && !editing) {
    return <p className="thoughts-empty">Nothing here yet. Type the first thing that’s bothering you, however small.</p>;
  }
  const ordered = newestThoughtsFirst(thoughts);
  if (oldestFirst) ordered.reverse();
  const days = oldestDays(thoughts, now);
  const current = editing && thoughts.find(t => t.id === editing.original.id);
  const editConflict = editing && !sameThoughtContent(current, editing.original);
  const finish = action => {
    const id = action?.();
    if (id) requestAnimationFrame(() => [...document.querySelectorAll(".thought-row")].find(row => row.dataset.thoughtId === String(id))?.focus());
  };

  const rowKeys = (e, t) => {
    if (e.target !== e.currentTarget) return; // a button inside keeps its own keys
    const row = e.currentTarget;
    const rows = [...row.parentElement.querySelectorAll(".thought-row")].filter(r => r.offsetParent !== null);
    const at = rows.indexOf(row);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[at + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    } else if (e.key === " ") {
      e.preventDefault();
      setPicked(p => (p === t.id ? null : t.id)); // opens or closes the full thought
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (editing?.original.id === t.id) return;
      onMakeTask(t);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (editing?.original.id === t.id) return;
      // Focus stays in the list: the next row, or the one above at the end.
      (rows[at + 1] || rows[at - 1])?.focus();
      onLetGo(t);
    } else if (e.key.toLowerCase() === "e" && onEdit && !editing) {
      e.preventDefault(); onEdit(t);
    }
  };

  return (
    <section className={`thoughts${all ? " is-all" : ""}${n > PHONE_SHOWS ? " has-more" : ""}`} aria-label="Thoughts">
      {editing && (
        <div className="thought-edit" role="region" aria-label="Edit thought">
          <p className="thought-edit-title">Edit thought</p>
          {editConflict && <p className="thought-edit-warning" role="status">{current ? "This thought changed on another device." : "This thought was removed on another device."} Your draft is kept here. Save it as a new thought to keep both versions.</p>}
          <ThoughtEditor notebook value={editing.text} highlights={editing.highlights} onChange={onEditChange}
            onSubmit={() => finish(onSaveEdit)} saveLabel="Save changes" saveDisabled={!!editConflict} autoFocus
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(onCancelEdit); } }} />
          <div className="thought-edit-actions">
            <button type="button" className="thought-btn" onClick={() => finish(onCancelEdit)}>Cancel</button>
            {editConflict && <button type="button" className="thought-btn is-make" disabled={n >= THOUGHTS_MAX || !notebookText(editing.text).trim() || notebookText(editing.text).length > THOUGHT_MAX_CHARS} onClick={() => finish(onSaveCopy)}>Save as new thought</button>}
          </div>
          {editConflict && n >= THOUGHTS_MAX && <p className="thought-edit-warning">Let another thought go to make room before saving this copy.</p>}
        </div>
      )}
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
            data-thought-id={t.id}
            tabIndex={0}
            onKeyDown={(e) => rowKeys(e, t)}
            onClick={(e) => { if (!e.target.closest("button")) setPicked(p => (p === t.id ? null : t.id)); }}
          >
            <span className="thought-text"><ThoughtText text={thoughtText(t)} highlights={t.highlights} /></span>
            {onEdit && <button type="button" className="thought-edit-link" aria-label="Edit thought" title="Edit thought (E)" disabled={!!editing} onClick={() => onEdit(t)}><IconPencil size={17} /></button>}
            {thoughtDate(t.createdAt, now) && <time className="thought-age" dateTime={new Date(t.createdAt).toISOString()} aria-label={`Added ${new Date(t.createdAt).toLocaleString("en-GB")}${t.updatedAt > t.createdAt ? `; edited ${new Date(t.updatedAt).toLocaleString("en-GB")}` : ""}`} title={`Added ${new Date(t.createdAt).toLocaleString("en-GB")}${t.updatedAt > t.createdAt ? `; edited ${new Date(t.updatedAt).toLocaleString("en-GB")}` : ""}`}>
              {thoughtDate(t.createdAt, now)}{t.updatedAt > t.createdAt ? " · Edited" : ""}
            </time>}
            <span className="thought-actions">
              <button type="button" className="thought-btn is-make" disabled={editing?.original.id === t.id} onClick={() => onMakeTask(t)}>
                <IconSquareCheck size={17} />Make it a task
              </button>
              <button type="button" className="thought-btn is-quiet" disabled={editing?.original.id === t.id} onClick={() => onLetGo(t)}>
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
