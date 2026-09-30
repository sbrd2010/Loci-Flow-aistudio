import React, { useEffect, useRef, useState } from "react";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import { IconEye, IconEyeOff, IconX } from "./ui/icons";
import { BUILT_IN_HORIZONS, currentPeriod, horizonsFromConfig, TODAY_ID } from "../utils/horizons";
import { dayLabel } from "../utils/planLadder";
import { safeUUID } from "../utils/uuid";
import {
  applyHorizonDelete, deleteTargets, HORIZON_NAME_MAX, HORIZON_PRESETS, horizonRule, horizonSentence,
  makeHorizon, moveHorizonEnd, moveSentence, undoHorizonDelete,
} from "../utils/editHorizons";

// Edit horizons (57g), from Plan's header: each horizon's name (tap to
// rename), its rule in mono, Edit on one you added, and an eye to hide or
// show it. Fixed order, no grip (Q44.2). Below, "Add a horizon" (Q45).
// A hidden horizon keeps its tasks, off Plan (Q44.3).
const isBuiltIn = (id) => BUILT_IN_HORIZONS.some(b => b.id === id);

// savePayloadAsync takes { expectedRemovals }: three or more drops in one
// save trip the sync's drop guard otherwise, and nothing is written.
// focusedUuid/onEndFocus: dropping the task a session is running on ends
// that session first, recorded, as deleting it does (Codex review of #444).
export default function EditHorizons({ payload, day, saveConfigPatch, savePayload, savePayloadAsync, focusedUuid = null, onEndFocus, onClose }) {
  const config = payload.config || {};
  const saved = config.horizons && typeof config.horizons === "object" ? config.horizons : {};
  const horizons = horizonsFromConfig(config, day);
  const visible = horizons.filter(h => !h.hidden).length;
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const [renaming, setRenaming] = useState(null); // { id, value }
  const [editing, setEditing] = useState(null); // { id, endDate }
  const [deleting, setDeleting] = useState(null); // { id, choices }
  const [preset, setPreset] = useState(null); // a preset key, "other", or null
  const [name, setName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [undo, setUndo] = useState(null); // { id, name, before, at }

  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  // Esc steps back out of a panel, then closes.
  const back = useRef(null);
  back.current = () => {
    if (deleting) setDeleting(null);
    else if (editing) setEditing(null);
    else if (renaming) setRenaming(null);
    else onClose();
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); back.current(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const patchHorizon = (id, patch) => saveConfigPatch({ horizons: { ...saved, [id]: { ...(saved[id] || {}), ...patch } } });
  const finishRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim().slice(0, HORIZON_NAME_MAX);
    const h = horizons.find(x => x.id === renaming.id);
    // Empty gives a built-in its own name back; one you added keeps its name.
    if (h && value !== h.name && (value || isBuiltIn(h.id))) patchHorizon(h.id, { name: value });
    setRenaming(null);
  };

  const draft = preset ? makeHorizon(
    preset === "other" ? { name, endDate } : { preset, name },
    day, "draft",
  ) : null;
  const addHorizon = () => {
    if (!draft) return;
    const id = `h_${safeUUID().slice(0, 8)}`;
    saveConfigPatch({ horizons: { ...saved, [id]: { ...draft, id } } });
    setPreset(null); setName(""); setEndDate("");
  };
  const pickPreset = (key) => {
    setPreset(key);
    setName(key === "other" ? "" : HORIZON_PRESETS.find(p => p.key === key).name);
    setEndDate("");
  };

  const openTasks = (id) => (payload.tasks || []).filter(t => t.horizonLevel === id && !t.isDeleted && !t.isCompleted && !t.isParked);
  const startDelete = (id) => {
    const { defaultTo } = deleteTargets(config, id, day);
    setDeleting({ id, choices: Object.fromEntries(openTasks(id).map(t => [t.uuid, defaultTo])) });
  };
  const confirmDelete = () => {
    const before = payloadRef.current;
    const h = horizons.find(x => x.id === deleting.id);
    const drops = Object.keys(deleting.choices).filter(uuid => deleting.choices[uuid] === "drop");
    if (focusedUuid && drops.includes(String(focusedUuid))) onEndFocus?.();
    const next = applyHorizonDelete(before, deleting.id, deleting.choices);
    const id = deleting.id;
    setDeleting(null); setEditing(null);
    const saved = savePayloadAsync ? savePayloadAsync(next, { expectedRemovals: drops }) : Promise.resolve(savePayload(next));
    saved.then(() => setUndo({ id, name: h?.name || "", before, at: Date.now() })).catch(() => {});
  };
  const handleUndo = () => {
    if (!undo) return;
    savePayload(undoHorizonDelete(payloadRef.current, undo.before, undo.id));
    setUndo(null);
  };

  let body;
  if (deleting) {
    const h = horizons.find(x => x.id === deleting.id);
    const tasks = openTasks(deleting.id);
    const { defaultTo, largerName } = deleteTargets(config, deleting.id, day);
    const options = [
      ...(defaultTo !== TODAY_ID ? [{ to: defaultTo, label: largerName }] : []),
      { to: TODAY_ID, label: "Today" },
      { to: "drop", label: "Drop" },
    ];
    body = (
      <section className="eh-panel" aria-labelledby="eh-del-title">
        <h3 className="eh-sub" id="eh-del-title">Delete {h?.name}?</h3>
        <p className="eh-note">
          {tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task needs" : "tasks need"} a place.` : "It holds no open tasks."}
        </p>
        {tasks.length > 0 && (
          <ul className="eh-places">
            {tasks.map(t => (
              <li key={t.uuid} className="eh-place">
                <span className="eh-place-title">{t.title}</span>
                <span className="eh-seg" role="radiogroup" aria-label={`Where ${t.title} goes`}>
                  {options.map(o => (
                    <button key={o.to} type="button" role="radio" className="eh-seg-opt"
                      aria-checked={deleting.choices[t.uuid] === o.to}
                      onClick={() => setDeleting(d => ({ ...d, choices: { ...d.choices, [t.uuid]: o.to } }))}>
                      {o.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="eh-actions">
          <button type="button" className="eh-btn is-danger" onClick={confirmDelete}>Delete horizon</button>
          <button type="button" className="eh-btn" onClick={() => setDeleting(null)}>Cancel</button>
        </div>
      </section>
    );
  } else if (editing) {
    const h = horizons.find(x => x.id === editing.id);
    const moved = h && editing.endDate ? moveHorizonEnd(h, editing.endDate, day) : null;
    body = (
      <section className="eh-panel" aria-labelledby="eh-edit-title">
        <h3 className="eh-sub" id="eh-edit-title">{h?.name}</h3>
        <label className="eh-label" htmlFor="eh-edit-end">This period ends</label>
        <input id="eh-edit-end" className="eh-input" type="date" min={day} value={editing.endDate}
          onChange={e => setEditing(x => ({ ...x, endDate: e.target.value }))} />
        {moved && <p className="eh-note">{moveSentence(moved, editing.endDate, day)}</p>}
        <div className="eh-actions">
          <button type="button" className="eh-btn is-primary" disabled={!moved}
            onClick={() => { const { id, ...rest } = moved; saveConfigPatch({ horizons: { ...saved, [id]: { id, ...rest } } }); setEditing(null); }}>
            Save
          </button>
          <button type="button" className="eh-btn" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="eh-btn is-danger eh-delete" onClick={() => startDelete(editing.id)}>Delete horizon</button>
        </div>
      </section>
    );
  } else {
    body = (
      <>
        <ul className="eh-list">
          {horizons.map(h => (
            <li key={h.id} className={`eh-row${h.hidden ? " is-hidden" : ""}`}>
              <div className="eh-main">
                {renaming?.id === h.id ? (
                  <input
                    className="eh-input eh-rename"
                    aria-label={`Name of ${h.name}`}
                    value={renaming.value}
                    maxLength={HORIZON_NAME_MAX}
                    autoFocus
                    onChange={e => setRenaming({ id: h.id, value: e.target.value })}
                    onBlur={finishRename}
                    onKeyDown={e => { if (e.key === "Enter") finishRename(); }}
                  />
                ) : (
                  <button type="button" className="eh-name" aria-label={`Rename ${h.name}`}
                    onClick={() => setRenaming({ id: h.id, value: h.name })}>
                    {h.name}
                  </button>
                )}
                <span className="eh-rule">{horizonRule(h, day)}</span>
              </div>
              {!isBuiltIn(h.id) && (
                <button type="button" className="eh-edit" aria-label={`Edit ${h.name}`}
                  onClick={() => setEditing({ id: h.id, endDate: currentPeriod(h, day).end })}>
                  Edit
                </button>
              )}
              {/* The last one shown stays: Plan needs a rung. */}
              <button type="button" className="eh-eye" aria-pressed={!h.hidden}
                aria-label={`${h.hidden ? "Show" : "Hide"} ${h.name}`}
                disabled={!h.hidden && visible <= 1}
                onClick={() => patchHorizon(h.id, { hidden: !h.hidden })}>
                {h.hidden ? <IconEyeOff size={20} /> : <IconEye size={20} />}
              </button>
            </li>
          ))}
        </ul>

        <section className="eh-add" aria-labelledby="eh-add-title">
          <h3 className="eh-sub" id="eh-add-title">Add a horizon</h3>
          <div className="eh-presets" role="radiogroup" aria-label="Length">
            {[...HORIZON_PRESETS, { key: "other", name: "Something else…" }].map(p => (
              <button key={p.key} type="button" role="radio" className="eh-chip" aria-checked={preset === p.key} onClick={() => pickPreset(p.key)}>
                {p.name}
              </button>
            ))}
          </div>
          {preset && (
            <>
              <label className="eh-label" htmlFor="eh-add-name">Name</label>
              <input id="eh-add-name" className="eh-input" value={name} maxLength={HORIZON_NAME_MAX}
                placeholder="Grant round" onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addHorizon(); }} />
              {preset === "other" ? (
                <>
                  <label className="eh-label" htmlFor="eh-add-end">Ends</label>
                  <input id="eh-add-end" className="eh-input" type="date" min={day} value={endDate} onChange={e => setEndDate(e.target.value)} />
                </>
              ) : (
                <p className="eh-label">Ends <span className="eh-rule">{draft ? dayLabel(currentPeriod(draft, day).end, day) : ""}</span></p>
              )}
              {draft && <p className="eh-note">{horizonSentence(draft, day)}</p>}
              <button type="button" className="eh-btn" disabled={!draft} onClick={addHorizon}>Add horizon</button>
            </>
          )}
        </section>
      </>
    );
  }

  const undoText = undo ? `Deleted: ${undo.name}` : "";
  return (
    <div className="eh-scrim" onClick={onClose}>
      <div className="eh" role="dialog" aria-modal="true" aria-labelledby="eh-title" onClick={e => e.stopPropagation()}>
        <header className="eh-head">
          <h2 className="eh-title" id="eh-title" tabIndex={-1} ref={titleRef}>Edit horizons</h2>
          <button type="button" className="eh-close" aria-label="Close" onClick={onClose}><IconX size={20} /></button>
        </header>
        {body}
        <UndoAnnouncer message={undoText} />
        {undo && <UndoToast key={undo.at} message={undoText} onUndo={handleUndo} onClose={() => setUndo(null)} />}
      </div>
    </div>
  );
}
