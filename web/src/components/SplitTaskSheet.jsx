import React, { useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { callAI, getAIKeys, hasAIKey } from "../utils/aiCall";
import { MAX_STEP_MINUTES, STEP_MINUTE_OPTIONS, evenMinutes, stepsFromSubSteps } from "../utils/splitTask";
import { safeUUID } from "../utils/uuid";
import { IconGripVertical, IconPlus, IconX } from "./ui/icons";
import "../styles/addTask.css";
import "../styles/splitTask.css";

// Split a task (45d; a 520px dialog from 840px). The steps come from the
// task's own open sub-steps, else from the AI if a key is set, else the user
// writes them. Each is 45 minutes or less; they can be edited, reordered,
// timed and removed. "Split into N tasks" replaces the original (Undo 5s).

function span(m) {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h${String(r).padStart(2, "0")}m` : `${h}h`) : `${r}m`;
}

function StepRow({ step, index, onText, onMinutes, onRemove, canRemove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  return (
    <li
      ref={setNodeRef}
      className={`split-step${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" ref={setActivatorNodeRef} className="split-grip" aria-label={`Reorder step ${index + 1}`} {...attributes} {...listeners}>
        <IconGripVertical size={16} />
      </button>
      <span className="split-num" aria-hidden="true">{index + 1}</span>
      <textarea
        className="split-text"
        aria-label={`Step ${index + 1}`}
        rows={1}
        value={step.text}
        placeholder="What's this step?"
        onChange={e => onText(step.id, e.target.value)}
      />
      <select className="split-min" aria-label={`Step ${index + 1} length`} value={step.minutes} onChange={e => onMinutes(step.id, Number(e.target.value))}>
        {STEP_MINUTE_OPTIONS.map(m => <option key={m} value={m}>{m}m</option>)}
      </select>
      <button type="button" className="split-remove" aria-label={`Remove step ${index + 1}`} onClick={() => onRemove(step.id)} disabled={!canRemove}>
        <IconX size={16} />
      </button>
    </li>
  );
}

export default function SplitTaskSheet({ task, onClose, onSplit }) {
  const original = Number(task.timeEstimateMinutes) || 0;
  const withIds = (steps) => steps.map(s => ({ id: safeUUID(), ...s }));
  const fromSubSteps = stepsFromSubSteps(task);
  const [source, setSource] = useState(fromSubSteps.length ? "substeps" : hasAIKey() ? "ai" : "manual");
  const [steps, setSteps] = useState(() => fromSubSteps.length
    ? withIds(fromSubSteps)
    : withIds(evenMinutes(original || 50, 2).map(minutes => ({ text: "", minutes }))));
  const [loading, setLoading] = useState(source === "ai");
  // How many Loci suggested — not how many rows there are after edits.
  const [suggested, setSuggested] = useState(fromSubSteps.length);

  // No sub-steps but a key: ask for three steps of 45 minutes or less. On any
  // failure it falls back to writing them by hand, and says so.
  useEffect(() => {
    if (source !== "ai") return undefined;
    let live = true;
    const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
    callAI({
      groqKey, geminiKey, cerebrasKey, zaiKey,
      systemPrompt: "You split tasks into concrete steps. Respond ONLY with a valid JSON array, no markdown.",
      messages: [{
        role: "user",
        content: `Split this task into 2-4 concrete steps, each ${MAX_STEP_MINUTES} minutes or less, together about ${original || 60} minutes.\n\nTask: "${task.title}"\n\nReturn ONLY a JSON array like [{"text":"Collect the latest figures","minutes":30}]. Each text under 10 words. minutes is one of ${STEP_MINUTE_OPTIONS.join(", ")}.`,
      }],
      maxTokens: 250,
    })
      .then(raw => {
        const match = String(raw).replace(/```json|```/g, "").match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(match ? match[0] : raw);
        const good = (Array.isArray(parsed) ? parsed : [])
          .filter(s => s && typeof s.text === "string" && s.text.trim())
          .map(s => ({ text: s.text.trim(), minutes: STEP_MINUTE_OPTIONS.includes(Number(s.minutes)) ? Number(s.minutes) : 25 }));
        // The ask is two to four; anything else is not the suggestion asked for.
        if (good.length < 2 || good.length > 4) throw new Error("out of range");
        if (live) { setSteps(withIds(good)); setSuggested(good.length); }
      })
      .catch(() => { if (live) setSource("manual"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setSteps(s => arrayMove(s, s.findIndex(x => x.id === active.id), s.findIndex(x => x.id === over.id)));
  };

  const setText = (id, text) => setSteps(s => s.map(x => x.id === id ? { ...x, text } : x));
  const setMinutes = (id, minutes) => setSteps(s => s.map(x => x.id === id ? { ...x, minutes } : x));
  const remove = (id) => setSteps(s => s.filter(x => x.id !== id));
  const add = () => setSteps(s => [...s, { id: safeUUID(), text: "", minutes: 25 }]);

  const ready = steps.filter(s => s.text.trim());
  const total = ready.reduce((sum, s) => sum + s.minutes, 0);

  // A dialog: focus moves in on open and back to the opener on close; Escape
  // closes, Tab stays inside.
  const cardRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    cardRef.current?.querySelector(".add-close")?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus?.(); };
  }, []);
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const items = [...(cardRef.current?.querySelectorAll("button:enabled, textarea:enabled, select:enabled") || [])];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const lede = loading
    ? "Finding steps of 45 minutes or less…"
    : source === "manual"
      ? "Break it into steps of 45 minutes or less. Reorder or remove any."
      : `Loci suggests ${numberWord(suggested)} ${suggested === 1 ? "step" : "steps"} of 45 minutes or less. Edit, reorder or remove any.`;

  return (
    <div className="add-overlay" onClick={onClose}>
      <div ref={cardRef} className="add-card split-card" role="dialog" aria-modal="true" aria-labelledby="split-heading" onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="add-head">
          <h2 id="split-heading" className="add-heading">Split a task</h2>
          <button type="button" className="add-close" onClick={onClose} aria-label="Close"><IconX size={20} /></button>
        </div>

        <div className="split-original">
          <p className="split-kicker">SPLITTING{original ? ` · ${span(original).toUpperCase()}` : ""} · {String(task.priority || "P3").toUpperCase()}</p>
          <p className="split-original-title">{task.title}</p>
        </div>

        <p className="split-lede" aria-live="polite">{lede}</p>

        {/* Locked while the AI works, so its answer never overwrites edits. */}
        <fieldset className="split-fieldset" disabled={loading}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <ol className="split-steps">
              {steps.map((s, i) => (
                <StepRow key={s.id} step={s} index={i} onText={setText} onMinutes={setMinutes} onRemove={remove} canRemove={steps.length > 1} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>

        <button type="button" className="split-add" onClick={add}><IconPlus size={16} /> Add a step</button>
        </fieldset>

        <p className="split-total">
          <span>Total</span>
          <span className="split-total-figure">{span(total)}{original ? ` of ${span(original)}` : ""}</span>
        </p>

        <button type="button" className="add-submit" disabled={ready.length < 2 || loading} onClick={() => onSplit(ready)}>
          {ready.length >= 2 ? `Split into ${ready.length} tasks` : "Write at least two steps"}
        </button>
        <p className="split-note">The original task is replaced. Undo for 5 seconds.</p>
      </div>
    </div>
  );
}

function numberWord(n) {
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"][n] || String(n);
}
