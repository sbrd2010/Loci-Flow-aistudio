import React, { useEffect, useMemo, useRef, useState } from "react";
import GrowTextarea from "./ui/GrowTextarea";
import ReminderPicker from "./ui/ReminderPicker";
import { isEveningGuardBlocked } from "../utils/eveningGuard";
import { callAI, getAIKeys, hasAIKey } from "../utils/aiCall";
import { buildLocalSafetyReply } from "../utils/crisisSafety";
import { buildAskAIRequest } from "../utils/aiTaskPrompts";
import { retryUnreadable } from "../utils/aiRetry";
import { safeUUID } from "../utils/uuid";
import { formatReminderLabel } from "../utils/reminders";
import { addTaskToPayload } from "../utils/addTaskToPayload";
import { notifPermissionState, requestNotifPermission as nativeRequestPermission } from "../utils/nativeNotifs";
import { getFocusWindows, getLociDayStr } from "../utils/focusWindows";
import { BUILT_IN_HORIZONS, horizonsFromConfig } from "../utils/horizons";
import { frontsFromConfig, sortFronts } from "../utils/fronts";
import { buildTaskMutationEvent, eventPatch } from "../utils/activityLog";
import { IconCheck, IconChevronDown, IconChevronRight, IconClock, IconPencil, IconSmile, IconSparkles, IconX } from "./ui/icons";
import { THOUGHTS_MAX, addThought, thoughtTaskDraft } from "../utils/thoughts";
import { escapeThought, plainThought } from "../utils/thoughtFormat";
import ThoughtEditor, { THOUGHT_EMOJI } from "./ui/ThoughtEditor";
import EstimatePicker from "./EstimatePicker";
import { formatEstimate } from "../utils/estimates";
import { defaultReminderDateTime } from "../utils/clockText";
import "../styles/addTask.css";

function parseManualSubSteps(raw) {
  return raw
    .split("\n")
    .map(line => line.trim().replace(/^(?:[-*•‣▪–—]+|\[[ xX]\]|\d+[.):](?!\d)|[a-zA-Z][.):])\s*/, "").trim())
    .filter(Boolean);
}


// What the estimate selector shows for a task that has none. Named because
// the save path has to tell "the user chose 25" from "nobody chose anything".
const DEFAULT_ESTIMATE_MINUTES = 25;
const EVENING_GUARD_MESSAGE = "Evening Guard is on: no new tasks at or after 8 PM. Rest now.";

export default function AddTaskDialog({ email, payload, savePayload, savePayloadAsync, userProfile, defaultHorizon, defaultFrontId = null, openedFrom = null, onClose, uid, writeActivityEvents, initialMode = "task", initialTitle = "", fromThoughtId = null, onThoughtSaved }) {
  const windows = getFocusWindows(payload.config || {});
  const [sourceThought] = useState(() => fromThoughtId ? (payload.brainDump || []).find(t => t.id === fromThoughtId) : null);
  const sourceDraft = sourceThought ? thoughtTaskDraft(sourceThought) : null;
  const [title, setTitle] = useState(sourceDraft?.title ?? initialTitle);
  // Q56: Add opens with Task | Thought. A thought made into a task (Mind Box's
  // "Make it a task") stays a task, so it shows no switch.
  const [mode, setMode] = useState(fromThoughtId ? "task" : initialMode);
  const [thoughtError, setThoughtError] = useState("");
  const [concreteStep, setConcreteStep] = useState("");
  const [horizonLevel, setHorizonLevel] = useState(defaultHorizon || "today");
  const [saved, setSaved] = useState(false);
  const [priority, setPriority] = useState("P3");
  const [category, setCategory] = useState("Personal");
  // "" means no front. Stored as null, never "", so the field is absent rather
  // than empty for a task that belongs to nothing.
  const [frontId, setFrontId] = useState(defaultFrontId || "");
  const [estimateMinutes, setEstimateMinutes] = useState(DEFAULT_ESTIMATE_MINUTES);
  // A task can legitimately have NO estimate, and the selector shows the
  // default for one. Comparing the value alone cannot tell "the user chose 25"
  // from "nobody chose anything", so choosing 25 on such a task — or leaving
  // and returning to it — would silently not stick. This records the act.
  const [estimatePicked, setEstimatePicked] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [subSteps, setSubSteps] = useState([]);
  const [subStepDraft, setSubStepDraft] = useState("");
  const [editingSubStepId, setEditingSubStepId] = useState(null);
  const [editingSubStepText, setEditingSubStepText] = useState("");
  // Fronts in the same order Plan shows them, so the picker reads like the
  // screen the user just came from. frontsFromConfig includes the projected
  // legacy Key Deadline, which is a real, selectable front.
  const fronts = useMemo(
    () => sortFronts(frontsFromConfig(payload.config || {}), new Date()),
    [payload.config],
  );

  const [formError, setFormError] = useState("");
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderDate, setReminderDate] = useState(() => defaultReminderDateTime().dateStr);
  const [reminderTime, setReminderTime] = useState(() => defaultReminderDateTime().timeStr);

  const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const hasAnyKey = hasAIKey();

  const handleAiSuggest = async () => {
    if (!title.trim()) { setAiError("Type a rough task idea first, then tap Ask AI."); return; }
    if (!hasAnyKey) { setAiError("No AI key — add one in Settings."); return; }
    // Crisis wording is answered here, not sent to the provider; the text stays in the field.
    const safetyReply = buildLocalSafetyReply(title, ((payload.config || {}).userName || "").split(" ")[0] || "friend");
    if (safetyReply) { setAiSuggestion(null); setAiError(safetyReply); return; }
    setAiLoading(true);
    setAiError("");
    setAiSuggestion(null);
    const cfg = payload.config || {};
    const request = buildAskAIRequest({ title, challengeType: cfg.challengeType, tasks: payload.tasks, profile: userProfile });

    try {
      const parsed = await retryUnreadable(
        () => callAI({ groqKey, geminiKey, cerebrasKey, zaiKey, ...request }),
        (raw) => {
          const cleaned = String(raw).replace(/```json|```/g, "").trim();
          try {
            return JSON.parse(cleaned);
          } catch {
            const match = cleaned.match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : null;
          }
        },
      );
      if (!parsed || typeof parsed !== "object") throw new Error("No JSON");
      setAiSuggestion({
        title: parsed.title || title.trim(),
        microStep: parsed.microStep || "",
        priority: parsed.priority,
        estimateMinutes: parsed.estimateMinutes,
        horizonLevel: parsed.horizonLevel,
        subSteps: Array.isArray(parsed.subSteps) ? parsed.subSteps.filter(s => s && s.text) : [],
      });
    } catch (err) {
      setAiError("AI suggestion failed — fill in manually.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddSubSteps = () => {
    const lines = parseManualSubSteps(subStepDraft);
    if (lines.length === 0) return;
    const now = Date.now();
    setSubSteps(prev => [
      ...prev,
      ...lines.map((text, i) => ({ id: `manual-ss-${now}-${i}`, text, done: false }))
    ]);
    setSubStepDraft("");
    setAdvancedOpen(true);
  };

  const handleApplyAISuggestion = () => {
    if (!aiSuggestion) return;
    {
      // AI may suggest all fields
      if (aiSuggestion.title) setTitle(aiSuggestion.title);
      if (aiSuggestion.microStep) { setConcreteStep(aiSuggestion.microStep); setAdvancedOpen(true); }
      if (["P1","P2","P3","P4"].includes(aiSuggestion.priority)) setPriority(aiSuggestion.priority);
      const est = Number(aiSuggestion.estimateMinutes);
      // A value with no chip of its own shows under Other, so it is never
      // chosen without being seen.
      if ([15,25,45,60,120,240,360].includes(est)) { setEstimateMinutes(est); setEstimatePicked(true); }
      // Only a horizon the chips offer: a hidden one would hide the task (Codex review of #443).
      if (horizons.some(h => h.key === aiSuggestion.horizonLevel)) setHorizonLevel(aiSuggestion.horizonLevel);
      if (aiSuggestion.subSteps.length > 0 && subSteps.length === 0) {
        const now = Date.now();
        setSubSteps(aiSuggestion.subSteps.map((s, i) => ({ id: `ai-ss-${i}-${now}`, text: s.text, done: false })));
        setAdvancedOpen(true);
      }
    }
    setAiSuggestion(null);
  };

  // 45a/45k: five horizons and three priorities. Work and P4 still exist in
  // the data; they are offered only to a task that already has them, so
  // editing it never silently changes them — or when the AI suggests P4, so
  // the chosen priority is always one you can see.
  // 57b answer 26: the built-ins, then custom horizons (the row scrolls).
  // A renamed built-in shows its name; a hidden one only if it is the one
  // opened from.
  const SHORT = { week: "Week", month: "Month", quarter: "Quarter", halfyear: "6 mo" };
  const planHorizons = horizonsFromConfig(payload.config || {}, getLociDayStr(new Date(), windows));
  const defaultName = (id) => BUILT_IN_HORIZONS.find(b => b.id === id)?.name;
  const shown = planHorizons.filter(h => !h.hidden || h.id === defaultHorizon);
  const horizons = [
    { key: "today", label: "Today" },
    ...shown.filter(h => SHORT[h.id]).map(h => ({ key: h.id, label: h.name === defaultName(h.id) ? SHORT[h.id] : h.name })),
    ...shown.filter(h => !SHORT[h.id]).map(h => ({ key: h.id, label: h.name })),
    ...(defaultHorizon === "office" ? [{ key: "office", label: "Work" }] : []),
  ];
  const priorities = ["P1", "P2", "P3", ...(priority === "P4" ? ["P4"] : [])];
  const categories = ["Career", "Health", "Work", "Personal"];
  const parsedSubStepDraft = parseManualSubSteps(subStepDraft);
  const hasSubStepDraft = parsedSubStepDraft.length > 0;
  // Time: 15m · 30m · 1h · 2h · Other (45a). Other holds the rest.

  // #680: the submit in flight. Set before any wait, so a second Add (click,
  // Enter or ⌘↵) while the notification prompt is open is ignored; cleared
  // on unmount, so closing the dialog during the prompt cancels the add.
  const submitRef = useRef(null);
  useEffect(() => () => { submitRef.current = null; }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Saved: the form stays up for a moment to say so. A second ⌘↵ (or a held
    // one) must not add the task again.
    if (saved || submitRef.current || !title.trim()) return;
    if (title.trim().length > 1000) { setFormError("Task titles can have up to 1,000 characters. Shorten the title, or save it as a thought."); return; }

    // Flush an in-progress sub-step edit that never hit its row-level ✓/Enter
    // (e.g. the user clicked this dialog's Save/Add Task button instead) so
    // it isn't silently dropped in favor of the stale subSteps state.
    const editedSubStepText = editingSubStepId ? editingSubStepText.trim() : "";
    const effectiveSubSteps = editedSubStepText
      ? subSteps.map(step => step.id === editingSubStepId ? { ...step, text: editedSubStepText } : step)
      : subSteps;

    // Evening Guard window block logic
    if (isEveningGuardBlocked(payload.config, new Date())) {
      setFormError(EVENING_GUARD_MESSAGE);
      return;
    }
    setFormError("");

    // Build reminderAt timestamp from picker values
    let reminderAt = null;
    if (reminderOn && reminderDate && reminderTime) {
      reminderAt = new Date(`${reminderDate}T${reminderTime}`).getTime();
      if (isNaN(reminderAt) || reminderAt <= Date.now()) reminderAt = null;
    }

    const op = {};
    submitRef.current = op;
    // Request notification permission if a reminder is set. The prompt can
    // stay open for as long as the person likes: everything below is decided
    // after it, against the live payload (#680).
    if (reminderAt && notifPermissionState() === "default") {
      await nativeRequestPermission();
      if (submitRef.current !== op) return; // closed meanwhile
    }
    const now = Date.now();
    if (reminderAt && reminderAt <= now) reminderAt = null; // passed while the prompt was open

    const freshTask = {
      id: now,
      userId: email,
      uuid: safeUUID(),
      title: title.trim(),
      // Y5: no "Do first tiny step" placeholder; a first step shows only if set.
      ...(concreteStep.trim() ? { concreteStep: concreteStep.trim() } : {}),
      horizonLevel,
      priority,
      category,
      frontId: frontId || null,
      // No time chosen means no estimate, as for a task from the wall (K1) —
      // never an unshown default.
      ...(estimatePicked ? { timeEstimateMinutes: Number(estimateMinutes) } : {}),
      deadlineTimestamp: null,
      reminderAt,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: now,
      subSteps: effectiveSubSteps,
      ...(sourceDraft?.note ? { note: sourceDraft.note } : {}),
    };

    // Built from the live payload at apply time (orderIndex, the rest of the
    // tasks, the Mind Box, settings), not this render's copy. The reminder is
    // set by App from the accepted tasks, so a refused or cancelled add sets
    // none. The ledger event follows the confirmed write.
    const event = buildTaskMutationEvent("task_created", freshTask, { windows, now });
    let outcome = null;
    savePayloadAsync(
      live => addTaskToPayload(live, freshTask, { at: new Date(now), fromThoughtId, sourceThought }),
      { onLocalOutcome: o => { outcome = o; } },
    )
      .then(result => { if (result !== "noop") writeActivityEvents(eventPatch(uid, event)); })
      .catch(() => {});

    if (outcome !== "applied") {
      submitRef.current = null;
      setFormError(outcome === "noop" ? EVENING_GUARD_MESSAGE : "Couldn't add this task. Try again.");
      return;
    }
    setSaved(true);
    setTimeout(onClose, 900);
  };

  // Where + was tapped sets the horizon (45a); since 79 the Horizon pill
  // says so, and the button names it.
  const HORIZON_NAMES = { today: "Today", office: "Work", ...Object.fromEntries(planHorizons.map(h => [h.id, h.name])) };
  const horizonName = HORIZON_NAMES[horizonLevel] || "Today";
  const horizonPillName = horizons.find(h => h.key === horizonLevel)?.label || horizonName;
  const selectedFront = frontId ? fronts.find(f => f.id === frontId) : null;

  // 79: one picker open at a time, under the pill row.
  const [picker, setPicker] = useState(null);
  const togglePicker = (id) => setPicker(p => (p === id ? null : id));
  const pillClass = (id) => `add-pill${picker === id ? " is-open" : ""}`;
  const [titleFocused, setTitleFocused] = useState(false);
  const titleRef = useRef(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const keepFocus = (e) => e.preventDefault();
  // An emoji goes where the caret was; the title stays one line of 1000.
  const insertEmoji = (emoji) => {
    const el = titleRef.current;
    const at = el?.selectionStart ?? title.length;
    const end = el?.selectionEnd ?? at;
    setTitle(t => (t.slice(0, at) + emoji + t.slice(end)).slice(0, 1000));
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(at + emoji.length, 1000);
      el?.setSelectionRange?.(pos, pos);
    });
  };

  // A dialog: Escape closes it, Tab stays inside it, ⌘↵ / Ctrl↵ submits.
  const cardRef = useRef(null);
  const formRef = useRef(null);
  const closePicker = () => {
    // The selected option unmounts; keep keyboard shortcuts in the dialog.
    cardRef.current?.querySelector(".add-pill.is-open")?.focus();
    setPicker(null);
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    // 79: T puts you back in the writing box, as in Mind Box.
    const typing = e.target.closest?.("input, textarea, select, [contenteditable='true']");
    if (mode === "task" && !typing && (e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      titleRef.current?.focus();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); formRef.current?.requestSubmit(); return; }
    if (e.key !== "Tab") return;
    // Only what is on screen: a short phone hides More details while a picker
    // is open (Codex review of #621).
    const items = [...(cardRef.current?.querySelectorAll('button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])') || [])]
      .filter(el => el.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const chip = (selected) => `add-chip${selected ? " is-selected" : ""}`;

  // Enter saves the thought to Mind Box › Brain dump, nothing to decide.
  const saveThought = () => {
    if (!title.trim()) return;
    const added = addThought(payload, title);
    if (!added) { setThoughtError(`Mind Box holds ${THOUGHTS_MAX} thoughts. Let a few go first.`); return; }
    savePayload(added.payload);
    onThoughtSaved?.(added.item);
    onClose();
  };
  const thoughtRef = useRef(null);
  const switchMode = (next) => {
    // A task title is one plain line.
    if (next === "task" && mode === "thought") setTitle(t => plainThought(t));
    // A task title is plain text: a typed foo__bar__ stays as typed.
    if (next === "thought" && mode === "task") setTitle(t => escapeThought(t));
    setMode(next);
    setThoughtError("");
  };
  useEffect(() => {
    if (mode === "thought") thoughtRef.current?.focus();
    else cardRef.current?.querySelector(".add-title")?.focus();
  }, [mode]);
  const heading = mode === "thought" ? "New thought" : "New task";

  return (
    <div className="add-overlay is-add-sheet" onClick={onClose}>
      <div
        ref={cardRef}
        className={`add-card is-add-sheet${mode === "thought" ? " is-thought" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-task-heading"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <span className="add-grabber" aria-hidden="true" />
        <div className="add-head">
          <h2 id="add-task-heading" className={`add-heading${fromThoughtId ? "" : " is-sr"}`}>{heading}</h2>
          {!fromThoughtId && (
            <div className="add-seg" role="radiogroup" aria-label="Add a">
              {[["task", "Task"], ["thought", "Thought"]].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={mode === id}
                  className={`add-seg-btn${mode === id ? " is-on" : ""}`} onClick={() => switchMode(id)}>{label}</button>
              ))}
            </div>
          )}
          <button type="button" className="add-close" onClick={onClose} aria-label="Close"><IconX size={20} /></button>
        </div>

        {mode === "thought" ? (
          <div className="add-body add-thought">
            <ThoughtEditor
              ref={thoughtRef}
              className="add-thought-editor"
              fieldClassName="add-thought-input"
              value={title}
              hint=""
              onChange={v => { setTitle(v); setThoughtError(""); }}
              onSubmit={saveThought}
              onKeyDown={e => { if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); switchMode("task"); } }}
            />
            <p className="add-thought-note">Goes to Mind Box › Brain dump.</p>
            {thoughtError && <p className="add-error-line" role="alert">{thoughtError}</p>}
          </div>
        ) : (
        <form ref={formRef} onSubmit={handleSubmit} className="add-body">
          {sourceDraft?.note && <p className="add-thought-note">The complete thought will be kept in the task’s note.</p>}
          {isEveningGuardBlocked(payload.config) && (
            <p className="add-warning">Evening Guard is on: adding tasks after 8 PM is blocked. Rest now.</p>
          )}

          {/* 79: the same notebook box as Thought — ruled lines, the tools
              and the button inside it. */}
          <div className={`te add-task-editor${titleFocused ? " is-focused" : ""}`}>
            <div className="te-box">
              <GrowTextarea
                ref={titleRef}
                className="te-field add-title"
                data-testid="add-task-title"
                aria-label="Task"
                placeholder="What do you want to do?"
                maxLength={1000}
                maxRows={6}
                enterKeyHint="done"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onEnter={() => formRef.current?.requestSubmit()}
                onFocus={() => setTitleFocused(true)}
                onBlur={() => setTitleFocused(false)}
                autoFocus
              />
              <div className="te-foot">
                <button type="button" className={`te-tool${emojiOpen ? " is-on" : ""}`} aria-label="Emoji" title="Emoji"
                  aria-expanded={emojiOpen} onMouseDown={keepFocus} onClick={() => setEmojiOpen(o => !o)}>
                  <IconSmile size={18} />
                </button>
                {hasAnyKey && (
                  <button type="button" className="te-tool add-improve" aria-label="Ask AI to improve this"
                    disabled={aiLoading || !title.trim()} onClick={handleAiSuggest}>
                    <IconSparkles size={15} />
                    <span>{aiLoading ? "Thinking…" : "Improve"}</span>
                  </button>
                )}
                <span className="add-foot-gap" />
                {saved ? (
                  <p className="add-saved" role="status">{`Added to ${horizonName}`}</p>
                ) : (
                  <>
                    <kbd className="add-kbd" aria-hidden="true">⌘↵</kbd>
                    <button type="submit" className="te-save add-task-submit" data-testid="add-task-submit" disabled={!title.trim()}>
                      {`Add to ${horizonName}`}
                    </button>
                  </>
                )}
              </div>
            </div>
            {emojiOpen && (
              <div className="te-emoji" role="group" aria-label="Emoji">
                <div className="te-emoji-grid">
                  {THOUGHT_EMOJI.map((emoji) => (
                    <button key={emoji} type="button" className="te-emoji-cell" onMouseDown={keepFocus} onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {aiError && <p className="add-error-line">{aiError}</p>}
          {aiSuggestion && (
            <div className="add-suggestion">
              <p className="add-kicker">AI suggestion · review before applying</p>
              <p className="add-suggestion-title">{aiSuggestion.title}</p>
              {aiSuggestion.microStep && <p className="add-suggestion-line">First step: {aiSuggestion.microStep}</p>}
              {aiSuggestion.subSteps.length > 0 && (
                <p className="add-suggestion-line">{aiSuggestion.subSteps.length} key point{aiSuggestion.subSteps.length > 1 ? "s" : ""} saved as sub-steps</p>
              )}
              <div className="add-suggestion-actions">
                <button type="button" className="add-btn-filled" onClick={handleApplyAISuggestion}>Apply</button>
                <button type="button" className="add-btn-outline" onClick={() => setAiSuggestion(null)}>Keep my text</button>
              </div>
            </div>
          )}

          {/* 79: one row of pills; a tap opens that one picker under the row.
              The horizon comes from where the sheet was opened. */}
          <div className="add-pills" role="group" aria-label="Task settings">
            <button type="button" className={`${pillClass("horizon")} is-shrinkable`} aria-expanded={picker === "horizon"} aria-label={`Horizon: ${horizonPillName}`} onClick={() => togglePicker("horizon")}>
              <span className="add-pill-text">{horizonPillName}</span><IconChevronDown size={14} />
            </button>
            <button type="button" className={`${pillClass("priority")} is-mono`} aria-expanded={picker === "priority"} aria-label={`Priority: ${priority}`} onClick={() => togglePicker("priority")}>
              {priority}<IconChevronDown size={14} />
            </button>
            <button type="button" className={`${pillClass("time")}${estimatePicked ? " is-mono" : " is-empty"}`} aria-expanded={picker === "time"}
              aria-label={estimatePicked ? `Time: ${formatEstimate(Number(estimateMinutes))}` : "Time: not set"} onClick={() => togglePicker("time")}>
              {!estimatePicked && <IconClock size={14} className="add-pill-clock" />}
              {estimatePicked
                ? <><span className="add-pill-wide">{Number(estimateMinutes) < 60 ? `${Number(estimateMinutes)} MIN` : formatEstimate(Number(estimateMinutes)).toUpperCase()}</span><span className="add-pill-narrow">{formatEstimate(Number(estimateMinutes))}</span></>
                : <><span className="add-pill-wide">Add time</span><span className="add-pill-narrow">+ Time</span></>}
            </button>
            {fronts.length > 0 && (
              <button type="button" className={`${pillClass("front")}${frontId ? "" : " is-quiet"}`} aria-expanded={picker === "front"}
                aria-label={`Front: ${selectedFront ? selectedFront.name : "none"}`} onClick={() => togglePicker("front")}>
                <span className="add-pill-text">
                  {selectedFront ? selectedFront.name : <><span className="add-pill-wide">No front</span><span className="add-pill-narrow">Front</span></>}
                </span>
                <IconChevronDown size={14} />
              </button>
            )}
          </div>

          {picker === "horizon" && (
            <div className="add-picker" role="group" aria-label="Horizon">
              <p className="add-picker-label">WHEN IS IT FOR?</p>
              <div className="add-chips">
                {horizons.map((h) => (
                  <button key={h.key} type="button" className={chip(horizonLevel === h.key)} aria-pressed={horizonLevel === h.key} onClick={() => { setHorizonLevel(h.key); closePicker(); }}>
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {picker === "priority" && (
            <div className="add-picker" role="group" aria-label="Priority">
              <p className="add-picker-label">HOW IMPORTANT?</p>
              <div className="add-chips">
                {priorities.map((p) => (
                  <button key={p} type="button" className={chip(priority === p)} aria-pressed={priority === p} aria-label={`Priority ${p.slice(1)}`} onClick={() => { setPriority(p); closePicker(); }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {picker === "time" && (
            <div className="add-picker add-time-picker" role="group" aria-label="Time">
              <p className="add-picker-label">HOW LONG WILL IT TAKE?</p>
              <div className="add-chips add-time-chips">
                <EstimatePicker
                  value={estimatePicked ? Number(estimateMinutes) : null}
                  chipClass={chip}
                  inputClass="add-input add-other-input"
                  buttonClass="add-btn-outline add-other-set"
                  idPrefix="add-time"
                  onPick={(m) => { setEstimateMinutes(m); setEstimatePicked(true); }}
                />
              </div>
            </div>
          )}
          {picker === "front" && (
            <div className="add-picker" role="group" aria-label="Front">
              <p className="add-picker-label">WHICH FRONT?</p>
              <div className="add-chips">
                <button type="button" className={chip(!frontId)} aria-pressed={!frontId} onClick={() => { setFrontId(""); closePicker(); }}>Not on a front</button>
                {fronts.map(f => (
                  <button key={f.id} type="button" className={chip(frontId === f.id)} aria-pressed={frontId === f.id} onClick={() => { setFrontId(f.id); closePicker(); }}>{f.name}</button>
                ))}
              </div>
            </div>
          )}

          {/* What the design's sheet doesn't draw but the app already does —
              first step (Focus shows it), reminder, category, sub-steps —
              kept one tap away rather than dropped. */}
          {/* Blurring an empty Other time field shrinks the sheet before mouseup. */}
          <button type="button" className={`add-row add-more${picker ? " is-picker-open" : ""}`} aria-expanded={advancedOpen} onMouseDown={keepFocus} onClick={() => setAdvancedOpen(o => !o)}>
            <span className="add-row-label">More details</span>
            <span className="add-row-value">First step, reminder, steps</span>
            <IconChevronRight size={16} />
          </button>
          {advancedOpen && (
            <div className="add-more-body">
              <label className="add-field">
                <span className="add-label">First step</span>
                <input
                  type="text"
                  className="add-input"
                  placeholder="The smallest start, e.g. open the doc"
                  value={concreteStep}
                  onChange={(e) => setConcreteStep(e.target.value)}
                />
              </label>

              <div className="add-field">
                <span className="add-label">Reminder</span>
                <button
                  type="button"
                  className={chip(reminderOn)}
                  aria-pressed={reminderOn}
                  onClick={async () => {
                    if (!reminderOn && notifPermissionState() === "default") await nativeRequestPermission();
                    setReminderOn(o => !o);
                  }}
                >
                  {reminderOn ? `Remind me: ${formatReminderLabel(new Date(`${reminderDate}T${reminderTime}`).getTime())}` : "Set a reminder"}
                </button>
                {reminderOn && (
                  <ReminderPicker
                    idPrefix="add-reminder"
                    date={reminderDate}
                    time={reminderTime}
                    onChange={({ date, time }) => { setReminderDate(date); setReminderTime(time); }}
                  />
                )}
              </div>

              <div className="add-field" role="group" aria-labelledby="add-category-label">
                <span id="add-category-label" className="add-label">Category</span>
                <div className="add-chips">
                  {categories.map((c) => (
                    <button key={c} type="button" className={chip(category === c)} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
                  ))}
                </div>
              </div>

              <div className="add-field">
                <span className="add-label">Sub-steps</span>
                <textarea
                  className="add-input"
                  data-testid="add-task-substeps-draft"
                  aria-label="Sub-steps"
                  placeholder="One step per line — bullets, a/b/c, or 1/2/3 all work"
                  rows={3}
                  value={subStepDraft}
                  onChange={(e) => setSubStepDraft(e.target.value)}
                />
                <button type="button" className="add-btn-outline add-btn-small" data-testid="add-task-substeps-add" onClick={handleAddSubSteps} disabled={!hasSubStepDraft}>
                  Add step{subStepDraft.includes("\n") ? "s" : ""}
                </button>
                {subSteps.length > 0 && (
                  <ul className="add-steps" data-testid="add-task-substeps-list">
                    {subSteps.map((s) => (
                      <li key={s.id} className="add-step">
                        {editingSubStepId === s.id ? (
                          <>
                            <GrowTextarea
                              className="add-input add-step-edit"
                              aria-label={`Edit step ${s.text}`}
                              value={editingSubStepText}
                              maxRows={4}
                              onChange={(e) => setEditingSubStepText(e.target.value)}
                              onEnter={() => {
                                const trimmed = editingSubStepText.trim();
                                if (trimmed) setSubSteps(prev => prev.map(step => step.id === s.id ? { ...step, text: trimmed } : step));
                                setEditingSubStepId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.stopPropagation();
                                  setEditingSubStepId(null);
                                }
                              }}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="add-step-btn"
                              aria-label={`Save step ${s.text}`}
                              onClick={() => {
                                const trimmed = editingSubStepText.trim();
                                if (trimmed) setSubSteps(prev => prev.map(step => step.id === s.id ? { ...step, text: trimmed } : step));
                                setEditingSubStepId(null);
                              }}
                            >
                              <IconCheck size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="add-step-text">{s.text}</span>
                            <button type="button" className="add-step-btn" aria-label={`Edit step ${s.text}`} onClick={() => { setEditingSubStepId(s.id); setEditingSubStepText(s.text); }}>
                              <IconPencil size={15} />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="add-step-btn"
                          aria-label={`Remove step ${s.text}`}
                          onClick={() => {
                            if (editingSubStepId === s.id) setEditingSubStepId(null);
                            setSubSteps(prev => prev.filter(step => step.id !== s.id));
                          }}
                        >
                          <IconX size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {formError && <p className="add-error" role="alert">{formError}</p>}

        </form>
        )}
      </div>
    </div>
  );
}
