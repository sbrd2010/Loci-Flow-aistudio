import React, { useEffect, useMemo, useRef, useState } from "react";
import { isEveningGuardBlocked } from "../utils/eveningGuard";
import { callAI, getAIKeys, hasAIKey } from "../utils/aiCall";
import { safeUUID } from "../utils/uuid";
import { scheduleReminder, cancelReminder, formatReminderLabel } from "../utils/reminders";
import { notifPermissionState, requestNotifPermission as nativeRequestPermission } from "../utils/nativeNotifs";
import { applyAiRewriteToTask } from "../utils/taskOps";
import { getFocusWindows } from "../utils/focusWindows";
import { frontsFromConfig, sortFronts } from "../utils/fronts";
import { buildTaskMutationEvent, eventPatch } from "../utils/activityLog";
import { IconCheck, IconChevronRight, IconPencil, IconX } from "./ui/icons";
import "../styles/addTask.css";

function defaultReminderDateTime() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const dateStr = d.toISOString().slice(0, 10);
  const timeStr = `${String(d.getHours()).padStart(2, "0")}:00`;
  return { dateStr, timeStr };
}

function parseManualSubSteps(raw) {
  return raw
    .split("\n")
    .map(line => line.trim().replace(/^(?:[-*•‣▪–—]+|\[[ xX]\]|\d+[.):](?!\d)|[a-zA-Z][.):])\s*/, "").trim())
    .filter(Boolean);
}


// What the estimate selector shows for a task that has none. Named because
// the save path has to tell "the user chose 25" from "nobody chose anything".
const DEFAULT_ESTIMATE_MINUTES = 25;

export default function AddTaskDialog({ email, payload, savePayload, savePayloadAsync, userProfile, defaultHorizon, openedFrom = null, onClose, editTask, uid, writeActivityEvents }) {
  const windows = getFocusWindows(payload.config || {});
  const isEditMode = !!editTask;
  const [title, setTitle] = useState(editTask?.title || "");
  const [concreteStep, setConcreteStep] = useState(editTask?.concreteStep || "");
  const [horizonLevel, setHorizonLevel] = useState(editTask?.horizonLevel || defaultHorizon || "today");
  const [saved, setSaved] = useState(false);
  const [priority, setPriority] = useState(editTask?.priority || "P3");
  const [category, setCategory] = useState(editTask?.category || "Personal");
  // "" means no front. Stored as null, never "", so the field is absent rather
  // than empty for a task that belongs to nothing.
  const [frontId, setFrontId] = useState(editTask?.frontId || "");
  const [estimateMinutes, setEstimateMinutes] = useState(editTask?.timeEstimateMinutes || DEFAULT_ESTIMATE_MINUTES);
  // A task can legitimately have NO estimate, and the selector shows the
  // default for one. Comparing the value alone cannot tell "the user chose 25"
  // from "nobody chose anything", so choosing 25 on such a task — or leaving
  // and returning to it — would silently not stick. This records the act.
  const [estimatePicked, setEstimatePicked] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(isEditMode);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [subSteps, setSubSteps] = useState(editTask?.subSteps || []);
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
  const [reminderOn, setReminderOn] = useState(!!editTask?.reminderAt);
  const [reminderDate, setReminderDate] = useState(() => {
    if (editTask?.reminderAt) {
      return new Date(editTask.reminderAt).toISOString().slice(0, 10);
    }
    return defaultReminderDateTime().dateStr;
  });
  const [reminderTime, setReminderTime] = useState(() => {
    if (editTask?.reminderAt) {
      const d = new Date(editTask.reminderAt);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    return defaultReminderDateTime().timeStr;
  });

  const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const hasAnyKey = hasAIKey();

  const handleAiSuggest = async () => {
    if (!title.trim()) { setAiError("Type a rough task idea first, then tap Ask AI."); return; }
    if (!hasAnyKey) { setAiError("No AI key — add one in Settings."); return; }
    setAiLoading(true);
    setAiError("");
    setAiSuggestion(null);
    const cfg = payload.config || {};
    const challengeLabel =
      cfg.challengeType === "overplanner"  ? "over-plans and researches but rarely starts (needs forced simplicity and an execution nudge)" :
      cfg.challengeType === "overwhelmed"  ? "feels overwhelmed and guilty about backlog (needs reassurance, recovery framing, and one clear next action)" :
      cfg.challengeType === "initiation"   ? "freezes before starting despite knowing what to do (needs scaffolding, micro-starts, and low-threshold first steps)" :
      cfg.challengeType === "momentum"     ? "needs a quick win to get rolling (needs P4 fast-finish tasks and visible forward movement)" :
      cfg.challengeType === "starting"     ? "struggles to start tasks (task initiation block)" :
      cfg.challengeType === "focusing"     ? "gets distracted mid-task (focus protection)" :
      cfg.challengeType === "tracking"     ? "has trouble tracking progress and staying accountable (needs visible checkpoints)" :
      "overthinks and delays finishing (perfectionism/action paralysis)";
    const existingTasks = (payload.tasks || []).filter(t => !t.isDeleted && !t.isCompleted).slice(0, 8)
      .map(t => `[${t.priority}] ${t.title}`).join(", ") || "none yet";
    const profile = userProfile;
    const profileNote = profile && profile.totalTasks >= 5
      ? `\nUser's task patterns: completion rate ${Math.round(profile.completionRate * 100)}%, dominant horizon "${profile.dominantHorizon}", avg estimate ${profile.avgEstimateMinutes}min. Use these to inform your horizon, priority, and estimate suggestions.`
      : "";
    const prompt = `You are an expert productivity coach specialising in focus, momentum, and execution support. The user typed this rough task idea: "${title.trim()}".

Transform it into a well-structured, focus-friendly task. The user's core challenge: ${challengeLabel}.${profileNote}

TASK DESIGN RULES:
- Title must be specific and outcome-oriented (not vague verbs like "work on" or "think about")
- microStep is the DOOR-HANDLE move — the single physical action that takes under 2 minutes and removes the initiation barrier
- Priority should account for the user's challenge: if they struggle to start, lean P3/P4 to reduce pressure
- Time estimate should be honest — tasks often take 1.5x expected time
- horizonLevel: "today" only if deadline is today or extremely urgent; "week" for most tasks; "month"/"quarter" for longer-term goals
- Never use the word "ADHD" in your response
- Their current tasks for context: ${existingTasks}
- subSteps: extract 2-4 key points or sub-tasks from the original input that would be lost in the shortened title. Use [] if the input is short or the title already captures everything.

Respond with ONLY valid JSON (no markdown, no code blocks), exactly this structure:
{"title":"<specific outcome-oriented title, max 60 chars>","microStep":"<single door-handle action, max 60 chars>","priority":"P2","estimateMinutes":25,"horizonLevel":"week","subSteps":[{"text":"key point 1"},{"text":"key point 2"}]}

priority options: P1 (urgent+must do today), P2 (important this week), P3 (normal queue), P4 (easy quick-win, under 15 min)
estimateMinutes options: 15, 25, 45, 60, 120, 240, 360
horizonLevel options: "today", "week" (default), "month", "quarter", "halfyear"`;

    try {
      const raw = await callAI({
        groqKey, geminiKey, cerebrasKey, zaiKey,
        systemPrompt: "You are a productivity coach. Respond ONLY with valid JSON, no markdown.",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 350
      });
      let cleaned = raw.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error("No JSON");
      }
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
    if (isEditMode) {
      // Rewrite mode: only update text content; preserve ALL planning metadata
      // (horizonLevel, priority, timeEstimate, uuid, id, dayMap fields, etc.)
      const merged = applyAiRewriteToTask(editTask, aiSuggestion);
      setTitle(merged.title);
      setConcreteStep(merged.concreteStep);
      setSubSteps(merged.subSteps || []);
      setAdvancedOpen(true);
    } else {
      // New task: AI may suggest all fields
      if (aiSuggestion.title) setTitle(aiSuggestion.title);
      if (aiSuggestion.microStep) { setConcreteStep(aiSuggestion.microStep); setAdvancedOpen(true); }
      if (["P1","P2","P3","P4"].includes(aiSuggestion.priority)) setPriority(aiSuggestion.priority);
      const est = Number(aiSuggestion.estimateMinutes);
      // A value with no chip of its own shows under Other, so it is never
      // chosen without being seen.
      if ([15,25,45,60,120,240,360].includes(est)) { setEstimateMinutes(est); setEstimatePicked(true); setOtherOpen(![15, 30, 60, 120].includes(est)); }
      if (["today","week","month","quarter","halfyear","office"].includes(aiSuggestion.horizonLevel)) setHorizonLevel(aiSuggestion.horizonLevel);
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
  const horizons = [
    { key: "today", label: "Today" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "quarter", label: "Quarter" },
    { key: "halfyear", label: "6 mo" },
    ...(editTask?.horizonLevel === "office" || defaultHorizon === "office" ? [{ key: "office", label: "Work" }] : []),
  ];
  const priorities = ["P1", "P2", "P3", ...(editTask?.priority === "P4" || priority === "P4" ? ["P4"] : [])];
  const categories = ["Career", "Health", "Work", "Personal"];
  const parsedSubStepDraft = parseManualSubSteps(subStepDraft);
  const hasSubStepDraft = parsedSubStepDraft.length > 0;
  // Time: 15m · 30m · 1h · 2h · Other (45a). Other holds the rest.
  const timeChips = [{ min: 15, label: "15m" }, { min: 30, label: "30m" }, { min: 60, label: "1h" }, { min: 120, label: "2h" }];
  const otherTimes = [10, 20, 25, 45, 90, 180, 240, 360];
  const onChip = timeChips.some(c => c.min === Number(estimateMinutes));
  const [otherOpen, setOtherOpen] = useState(() => isEditMode && !timeChips.some(c => c.min === Number(editTask?.timeEstimateMinutes || DEFAULT_ESTIMATE_MINUTES)) && Number(editTask?.timeEstimateMinutes) > 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Saved: the form stays up for a moment to say so. A second ⌘↵ (or a held
    // one) must not add the task again.
    if (saved || !title.trim()) return;

    // Flush an in-progress sub-step edit that never hit its row-level ✓/Enter
    // (e.g. the user clicked this dialog's Save/Add Task button instead) so
    // it isn't silently dropped in favor of the stale subSteps state.
    const editedSubStepText = editingSubStepId ? editingSubStepText.trim() : "";
    const effectiveSubSteps = editedSubStepText
      ? subSteps.map(step => step.id === editingSubStepId ? { ...step, text: editedSubStepText } : step)
      : subSteps;

    // Evening Guard window block logic
    const now = new Date();
    if (isEveningGuardBlocked(payload.config, now)) {
      setFormError("Evening Guard is on: no new tasks at or after 8 PM. Rest now.");
      return;
    }
    setFormError("");

    // Calculate orderIndex as size of active level tasks
    const currentLevelTasks = (payload.tasks || []).filter(
      (t) => t.horizonLevel === horizonLevel && !t.isDeleted
    );
    const orderIndex = currentLevelTasks.length;

    // Build reminderAt timestamp from picker values
    let reminderAt = null;
    if (reminderOn && reminderDate && reminderTime) {
      reminderAt = new Date(`${reminderDate}T${reminderTime}`).getTime();
      if (isNaN(reminderAt) || reminderAt <= Date.now()) reminderAt = null;
    }

    // Request notification permission if a reminder is set
    if (reminderAt && notifPermissionState() === "default") {
      await nativeRequestPermission();
    }

    if (isEditMode) {
      const newEstimate = Number(estimateMinutes);
      // Only sync dayMapDurationMinutes when the estimate actually changed in this
      // edit — otherwise saving an unrelated field (title, priority, reminder...)
      // would silently clobber a DayMap duration the user deliberately set apart
      // from the task's general estimate (e.g. extra buffer blocked for today).
      // When it did change, mirror DayMap's own duration edit (DayMapPage.jsx's
      // changeDuration), which writes both fields so DayMap doesn't keep showing
      // a stale duration (DayMap's getEstimate prefers dayMapDurationMinutes).
      // A task can legitimately have NO estimate and NO subtask — the wall's
      // commit field creates exactly that (K1). Writing the form's defaults
      // back on an edit that never touched those fields invents data the user
      // never entered: rename a wall task and it silently gained a 25-minute
      // estimate and a "Do first tiny step". The spread preserves whatever
      // editTask already had, so omitting the key is how absence survives.
      const hadEstimate = Number(editTask.timeEstimateMinutes) > 0;
      // With no estimate to compare against, "changed" is the act of picking,
      // not the value: Number(undefined) is NaN and differs from everything,
      // while comparing to the default cannot tell a deliberate 25 from an
      // untouched selector.
      const estimateChanged = hadEstimate
        ? newEstimate !== Number(editTask.timeEstimateMinutes)
        : estimatePicked;
      const stepText = concreteStep.trim();
      const updatedTask = {
        ...editTask,
        title: title.trim(),
        // Clearing the field on a task that HAD a step still keeps the old
        // one, exactly as before — the spread does it.
        ...(stepText ? { concreteStep: stepText } : {}),
        horizonLevel,
        priority,
        category,
        frontId: frontId || null,
        ...(hadEstimate || estimatePicked ? { timeEstimateMinutes: newEstimate } : {}),
        ...(estimateChanged ? { dayMapDurationMinutes: newEstimate } : {}),
        reminderAt,
        subSteps: effectiveSubSteps,
        lastUpdated: Date.now()
      };
      if (reminderAt && reminderAt !== editTask.reminderAt) scheduleReminder(updatedTask);
      if (!reminderAt && editTask.reminderAt) cancelReminder(editTask.uuid);
      const horizonChanged = horizonLevel !== editTask.horizonLevel;
      if (horizonChanged) {
        const event = buildTaskMutationEvent("task_moved", updatedTask, {
          fromState: { horizonLevel: editTask.horizonLevel }, toState: { horizonLevel }, windows,
        });
        savePayloadAsync({ ...payload, tasks: (payload.tasks || []).map(t => t.uuid === editTask.uuid ? updatedTask : t) })
          .then(() => writeActivityEvents(eventPatch(uid, event)))
          .catch(() => {});
      } else {
        savePayload({ ...payload, tasks: (payload.tasks || []).map(t => t.uuid === editTask.uuid ? updatedTask : t) });
      }
      setSaved(true);
      setTimeout(onClose, 900);
      return;
    }

    const freshTask = {
      id: Date.now(),
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
      orderIndex,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: Date.now(),
      subSteps: effectiveSubSteps,
    };

    if (reminderAt) scheduleReminder(freshTask);

    const updatedTasks = [...(payload.tasks || []), freshTask];
    const event = buildTaskMutationEvent("task_created", freshTask, { windows });
    savePayloadAsync({
      ...payload,
      tasks: updatedTasks
    })
      .then(() => writeActivityEvents(eventPatch(uid, event)))
      .catch(() => {});

    setSaved(true);
    setTimeout(onClose, 900);
  };

  // Where + was tapped sets the horizon (45a): one tinted line says so, and
  // the Horizon + Priority block wears a 2px ring for about 1.5s on open.
  const HORIZON_NAMES = { today: "Today", week: "This week", month: "This month", quarter: "This quarter", halfyear: "6 months", office: "Work" };
  const horizonName = HORIZON_NAMES[horizonLevel] || "Today";
  const [ringOn, setRingOn] = useState(!isEditMode);
  useEffect(() => {
    if (!ringOn) return undefined;
    const t = setTimeout(() => setRingOn(false), 1500);
    return () => clearTimeout(t);
  }, [ringOn]);

  // A dialog: Escape closes it, Tab stays inside it, ⌘↵ / Ctrl↵ submits.
  const cardRef = useRef(null);
  const formRef = useRef(null);
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); formRef.current?.requestSubmit(); return; }
    if (e.key !== "Tab") return;
    const items = [...(cardRef.current?.querySelectorAll('button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])') || [])];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const chip = (selected) => `add-chip${selected ? " is-selected" : ""}`;

  return (
    <div className="add-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="add-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-task-heading"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <span className="add-grabber" aria-hidden="true" />
        <div className="add-head">
          <h2 id="add-task-heading" className="add-heading">{isEditMode ? "Edit task" : "New task"}</h2>
          <button type="button" className="add-close" onClick={onClose} aria-label="Close"><IconX size={20} /></button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="add-body">
          {isEveningGuardBlocked(payload.config) && (
            <p className="add-warning">Evening Guard is on: adding tasks after 8 PM is blocked. Rest now.</p>
          )}

          <textarea
            className="add-title"
            data-testid="add-task-title"
            aria-label="Task"
            placeholder="What do you want to do?"
            rows={2}
            maxLength={1000}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
          {hasAnyKey && (
            <button type="button" className="add-link" onClick={handleAiSuggest} disabled={aiLoading}>
              {aiLoading ? "Thinking…" : "Ask AI to improve this"}
            </button>
          )}
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

          {!isEditMode && openedFrom && (
            <p className="add-note">
              Adding to <strong>{HORIZON_NAMES[defaultHorizon] || horizonName}</strong> because you opened it from {openedFrom}. Change below.
            </p>
          )}

          <div className={`add-block${ringOn ? " is-ringed" : ""}`}>
            <div className="add-field" role="group" aria-labelledby="add-horizon-label">
              <span id="add-horizon-label" className="add-label">Horizon</span>
              <div className="add-chips">
                {horizons.map((h) => (
                  <button key={h.key} type="button" className={chip(horizonLevel === h.key)} aria-pressed={horizonLevel === h.key} onClick={() => setHorizonLevel(h.key)}>
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="add-field" role="group" aria-labelledby="add-priority-label">
              <span id="add-priority-label" className="add-label">Priority</span>
              <div className="add-chips">
                {priorities.map((p) => (
                  <button key={p} type="button" className={chip(priority === p)} aria-pressed={priority === p} aria-label={`Priority ${p.slice(1)}`} onClick={() => setPriority(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="add-field" role="group" aria-labelledby="add-time-label">
            <span id="add-time-label" className="add-label">Time</span>
            <div className="add-chips">
              {timeChips.map((c) => (
                <button
                  key={c.min}
                  type="button"
                  className={chip(!otherOpen && Number(estimateMinutes) === c.min && (estimatePicked || isEditMode))}
                  aria-pressed={!otherOpen && Number(estimateMinutes) === c.min && (estimatePicked || isEditMode)}
                  onClick={() => { setEstimateMinutes(c.min); setEstimatePicked(true); setOtherOpen(false); }}
                >
                  {c.label}
                </button>
              ))}
              <button type="button" className={chip(otherOpen)} aria-pressed={otherOpen} onClick={() => { setOtherOpen(true); setEstimatePicked(true); }}>Other</button>
            </div>
            {otherOpen && (
              <label className="add-other">
                Minutes
                <select
                  value={onChip ? "" : Number(estimateMinutes)}
                  onChange={(e) => { setEstimateMinutes(Number(e.target.value)); setEstimatePicked(true); }}
                >
                  {onChip && <option value="" disabled>Choose</option>}
                  {otherTimes.map((m) => <option key={m} value={m}>{m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ""}`}</option>)}
                </select>
              </label>
            )}
          </div>

          {fronts.length > 0 && (
            <label className="add-row" htmlFor="task-front">
              <span className="add-row-label">Front</span>
              <select id="task-front" className="add-row-select" value={frontId} onChange={e => setFrontId(e.target.value)}>
                <option value="">Not on a front</option>
                {fronts.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <IconChevronRight size={16} />
            </label>
          )}

          {/* What the design's sheet doesn't draw but the app already does —
              first step (Focus shows it), reminder, category, sub-steps —
              kept one tap away rather than dropped. */}
          <button type="button" className="add-row add-more" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(o => !o)}>
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
                  <div className="add-inline">
                    <input type="date" className="add-input" aria-label="Reminder date" value={reminderDate} min={new Date().toISOString().slice(0, 10)} onChange={e => setReminderDate(e.target.value)} />
                    <input type="time" className="add-input" aria-label="Reminder time" value={reminderTime} onChange={e => setReminderTime(e.target.value)} />
                  </div>
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
                            <input
                              type="text"
                              className="add-input"
                              aria-label={`Edit step ${s.text}`}
                              value={editingSubStepText}
                              onChange={(e) => setEditingSubStepText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  const trimmed = editingSubStepText.trim();
                                  if (trimmed) setSubSteps(prev => prev.map(step => step.id === s.id ? { ...step, text: trimmed } : step));
                                  setEditingSubStepId(null);
                                } else if (e.key === "Escape") {
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

          <div className="add-foot">
            {saved ? (
              <p className="add-saved" role="status">{isEditMode ? "Saved" : `Added to ${horizonName}`}</p>
            ) : (
              <>
                <button type="submit" className="add-submit" data-testid="add-task-submit">
                  {isEditMode ? "Save changes" : `Add to ${horizonName}`}
                </button>
                <kbd className="add-kbd" aria-hidden="true">⌘ ↵</kbd>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
