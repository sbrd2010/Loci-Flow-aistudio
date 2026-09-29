import React, { useEffect, useRef, useState } from "react";
import { IconPin, IconPlus, IconX, IconChevronRight, IconChevronDown, IconCheck } from "./ui/icons";
import { useAutosave } from "./settings/ui";
import { ROADMAP_HORIZONS } from "./TaskRow";
import { safeUUID } from "../utils/uuid";
import { taskSteps } from "../utils/taskSteps";
import { suggestSteps } from "../utils/stepSuggestions";
import { formatReminderLabel } from "../utils/reminders";
import { notifPermissionState, requestNotifPermission } from "../utils/nativeNotifs";
import { isEventTask } from "../utils/dayMapRoute";
import "../styles/taskDetail.css";

// A task, opened (turn 50, 50a–b). Tapping a row opens it: a full-height
// bottom sheet on phones, a 480px drawer beside the list on a laptop that is
// not modal, so the list stays usable. Everything saves as you type. From
// here: make it the one thing, or Tomorrow / Park / Delete, each with Undo;
// Done is the title's circle (52a). A task in another horizon (Plan, 52h) has "Move to Today" instead,
// then Pin to top · Park · Delete; Done is its circle, and the one thing and
// Must-do are Today's alone.

const HORIZONS = [{ key: "today", label: "Today" }, ...ROADMAP_HORIZONS];
const ESTIMATES = [15, 30, 60, 120, 180];
// Every other length Add task offers, so the sheet — the only editor — can
// set any of them (Codex review of #418).
const OTHER_ESTIMATES = [10, 20, 25, 45, 90, 240, 360];
const CATEGORIES = ["Career", "Health", "Work", "Personal"];

// "YYYY-MM-DD" and "HH:MM" in local time, for the reminder's inputs.
function localDateTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
// A new reminder starts at the next whole hour.
function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.getTime();
}

export function formatEstimate(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return "None";
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m / 60}h`;
}

export default function TaskDetail({
  task, index = 0, total = 0, variant = "drawer", isGoal = false, fronts = [],
  onClose, onPatch, onToggleMVD, onSetSteps,
  onMakeOneThing, onDone, onTomorrow, onPark, onDelete, editTitleSignal = 0,
  isNow = false, onLetGo,
  onShowAll, kicker = null, onMoveToToday, onTogglePin, onRemoveFromRoute, onFixTime, onUnfix, fixedAt = null,
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

  // "More · Reminder, category" (52b–c), closed until opened; and the
  // suggested steps (52c), which are offered, never added on their own.
  const [moreOpen, setMoreOpen] = useState(false);
  const [suggested, setSuggested] = useState(null); // { loading } | { steps } | { error }
  // A new task shown (↑/↓) closes any open picker; arriving focuses the title
  // so a screen reader hears which task this is.
  useEffect(() => { setPicker(null); setEditingTitle(false); setMoreOpen(false); setSuggested(null); }, [task.uuid]);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [task.uuid]);
  // E from the list edits the title.
  useEffect(() => { if (editTitleSignal) setEditingTitle(true); }, [editTitleSignal]);
  useEffect(() => { if (editingTitle) titleInputRef.current?.select(); }, [editingTitle]);

  // The first step is step 1 (52): a task that only has one is shown with it.
  const steps = taskSteps(task);
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
  // Every step change goes up as the whole list (stepsPatch gives a first step
  // shown from the old field an id of its own).
  const stepsRef = useRef(null);
  const setSteps = (next, meta) => onSetSteps?.(next, meta);
  const addStep = (text = newStep) => {
    const t = text.trim();
    if (!t) return;
    setSteps([...steps, { id: safeUUID(), text: t.slice(0, 300), done: false }]);
    if (text === newStep) setNewStep("");
  };
  const toggleStep = id => setSteps(steps.map(st => (st.id === id ? { ...st, done: !st.done } : st)));
  // A step edited and not yet left is saved when the sheet closes (Esc
  // closes it with focus still in the step), as the title and note are.
  const stepDraftsRef = useRef({});
  const latestStepsRef = useRef(steps);
  latestStepsRef.current = steps;
  const onSetStepsRef = useRef(onSetSteps);
  onSetStepsRef.current = onSetSteps;
  useEffect(() => () => {
    const drafts = stepDraftsRef.current;
    if (!Object.keys(drafts).length) return;
    const next = latestStepsRef.current
      .map(st => (st.id in drafts ? { ...st, text: drafts[st.id].trim().slice(0, 300) } : st))
      .filter(st => st.text);
    onSetStepsRef.current?.(next);
  }, []);

  // A step left empty is removed, with Undo — however it was emptied — so
  // the sheet never shows a blank step while the old text stays saved.
  const editStep = (id, text) => {
    delete stepDraftsRef.current[id];
    const t = text.trim();
    const cur = steps.find(st => st.id === id);
    if (!cur || t === cur.text) return;
    if (!t) { removeStep(id); return; }
    setSteps(steps.map(st => (st.id === id ? { ...st, text: t.slice(0, 300) } : st)));
  };
  const removeStep = (id) => {
    const at = steps.findIndex(st => st.id === id);
    if (at === -1) return;
    setSteps(steps.filter(st => st.id !== id), { removed: steps[at], atIndex: at });
  };
  // Backspace in an empty step deletes it (52), and focus goes to the step
  // before it, or to "Add a step".
  const focusStepInput = (i) => requestAnimationFrame(() => {
    const inputs = stepsRef.current?.querySelectorAll(".detail-step-input");
    (inputs?.[i] || rootRef.current?.querySelector(".detail-add-step-input"))?.focus();
  });
  // A step wraps like text; the field grows to fit it.
  const fitHeight = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  const onStepKeyDown = (e, st, i) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); focusStepInput(i + 1); return; }
    if (e.key === "Backspace" && e.currentTarget.value === "") {
      // Leaving the empty step removes it (editStep); focus goes back one.
      e.preventDefault();
      e.currentTarget.blur();
      focusStepInput(Math.max(0, i - 1));
    }
  };
  const askForSteps = async () => {
    setSuggested({ loading: true });
    const res = await suggestSteps(task, steps);
    setSuggested(res.steps ? { steps: res.steps } : { error: res.error });
  };
  // A suggestion already among the steps (typed meanwhile) is not added twice.
  const hasStep = (text) => steps.some(st => st.text.trim().toLowerCase() === text.trim().toLowerCase());
  const takeSuggestion = (text) => {
    if (!hasStep(text)) addStep(text);
    setSuggested(sug => {
      const left = (sug?.steps || []).filter(s => s !== text);
      return left.length ? { steps: left } : null;
    });
  };
  const takeAllSuggestions = () => {
    const add = (suggested?.steps || []).filter(text => !hasStep(text)).map(text => ({ id: safeUUID(), text, done: false }));
    if (add.length) setSteps([...steps, ...add]);
    setSuggested(null);
  };

  // Reminder: the time is kept as the two inputs show it and saved on each
  // change; a time already past is not saved.
  const [remind, setRemind] = useState(() => localDateTime(task.reminderAt || nextHour()));
  useEffect(() => { setRemind(localDateTime(task.reminderAt || nextHour())); }, [task.uuid, task.reminderAt]);
  const saveReminder = async (next) => {
    setRemind(next);
    const at = new Date(`${next.date}T${next.time}`).getTime();
    if (!Number.isFinite(at) || at <= Date.now()) return;
    if (notifPermissionState() === "default") await requestNotifPermission();
    if (at !== task.reminderAt) onPatch({ reminderAt: at });
  };

  // Three priorities (45a); a task that has the older P4 keeps it on offer
  // while it is open, as the full editor does, so it can be chosen back.
  const [hadP4] = useState(task.priority === "P4");
  const priorities = ["P1", "P2", "P3", ...(hadP4 ? ["P4"] : [])];
  // Likewise an estimate the chips don't carry (25m, the app's default, or
  // one set in the full editor) stays on offer, in order.
  const [openedEstimate] = useState(() => Number(task.timeEstimateMinutes) || null);
  const estimates = openedEstimate && !ESTIMATES.includes(openedEstimate)
    ? [...ESTIMATES, openedEstimate].sort((a, b) => a - b)
    : ESTIMATES;

  const isHorizon = typeof onMoveToToday === "function";
  // Opened from a Day map stop: its footer takes the stop off the route.
  const isRoute = typeof onRemoveFromRoute === "function";
  const kbd = k => isDrawer && !isHorizon && !isRoute && <kbd className="wall-key detail-key" aria-hidden="true">{k}</kbd>;

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
      style={isDrawer && drawerTop !== null ? { top: `${drawerTop}px` } : undefined}
    >
      {!isDrawer && <span className="detail-grabber" aria-hidden="true" />}
      <div className="detail-top">
        {/* A Day map stop the Must-do filter hides (52): it opens anyway,
            and the filter stays the user's to change. */}
        <span className="detail-kicker">{kicker || (isNow ? "TODAY · THE ONE THING" : onShowAll ? "TODAY · HIDDEN BY MUST-DO" : `TODAY · ${index + 1} OF ${total}`)}</span>
        {onShowAll && <button type="button" className="detail-showall" onClick={onShowAll}>Show all</button>}
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
                  // Enter and Escape hand focus back to the title, so the
                  // sheet's keys (Esc to close) still reach it.
                  const refocus = () => requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
                  if (e.key === "Enter") { e.preventDefault(); finishTitle(); refocus(); }
                  if (e.key === "Escape") { e.stopPropagation(); setTitle(task.title); setEditingTitle(false); refocus(); }
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
              {isDrawer && !isHorizon && !isRoute && !editingTitle && <span className="detail-hint">E to edit the title</span>}
            </div>
          </div>
        </div>

        <div className="detail-rows">
          <div className="detail-row">
            <span className="detail-label" id="detail-priority">Priority</span>
            <div className="detail-seg" role="radiogroup" aria-labelledby="detail-priority">
              {priorities.map(p => (
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
              {/* A route stop always has a length, so None is not offered there. */}
              {(isRoute ? estimates : [...estimates, null]).map(m => (
                <button key={m || "none"} type="button" role="radio" aria-checked={(Number(task.timeEstimateMinutes) || null) === m} className="detail-chip"
                  onClick={() => { setPicker(null); onPatch({ timeEstimateMinutes: m }); }}>
                  {formatEstimate(m)}
                </button>
              ))}
              <select className="detail-input detail-estimate-other" aria-label="Other length"
                value={OTHER_ESTIMATES.includes(Number(task.timeEstimateMinutes)) ? String(task.timeEstimateMinutes) : ""}
                onChange={e => { if (!e.target.value) return; setPicker(null); onPatch({ timeEstimateMinutes: Number(e.target.value) }); }}>
                <option value="">Other…</option>
                {OTHER_ESTIMATES.map(m => <option key={m} value={m}>{formatEstimate(m)}</option>)}
              </select>
            </div>
          )}

          {onToggleMVD && (
            <div className="detail-row">
              <span className="detail-label">{isDrawer ? "Must-do" : "Must-do today"}</span>
              <button type="button" role="switch" className="today-energy-switch detail-switch" aria-checked={!!task.isMVD} aria-label="Must-do" onClick={onToggleMVD} />
            </div>
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
          <span className="detail-kicker" id="detail-steps">STEPS{steps.length ? ` · ${doneSteps} OF ${steps.length}` : ""}</span>
          <ul className="detail-steps" ref={stepsRef} aria-labelledby="detail-steps">
            {steps.map((st, i) => (
              <li key={st.id} className={`detail-step${st.done ? " is-done" : ""}`}>
                <button type="button" className="detail-step-check" role="checkbox" aria-checked={!!st.done} aria-label={st.text} onClick={() => toggleStep(st.id)}>
                  {st.done && <IconCheck size={14} />}
                </button>
                <textarea
                  key={st.text}
                  ref={fitHeight}
                  rows={1}
                  className="detail-step-input"
                  defaultValue={st.text}
                  aria-label={`Step ${i + 1}`}
                  maxLength={300}
                  onInput={e => { fitHeight(e.currentTarget); stepDraftsRef.current[st.id] = e.currentTarget.value; }}
                  onBlur={e => editStep(st.id, e.target.value)}
                  onKeyDown={e => onStepKeyDown(e, st, i)}
                />
                <button type="button" className="detail-step-remove" aria-label={`Remove step ${st.text}`} onClick={() => removeStep(st.id)}>
                  <IconX size={14} />
                </button>
              </li>
            ))}
          </ul>
          {/* 52c: suggestions are offered, never added until tapped. */}
          {suggested?.steps && (
            <div className="detail-suggested">
              <div className="detail-suggested-head">
                <span className="detail-kicker">SUGGESTED · {suggested.steps.length}</span>
                <button type="button" className="detail-text-btn" onClick={takeAllSuggestions}>Add all</button>
                <button type="button" className="detail-text-btn" onClick={() => setSuggested(null)}>Dismiss</button>
              </div>
              <ul className="detail-suggested-list">
                {suggested.steps.map(text => (
                  <li key={text} className="detail-suggested-row">
                    <IconPlus size={16} />
                    <span className="detail-suggested-text">{text}</span>
                    <button type="button" className="detail-text-btn" aria-label={`Add step ${text}`} onClick={() => takeSuggestion(text)}>Add</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {suggested?.error && (
            <p className="detail-suggest-note" role="status">
              {suggested.error === "no-key" ? "Add an AI key in Settings to get suggested steps." : "Couldn't suggest steps just now. Try again."}
            </p>
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
              onBlur={() => addStep()}
            />
            <button type="button" className="detail-suggest" onClick={askForSteps} disabled={!!suggested?.loading}>
              {suggested?.loading ? "Suggesting…" : suggested ? "Suggest again" : "Suggest steps"}
            </button>
          </div>
        </div>

        {/* 52b–c: reminder and category, in place of a separate editor. */}
        <div className="detail-more">
          <button type="button" className="detail-row is-link detail-more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
            <span className="detail-label">More <span className="detail-more-hint">· Reminder, category</span></span>
            <IconChevronDown size={18} />
          </button>
          {moreOpen && (
            <div className="detail-more-body">
              <button type="button" className="detail-row is-link" aria-expanded={picker === "reminder"} onClick={() => togglePicker("reminder")}>
                <span className="detail-label">Reminder</span>
                <span className="detail-value">{task.reminderAt ? formatReminderLabel(task.reminderAt) : "None"}</span>
                <IconChevronRight size={18} />
              </button>
              {picker === "reminder" && (
                <div className="detail-options detail-reminder">
                  <input type="date" className="detail-input" aria-label="Reminder date" value={remind.date} min={localDateTime(Date.now()).date}
                    onChange={e => saveReminder({ ...remind, date: e.target.value })} />
                  <input type="time" className="detail-input" aria-label="Reminder time" value={remind.time}
                    onChange={e => saveReminder({ ...remind, time: e.target.value })} />
                  {task.reminderAt ? (
                    <button type="button" className="detail-text-btn" onClick={() => { setPicker(null); onPatch({ reminderAt: null }); }}>No reminder</button>
                  ) : (
                    <button type="button" className="detail-text-btn" onClick={() => saveReminder(remind)}>Set reminder</button>
                  )}
                </div>
              )}
              <button type="button" className="detail-row is-link" aria-expanded={picker === "category"} onClick={() => togglePicker("category")}>
                <span className="detail-label">Category</span>
                <span className="detail-value">{task.category || "Personal"}</span>
                <IconChevronRight size={18} />
              </button>
              {picker === "category" && (
                <div className="detail-options" role="radiogroup" aria-label="Category">
                  {CATEGORIES.map(c => (
                    <button key={c} type="button" role="radio" aria-checked={(task.category || "Personal") === c} className="detail-option"
                      onClick={() => { setPicker(null); if (c !== task.category) onPatch({ category: c }); }}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isRoute ? (
        <div className="detail-foot">
          {/* 58: a stop's time can be fixed from its sheet; a fixed one can
              change its time or flow with the route again. */}
          {onFixTime && (
            <button type="button" className="detail-one" onClick={onFixTime}>
              {fixedAt ? `Fixed at ${fixedAt} · Change time` : "Fix time"}
            </button>
          )}
          {onUnfix && <button type="button" className="detail-one" onClick={onUnfix}>Unfix</button>}
          <button type="button" className="detail-one" onClick={onRemoveFromRoute}>Remove from route</button>
          <div className="detail-actions">
            <button type="button" className="detail-action" onClick={onPark}>Park</button>
            <button type="button" className="detail-action is-quiet" onClick={onDelete}>Delete</button>
          </div>
        </div>
      ) : isHorizon ? (
        <div className="detail-foot">
          <button type="button" className="detail-one" onClick={onMoveToToday}>Move to Today</button>
          <div className="detail-actions">
            <button type="button" className="detail-action" onClick={onTogglePin}>{task.isHorizonPinned ? "Unpin" : "Pin to top"}</button>
            <button type="button" className="detail-action" onClick={onPark}>Park</button>
            <button type="button" className="detail-action is-quiet" onClick={onDelete}>Delete</button>
          </div>
        </div>
      ) : (
      <div className="detail-foot">
        {/* Q31: something at a set time is never the one thing. */}
        {!task.isNowFocus && !isEventTask(task) && (
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
          <button type="button" className="detail-action" onClick={onTomorrow}>Tomorrow {kbd("T")}</button>
          <button type="button" className="detail-action" onClick={onPark}>Park</button>
          <button type="button" className="detail-action is-quiet" onClick={onDelete}>Delete {kbd("⌫")}</button>
        </div>
      </div>
      )}
    </div>
  );
}
