import React, { useEffect, useRef, useState } from "react";
import { isEveningGuardBlocked } from "../utils/eveningGuard";
import { safeUUID } from "../utils/uuid";
import { getFocusWindows } from "../utils/focusWindows";
import { buildTaskMutationEvent, eventPatch } from "../utils/activityLog";
import { saveFirstTask } from "../utils/firstRun";
import "../styles/firstRun.css";

// #653: the guided first task, one question per screen: the task, then its
// smallest first step (optional: "already small" or "not sure yet"). It saves
// a Today task in the same shape and the same way as AddTaskDialog does.
export default function FirstTaskSheet({ email, payload, savePayloadAsync, uid, writeActivityEvents, onAdded, onSkip }) {
  const [phase, setPhase] = useState("title");
  const [title, setTitle] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, [phase]);

  const add = async (concreteStep) => {
    // One task per tap: a double tap must not save two (ChatGPT review of #654).
    if (submitting.current) return;
    if (isEveningGuardBlocked(payload.config, new Date())) {
      setError("Evening Guard is on: no new tasks at or after 8 PM. Rest now.");
      return;
    }
    const now = Date.now();
    const task = {
      id: now,
      userId: email,
      uuid: safeUUID(),
      title: title.trim(),
      ...(concreteStep ? { concreteStep } : {}),
      horizonLevel: "today",
      priority: "P3",
      category: "Personal",
      frontId: null,
      deadlineTimestamp: null,
      reminderAt: null,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex: (payload.tasks || []).filter(t => t.horizonLevel === "today" && !t.isDeleted).length,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: now,
      subSteps: [],
    };
    const event = buildTaskMutationEvent("task_created", task, { windows: getFocusWindows(payload.config || {}) });
    submitting.current = true;
    setBusy(true);
    setError("");
    const { result, write } = await saveFirstTask(savePayloadAsync, { ...payload, tasks: [...(payload.tasks || []), task] });
    write.then(() => writeActivityEvents?.(eventPatch(uid, event))).catch(() => {});
    if (result === "blocked") {
      // Refused before it reached this device's list: nothing was saved, so
      // the sheet stays, with what they typed, and says so.
      submitting.current = false;
      setBusy(false);
      setError("Couldn’t save this yet. Check your connection, then try again.");
      return;
    }
    // The sheet stays a moment, its buttons disabled, so the second tap of a
    // double tap lands here and not on whatever is under it (the tab bar).
    await new Promise(resolve => setTimeout(resolve, 300));
    onAdded(task.uuid);
  };

  // A modal sheet: Tab stays inside it, and no key reaches the app behind it
  // (Today's N, L, Space…), while typing in its fields works as usual
  // (loopcheck of #654). React stops the native event at its root, before the
  // app's window and document listeners.
  const sheetRef = useRef(null);
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { onSkip(); return; }
    if (e.key !== "Tab") return;
    const items = [...(sheetRef.current?.querySelectorAll("button:not([disabled]), input:not([disabled])") || [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="frs-backdrop">
      <section className="frs" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="frs-title" onKeyDown={onKeyDown}>
        <span className="frs-kicker">{phase === "title" ? "YOUR FIRST TASK · 1 OF 3" : "YOUR FIRST TASK · 2 OF 3"}</span>
        {error && phase === "title" && <p className="frs-error" role="alert">{error}</p>}
        {phase === "title" ? (
          <form className="frs-body" onSubmit={e => { e.preventDefault(); if (title.trim()) setPhase("step"); }}>
            <h2 id="frs-title" className="frs-title">Write down one real thing</h2>
            <label className="frw-label" htmlFor="frs-task">What do you want to do?</label>
            <input id="frs-task" ref={inputRef} className="frw-input" value={title} maxLength={1000}
              placeholder="e.g. Reply to the landlord" onChange={e => setTitle(e.target.value)} />
            <p className="frs-hint">Your words. Something you’d like to get done soon.</p>
            <div className="frs-actions">
              <button type="button" className="frw-link" onClick={onSkip}>Skip guide</button>
              <button type="submit" className="frw-primary" disabled={!title.trim()}>Next</button>
            </div>
          </form>
        ) : (
          <form className="frs-body" onSubmit={e => { e.preventDefault(); if (step.trim()) add(step.trim()); }}>
            <h2 id="frs-title" className="frs-title">What’s the smallest thing you could do first?</h2>
            <p className="frs-for">For: <strong>{title.trim()}</strong></p>
            <label className="frw-label" htmlFor="frs-step">First step</label>
            <input id="frs-step" ref={inputRef} className="frw-input" value={step} maxLength={300}
              placeholder="e.g. Open the lease email" onChange={e => setStep(e.target.value)} />
            <div className="frs-chips">
              <button type="button" className="frs-chip" disabled={busy} onClick={() => add("")}>This is already small</button>
              <button type="button" className="frs-chip" disabled={busy} onClick={() => add("")}>Not sure yet</button>
            </div>
            {error && <p className="frs-error" role="alert">{error}</p>}
            <div className="frs-actions">
              <button type="button" className="frw-link" onClick={() => setPhase("title")}>Back</button>
              <button type="submit" className="frw-primary" disabled={!step.trim() || busy}>Add task</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
