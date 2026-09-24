import React, { useEffect, useMemo, useState } from "react";
import { pickThree } from "../utils/narrowDown";
import { commitmentKickerFront, frontForCommitment, frontsFromConfig } from "../utils/fronts";
import { IconChevronLeft, IconChevronRight } from "./ui/icons";
import "../styles/scattered.css";

// Feeling scattered (45c): a lighter flow than Rescue. At most three things,
// the first showing its smallest start; five minutes on it, or empty your
// head into Mind Box. Nothing here is written except the pin that starts the
// session — the rest stay exactly where they are.
//
// Starting follows Day map's pattern: pin the task, hand the confirmed-write
// promise up, and let the owner of the session lifecycle open it.

// The first pick always gets a smallest start: its own first step, else its
// first open sub-step, else the five minutes this screen offers.
export function smallestStart(task) {
  const step = typeof task?.concreteStep === "string" ? task.concreteStep.trim() : "";
  if (step && step !== "Do first tiny step") return step;
  const sub = (Array.isArray(task?.subSteps) ? task.subSteps : []).find(s => s && !s.done && String(s.text || "").trim());
  return sub ? String(sub.text).trim() : "five minutes on it";
}

function metaFor(task, isGoal, showStart) {
  const bits = [String(task.priority || "P3").toUpperCase()];
  const est = Number(task.timeEstimateMinutes);
  if (est > 0) bits.push(est >= 60 && est % 60 === 0 ? `${est / 60}H` : est >= 60 ? `${Math.floor(est / 60)}H ${est % 60} MIN` : `${est} MIN`);
  if (isGoal) bits.push("GOAL");
  if (showStart) bits.push(`SMALLEST START: ${smallestStart(task)}`);
  return bits.join(" · ");
}

export default function ScatteredFlow({
  payload = {},
  savePayload,
  savePayloadAsync,
  flushNow,
  onStartFocus,
  onOpenMindBox,
  onBack,
  backLabel = "Back",
}) {
  const { tasks = [], config = {} } = payload;

  useEffect(() => {
    document.querySelector(".screen-content")?.scrollTo?.({ top: 0 });
    window.scrollTo?.({ top: 0 });
  }, []);

  // The picks depend on the focus time left, so they follow the clock — but
  // only change when the minute does.
  const [minuteTick, setMinuteTick] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const id = setInterval(() => setMinuteTick(Math.floor(Date.now() / 60000)), 30000);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(), [tasks, config, minuteTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggested = useMemo(() => pickThree(tasks, config, now), [tasks, config, now]);

  // Tapping a pick makes it the first: "Start 5 minutes on the first" then
  // always means the one you chose.
  const [firstId, setFirstId] = useState(null);
  const picks = useMemo(() => {
    const i = suggested.findIndex(t => t.uuid === firstId);
    return i > 0 ? [suggested[i], ...suggested.filter((_, j) => j !== i)] : suggested;
  }, [suggested, firstId]);
  const first = picks[0] || null;

  const goalFront = commitmentKickerFront(frontForCommitment(tasks.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted), frontsFromConfig(config)), config);
  const isGoal = (t) => !!goalFront && t.frontId === goalFront.id;

  const start = () => {
    if (!first) return;
    const stamp = Date.now();
    const nextTasks = tasks.map(t => {
      const shouldFocus = t.uuid === first.uuid;
      if (t.isNowFocus === shouldFocus) return t;
      return { ...t, isNowFocus: shouldFocus, lastUpdated: stamp };
    });
    const next = { ...payload, tasks: nextTasks, timestamp: stamp };
    const pinPromise = typeof savePayloadAsync === "function"
      ? savePayloadAsync(next)
      : (savePayload?.(next), Promise.resolve());
    flushNow?.();
    onStartFocus?.(pinPromise, 5);
  };

  return (
    <div className="scattered">
      {onBack && (
        <button type="button" className="scattered-back" onClick={onBack}>
          <IconChevronLeft size={18} /> {backLabel}
        </button>
      )}
      <h1 className="scattered-headline">Feeling scattered?</h1>

      {first ? (
        <>
          <p className="scattered-lede">Pick one. Just five minutes counts. Everything else waits.</p>
          <ul className="scattered-picks" aria-label="Pick one">
            {picks.map((t, i) => (
              <li key={t.uuid || t.id}>
                <button
                  type="button"
                  className={`scattered-pick${i === 0 ? " is-first" : ""}`}
                  aria-pressed={i === 0}
                  onClick={() => setFirstId(t.uuid)}
                >
                  <span className="scattered-pick-body">
                    <span className="scattered-pick-title">{t.title}</span>
                    <span className="scattered-pick-meta">{metaFor(t, isGoal(t), i === 0)}</span>
                  </span>
                  <IconChevronRight size={18} />
                </button>
              </li>
            ))}
          </ul>
          <div className="scattered-actions">
            <button type="button" className="scattered-primary" onClick={start}>
              Start 5 minutes on the first
            </button>
            {onOpenMindBox && (
              <button type="button" className="scattered-secondary" onClick={onOpenMindBox}>
                Empty my head into Mind Box
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="scattered-lede">Nothing is open. That's not a gap to fill — it's where the rest of this app is trying to get you.</p>
          {onOpenMindBox && (
            <div className="scattered-actions">
              <button type="button" className="scattered-secondary" onClick={onOpenMindBox}>
                Empty my head into Mind Box
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
