import React, { useState } from "react";
import { MINIMUM_DAY_SIZE } from "../utils/minimumDay";

// Minimum day (56a–b, 57b answer 6): "If today goes wrong, do these 3".
// Suggested: the rows with their times, Confirm and Change. Confirmed: one
// line, with Change. Change lists today's open tasks with checkboxes, three
// at most (fewer is fine). `tasks` is today's open tasks in today's order;
// `timeOf(id)` is a row's time on the route ("NOW", "14:15") or "".
export default function MinimumDay({ state, ids, tasks, timeOf, onConfirm, unfit = 0 }) {
  const [editing, setEditing] = useState(null); // ids being picked, or null
  const byId = new Map(tasks.map(t => [String(t.uuid || t.id), t]));
  const picked = ids.map(id => byId.get(id)).filter(Boolean);

  if (editing) {
    const toggle = (id) => setEditing(cur => (cur.includes(id) ? cur.filter(x => x !== id) : cur.length < MINIMUM_DAY_SIZE ? [...cur, id] : cur));
    return (
      <section className="dm-min" aria-label="Minimum day">
        <h2 className="dm-min-title">If today goes wrong, do these {MINIMUM_DAY_SIZE}</h2>
        <ul className="dm-min-pick">
          {tasks.map(t => {
            const id = String(t.uuid || t.id);
            const on = editing.includes(id);
            return (
              <li key={id}>
                <label className="dm-min-option">
                  <input type="checkbox" checked={on} disabled={!on && editing.length >= MINIMUM_DAY_SIZE} onChange={() => toggle(id)} />
                  <span>{t.title}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="dm-min-actions">
          <button type="button" className="dm-btn-outline" onClick={() => { onConfirm(editing); setEditing(null); }}>Confirm</button>
          <button type="button" className="dm-text-btn" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </section>
    );
  }

  if (state === "confirmed") {
    return (
      <section className="dm-min is-confirmed" aria-label="Minimum day">
        <p className="dm-min-line">
          <span className="task-tag is-min">MIN</span>
          <span><strong>Minimum day</strong>{picked.length ? ` · ${picked.map(t => t.title).join(", ")}` : " · none picked"}</span>
        </p>
        <button type="button" className="dm-text-btn" onClick={() => setEditing(ids)}>Change</button>
      </section>
    );
  }

  return (
    <section className="dm-min" aria-label="Minimum day">
      <div className="dm-min-head">
        {/* Turn 76 (d): N is how many fit, 1 to 3. */}
        <h2 className="dm-min-title">{picked.length === 0 ? "If today goes wrong" : `If today goes wrong, ${picked.length === 1 ? "do this one" : `do these ${picked.length}`}`}</h2>
        <span className="dm-min-kicker">SUGGESTED</span>
      </div>
      {picked.length > 0 ? (
        <ul className="dm-min-list">
          {picked.map(t => {
            const id = String(t.uuid || t.id);
            return (
              <li key={id} className="dm-min-row">
                <span className="dm-min-name">{t.title}</span>
                <span className="dm-min-time">{timeOf(id)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="dm-min-empty">{unfit > 0 ? "Your must-dos and goal tasks don’t fit before the day ends. Pick up to three." : "No must-dos or goal tasks today. Pick up to three."}</p>
      )}
      <div className="dm-min-actions">
        {picked.length > 0 && <button type="button" className="dm-btn-outline" onClick={() => onConfirm(ids)}>Confirm</button>}
        <button type="button" className="dm-text-btn" onClick={() => setEditing(ids)}>Change</button>
      </div>
    </section>
  );
}
