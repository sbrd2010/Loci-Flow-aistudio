import React, { useEffect, useRef, useState } from "react";
import { guideCard, COACH_EXAMPLES, exampleForNeed, NOTES } from "../utils/firstRun";
import { IconX } from "./ui/icons";
import "../styles/firstRun.css";

// #653: the guide's card, docked above the tab bar on phones and in the corner
// on wide screens, so it never sits over the control it names. It rings the
// real control through body[data-guide] and each component's data-guide-id
// (the CSS is in firstRun.css). It never presses anything for the person.
const coarse = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export default function FirstRunGuide({ state, onAction, onTab, taskTitle, thoughtCount = 0, challengeType }) {
  const card = guideCard(state, { taskTitle, tap: coarse() ? "Tap" : "Click" });
  const targets = card ? card.targets.join(" ") : "";
  const stopId = card?.stopId || "";

  // Ring the named controls; leave nothing behind.
  useEffect(() => {
    if (!targets) return undefined;
    document.body.dataset.guide = targets;
    return () => { delete document.body.dataset.guide; };
  }, [targets]);

  // The person's own task, wherever it is listed (Up next, the wall's picks),
  // is ringed by its uuid; the starter tasks around it are not.
  const ownUuid = card && card.targets.includes("own") ? state.taskUuid : null;
  useEffect(() => {
    if (!ownUuid) return undefined;
    const mark = () => document.querySelectorAll(`[data-task-uuid="${ownUuid}"]`).forEach(el => {
      if (!el.hasAttribute("data-guide-own")) el.setAttribute("data-guide-own", "");
    });
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll("[data-guide-own]").forEach(el => el.removeAttribute("data-guide-own"));
    };
  }, [ownUuid]);

  // Coach's own chat stays out of reach at its stop: onboarding makes no AI
  // request. The written examples in this card stand in for it.
  useEffect(() => {
    if (stopId !== "coach") return undefined;
    let el = null;
    const id = requestAnimationFrame(() => {
      el = document.querySelector('[data-guide-id="coach"]');
      el?.setAttribute("inert", "");
    });
    return () => { cancelAnimationFrame(id); el?.removeAttribute("inert"); };
  }, [stopId]);

  // Mind Box: a thought saved at this stop is acknowledged, not required.
  const thoughtsAtStop = useRef(null);
  useEffect(() => { thoughtsAtStop.current = stopId === "mindbox" ? thoughtCount : null; }, [stopId]); // eslint-disable-line react-hooks/exhaustive-deps
  const addedThought = stopId === "mindbox" && thoughtsAtStop.current != null && thoughtCount > thoughtsAtStop.current;

  const [example, setExample] = useState(() => exampleForNeed(challengeType));

  // Esc skips the guide, unless a dialog (which owns Esc) is open or the
  // person is typing.
  const skipAction = card?.skip?.action;
  useEffect(() => {
    if (!skipAction) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [data-guide-id="donow"]')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
      onAction(skipAction);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [skipAction, onAction]);

  // While the task's own screen is open at the pin step, the card steps aside:
  // it would sit over Do this now. The ring on that button carries on alone.
  const [taskOpen, setTaskOpen] = useState(false);
  const pinStep = state?.step === "pin" && !state?.resume;
  useEffect(() => {
    if (!pinStep) { setTaskOpen(false); return undefined; }
    const check = () => setTaskOpen(!!document.querySelector('[data-guide-id="donow"]'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pinStep]);
  // On phones the page gets room at the bottom the card's height, so the card
  // never sits over a control the person may need (ChatGPT review of #654).
  const cardRef = useRef(null);
  const showCard = !!card && !taskOpen;
  useEffect(() => {
    const el = cardRef.current;
    if (!showCard || !el) return undefined;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--guide-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    apply();
    document.body.dataset.guideCard = "";
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      delete document.body.dataset.guideCard;
      root.style.removeProperty("--guide-h");
    };
  }, [showCard, stopId, state?.step]);
  if (card && taskOpen) return null;

  if (!card) {
    if (state?.step === "done" && state.note && NOTES[state.note]) {
      return (
        <div className="frg frg-note" role="status">
          <p className="frg-note-text">{NOTES[state.note]}</p>
          <button type="button" className="frg-close" aria-label="Dismiss" onClick={() => onAction("dismissNote")}><IconX size={18} /></button>
        </div>
      );
    }
    return null;
  }

  const showMe = () => {
    if (card.tab) onTab(card.tab);
    requestAnimationFrame(() => {
      const el = card.targets.filter(t => !t.startsWith("nav-"))
        .map(t => document.querySelector(t === "own" ? `[data-task-uuid="${state.taskUuid}"]` : `[data-guide-id="${t}"]`)).find(Boolean);
      el?.scrollIntoView?.({ block: "center" });
    });
  };
  const primaryLabel = stopId === "mindbox" && !addedThought ? "Later" : card.primary?.label;
  const ex = COACH_EXAMPLES[example];

  return (
    <aside className="frg" aria-label="Guide" ref={cardRef}>
      <div className="frg-head">
        <span className="frg-kicker">{card.kicker}</span>
        <button type="button" className="frg-skip" onClick={() => onAction(card.skip.action)}>{card.skip.label}</button>
      </div>
      <div role="status" aria-live="polite" className="frg-copy">
        <strong className="frg-title">{card.title}</strong>
        <p className="frg-text">{card.text}</p>
        {addedThought && <p className="frg-ok">Added to Mind Box.</p>}
      </div>
      {stopId === "coach" && (
        <div className="frg-coach">
          <div className="frg-chips" role="group" aria-label="Example questions">
            {COACH_EXAMPLES.map((e, i) => (
              <button key={e.chip} type="button" className={`frg-chip${i === example ? " is-on" : ""}`} aria-pressed={i === example} onClick={() => setExample(i)}>{e.chip}</button>
            ))}
          </div>
          <figure className="frg-example" aria-label="Example conversation, written in advance">
            <figcaption className="frg-example-cap">EXAMPLE — WRITTEN IN ADVANCE, NOT LIVE</figcaption>
            <p className="frg-bubble is-you">{ex.user}</p>
            <p className="frg-bubble is-coach">{ex.coach}</p>
            {ex.action && <p className="frg-example-action">Coach then offers a button: <strong>{ex.action}</strong></p>}
          </figure>
        </div>
      )}
      <div className="frg-actions">
        {card.targets.length > 0 && <button type="button" className="frg-link" onClick={showMe}>Can’t see it? Show me</button>}
        <span className="frg-spacer" />
        {card.back && <button type="button" className="frg-back" onClick={() => onAction(card.back.action)}>{card.back.label}</button>}
        {card.primary && <button type="button" className="frg-next" onClick={() => onAction(card.primary.action)}>{primaryLabel}</button>}
      </div>
    </aside>
  );
}
