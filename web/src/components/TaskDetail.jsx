import React, { useEffect, useRef, useState } from "react";
import { IconPin, IconPlus, IconX, IconChevronRight, IconCheck } from "./ui/icons";
import { useAutosave } from "./settings/ui";
import { ROADMAP_HORIZONS } from "./TaskRow";
import "../styles/taskDetail.css";

// A task, opened (turn 50, 50a–b). Tapping a row opens it: a full-height
// bottom sheet on phones, a 480px drawer beside the list on a laptop that is
// not modal, so the list stays usable. Everything saves as you type. From
// here: make it the one thing, or Done / Tomorrow / Park / Delete, each with
// Undo.

const HORIZONS = [{ key: "today", label: "Today" }, ...ROADMAP_HORIZONS];
const ESTIMATES = [15, 30, 60, 120, 180];

export function formatEstimate(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return "None";
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m / 60}h`;
}

export default function TaskDetail({
  task, index = 0, total = 0, variant = "drawer", isGoal = false, fronts = [],
  onClose, onPatch, onToggleMVD, onToggleStep, onAddStep, onDeleteStep,
  onMakeOneThing, onDone, onTomorrow, onPark, onDelete, editTitleSignal = 0,
  onMoreDetails, onSuggestSteps, suggestingSteps = false, isNow = false, onLetGo,
}) {
  const [picker, setPicker] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [newStep, setNewStep] = useState("");
  const headingRef = useRef(null);
  // The drawer starts under the header, wherever the header ends (a demo or
  // offline banner can push it down).
  const [drawerTop, setDrawerTop] = useState(null);
  useEffect(() => {
    if (variant !== "drawer") return undefined;
    const measure = () => {
      const bottom = document.querySelector(".shell-header")?.getBoundingClientRect().bottom;
      setDrawerTop(Number.isFinite(bottom) ? Math.max(0, bottom) : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); };
  }, [variant]);
  const titleInputRef = useRef(null);

  const [title, setTitle, flushTitle] = useAutosave(task.title, v => {
    const t = v.trim();
    if (t && t !== task.title) onPatch({ title: t });
  });
  const [note, setNote, flushNote] = useAutosave(task.note || "", v => {
    if (v.trim() !== (task.note || "").trim()) onPatch({ note: v.trim() || null });
  });

  // A new task shown (↑/↓) closes any open picker; arriving focuses the title
  // so a screen reader hears which task this is.
  useEffect(() => { setPicker(null); setEditingTitle(false); }, [task.uuid]);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [task.uuid]);
  // E from the list edits the title.
  useEffect(() => { if (editTitleSignal) setEditingTitle(true); }, [editTitleSignal]);
  useEffect(() => { if (editingTitle) titleInputRef.current?.select(); }, [editingTitle]);

  const steps = Array.isArray(task.subSteps) ? task.subSteps : [];
  const doneSteps = steps.filter(s => s.done).length;
  const front = fronts.find(f => f.id === task.frontId) || null;
  const horizon = HORIZONS.find(h => h.key === task.horizonLevel) || HORIZONS[0];
  const isDrawer = variant === "drawer";
  const togglePicker = name => setPicker(p => (p === name ? null : name));

  const finishTitle = () => {
    flushTitle();
    if (!title.trim()) setTitle(task.title);
    setEditingTitle(false);
  };
  const addStep = () => {
    const text = newStep.trim();
    if (!text) return;
    onAddStep(text);
    setNewStep("");
  };

  const kbd = k => isDrawer && <kbd className="wall-key detail-key" aria-hidden="true">{k}</kbd>;

  // The phone sheet is modal: Tab stays inside it, as in the other sheets.
  // The laptop drawer is not, so Tab moves on to the page.
  const rootRef = useRef(null);
  const trapTab = (e) => {
    if (isDrawer || e.key !== "Tab") return;
    const items = [...(rootRef.current?.querySelectorAll("button:enabled, input:enabled, textarea:enabled, select:enabled, [tabindex='0']") || [])];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const inside = rootRef.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  };

  return (
    <div
      ref={rootRef}
      className={`task-detail is-${variant}`}
      onKeyDown={trapTab}
      role="dialog"
      aria-modal={isDrawer ? "false" : "true"}
      aria-label={`Task: ${task.title}`}
      data-testid="task-detail"
      style={drawerTop !== null ? { top: `${drawerTop}px` } : undefined}
    >
      {!isDrawer && <span className="detail-grabber" aria-hidden="true" />}
      <div className="detail-top">
        <span className="detail-kicker">{isNow ? "TODAY · THE ONE THING" : `TODAY · ${index + 1} OF ${total}`}</span>
        {isDrawer && !isNow && (
          <span className="detail-keys" aria-hidden="true">
            <kbd className="wall-key detail-key">↑ ↓</kbd><kbd className="wall-key detail-key">Esc</kbd>
          </span>
        )}
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close">
          <IconX size={20} />
        </button>
      </div>

      <div className="detail-scroll">
        <div className="detail-head">
          <button
            type="button"
            className={`detail-circle${task.isCompleted ? " is-done" : ""}`}
            onClick={onDone}
            aria-label={`Mark done: ${task.title}`}
          >
            <span aria-hidden="true">{task.isCompleted && <IconCheck size={14} />}</span>
          </button>
          <div className="detail-title-wrap">
            {editingTitle ? (
              <input
                ref={titleInputRef}
                className="detail-title-input"
                value={title}
                aria-label="Title"
                maxLength={1000}
                onChange={e => setTitle(e.target.value)}
                onBlur={finishTitle}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); finishTitle(); }
                  if (e.key === "Escape") { e.stopPropagation(); setTitle(task.title); setEditingTitle(false); }
                }}
              />
            ) : (
              <h2
                ref={headingRef}
                className="detail-title"
                tabIndex={-1}
                onClick={() => setEditingTitle(true)}
              >
                {task.title}
              </h2>
            )}
            <div className="detail-tags">
              {isGoal && <span className="task-tag is-goal">GOAL</span>}
              {isDrawer && !editingTitle && <span className="detail-hint">E to edit the title</span>}
            </div>
          </div>
        </div>

        <div className="detail-rows">
          <div className="detail-row">
            <span className="detail-label" id="detail-priority">Priority</span>
            <div className="detail-seg" role="radiogroup" aria-labelledby="detail-priority">
              {["P1", "P2", "P3"].map(p => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={task.priority === p}
                  aria-label={`Priority ${p.slice(1)}`}
                  className="detail-seg-opt"
                  onClick={() => task.priority !== p && onPatch({ priority: p })}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="detail-row is-link" aria-expanded={picker === "horizon"} onClick={() => togglePicker("horizon")}>
            <span className="detail-label">Horizon</span>
            <span className="detail-value">{horizon.label}</span>
            <IconChevronRight size={18} />
          </button>
          {picker === "horizon" && (
            <div className="detail-options" role="radiogroup" aria-label="Horizon">
              {HORIZONS.filter(h => h.key !== "office" || task.horizonLevel === "office").map(h => (
                <button key={h.key} type="button" role="radio" aria-checked={h.key === task.horizonLevel} className="detail-option"
                  onClick={() => { setPicker(null); if (h.key !== task.horizonLevel) onPatch({ horizonLevel: h.key }); }}>
                  {h.label}
                </button>
              ))}
            </div>
          )}

          <button type="button" className="detail-row is-link" aria-expanded={picker === "front"} onClick={() => togglePicker("front")}>
            <span className="detail-label">Front</span>
            <span className="detail-value">{front ? front.name : "None"}</span>
            <IconChevronRight size={18} />
          </button>
          {picker === "front" && (
            <div className="detail-options" role="radiogroup" aria-label="Front">
              {[{ id: null, name: "None" }, ...fronts].map(f => (
                <button key={f.id || "none"} type="button" role="radio" aria-checked={(task.frontId || null) === f.id} className="detail-option"
                  onClick={() => { setPicker(null); if ((task.frontId || null) !== f.id) onPatch({ frontId: f.id }); }}>
                  {f.name}
                </button>
              ))}
            </div>
          )}

          <button type="button" className="detail-row is-link" aria-expanded={picker === "estimate"} onClick={() => togglePicker("estimate")}>
            <span className="detail-label">Estimate</span>
            <span className="detail-value">{formatEstimate(task.timeEstimateMinutes)}</span>
            <IconChevronRight size={18} />
          </button>
          {picker === "estimate" && (
            <div className="detail-options is-chips" role="radiogroup" aria-label="Estimate">
              {[...ESTIMATES, null].map(m => (
                <button key={m || "none"} type="button" role="radio" aria-checked={(Number(task.timeEstimateMinutes) || null) === m} className="detail-chip"
                  onClick={() => { setPicker(null); onPatch({ timeEstimateMinutes: m }); }}>
                  {formatEstimate(m)}
                </button>
              ))}
            </div>
          )}

          <div className="detail-row">
            <span className="detail-label">{isDrawer ? "Must-do" : "Must-do today"}</span>
            <button type="button" role="switch" className="today-energy-switch detail-switch" aria-checked={!!task.isMVD} aria-label="Must-do" onClick={onToggleMVD} />
          </div>
          {/* Reminder, first step and category live in the full editor. */}
          {onMoreDetails && (
            <button type="button" className="detail-row is-link" onClick={onMoreDetails}>
              <span className="detail-label">More details</span>
              <span className="detail-value">Reminder, first step</span>
              <IconChevronRight size={18} />
            </button>
          )}
        </div>

        <label className="detail-block">
          <span className="detail-kicker">NOTE</span>
          <textarea
            className="detail-note"
            value={note}
            rows={2}
            maxLength={2000}
            placeholder="Add a note…"
            onChange={e => setNote(e.target.value)}
            onBlur={flushNote}
          />
        </label>

        <div className="detail-block">
          <span className="detail-kicker">STEPS{steps.length ? ` · ${doneSteps} OF ${steps.length}` : ""}</span>
          <ul className="detail-steps">
            {steps.map(s => (
              <li key={s.id} className={`detail-step${s.done ? " is-done" : ""}`}>
                <button type="button" className="detail-step-check" role="checkbox" aria-checked={!!s.done} aria-label={s.text} onClick={() => onToggleStep(s.id)}>
                  {s.done && <IconCheck size={14} />}
                </button>
                <span className="detail-step-text">{s.text}</span>
                {onDeleteStep && (
                  <button type="button" className="detail-step-remove" aria-label={`Remove step ${s.text}`} onClick={() => onDeleteStep(s.id)}>
                    <IconX size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {steps.length === 0 && onSuggestSteps && (
            <button type="button" className="detail-suggest" onClick={onSuggestSteps} disabled={suggestingSteps}>
              {suggestingSteps ? "Suggesting steps…" : "Suggest steps"}
            </button>
          )}
          <div className="detail-add-step">
            <IconPlus size={18} />
            <input
              className="detail-add-step-input"
              value={newStep}
              placeholder="Add a step…"
              aria-label="Add a step"
              maxLength={300}
              onChange={e => setNewStep(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStep(); } }}
              onBlur={addStep}
            />
          </div>
        </div>
      </div>

      <div className="detail-foot">
        {!task.isNowFocus && (
          <button type="button" className="detail-one" onClick={onMakeOneThing}>
            <IconPin size={18} /> Make this the one thing {kbd("P")}
          </button>
        )}
        {task.isNowFocus && onLetGo && (
          <button type="button" className="detail-one is-quiet" onClick={onLetGo}>
            Not the one thing now
          </button>
        )}
        <div className="detail-actions">
          {isDrawer && <button type="button" className="detail-action" onClick={onDone}>Done {kbd("D")}</button>}
          <button type="button" className="detail-action" onClick={onTomorrow}>Tomorrow {kbd("T")}</button>
          <button type="button" className="detail-action" onClick={onPark}>Park</button>
          <button type="button" className="detail-action is-quiet" onClick={onDelete}>Delete {kbd("⌫")}</button>
        </div>
      </div>
    </div>
  );
}
