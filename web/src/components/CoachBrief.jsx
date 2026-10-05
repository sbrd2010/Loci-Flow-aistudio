import React, { useEffect, useState } from "react";
import { isEventTask } from "../utils/dayMapRoute";
import SectionHead from "./CoachSectionHead";

// Coach's brief (Q51, 73a/b): section 01 of Review. A lead sentence from the
// facts, then label/text rows and a "Do next" card. It runs only on
// "Brief me", keeps only the latest, and every action is a button with Undo
// (Q50). Rows show only when they have something; on a phone Patterns and the
// middle rows fold to one line.

const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
// "09:41" today; "30 Sep 09:41" for an older brief, so it never reads as today's.
const stamp = (ms) => {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? clock(ms) : `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${clock(ms)}`;
};
const estimate = (t) => (Number(t?.timeEstimateMinutes) > 0 ? ` · ${Math.round(t.timeEstimateMinutes)}m` : "");

function useMedia(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, [query]);
  return on;
}

function Group({ kicker, warn = false, folded = false, children }) {
  if (folded) {
    return (
      <details className="br-group br-fold">
        <summary className={`br-label${warn ? " is-warn" : ""}`}>{kicker} ▸</summary>
        <div className="br-text">{children}</div>
      </details>
    );
  }
  return (
    <div className="br-group">
      <h3 className={`br-label${warn ? " is-warn" : ""}`}>{kicker}</h3>
      <div className="br-text">{children}</div>
    </div>
  );
}

export default function CoachBrief({ brief, status = "idle", error = "", lead = null, weekdayLine = null, tasks = [], horizonName = (id) => id, onBriefMe, onAsk, onMove, onMakeOneThing, onSplit, actionsDisabled = false }) {
  // What this session applied, by line: { label, undo }.
  const [done, setDone] = useState({});
  useEffect(() => { setDone({}); }, [brief?.at]);
  const phone = useMedia("(max-width: 599px)");

  const live = (uuid) => tasks.find(t => t.uuid === uuid && !t.isDeleted && !t.isCompleted);
  const apply = (key, label, run) => {
    const undo = run();
    if (undo !== null && undo !== undefined) setDone(d => ({ ...d, [key]: { label, undo: typeof undo === "function" ? undo : null } }));
  };
  const undoLine = (key) => {
    if (actionsDisabled) return;
    const entry = done[key];
    setDone(d => { const n = { ...d }; delete n[key]; return n; });
    entry?.undo?.();
  };
  const Action = ({ k, label, doneLabel, run }) => (done[k]
    ? (
      <span className="br-applied">
        ✓ {done[k].label}
        {done[k].undo && <button type="button" className="br-link" disabled={actionsDisabled} onClick={() => undoLine(k)}>Undo</button>}
      </span>
    )
    : <button type="button" className="br-link" disabled={actionsDisabled} onClick={() => apply(k, doneLabel, run)}>{label}</button>);

  const head = (
    <>
      <SectionHead num="01" title="Coach’s brief">
        {brief && status !== "running" && (
          <span className="br-stamp">Read {stamp(brief.at)} <button type="button" className="br-link br-refresh" onClick={onBriefMe}>Refresh</button></span>
        )}
      </SectionHead>
      {lead && <p className="br-lead">{lead}</p>}
    </>
  );

  if (!brief || status === "running") {
    return (
      <div className="br">
        {head}
        <p className="br-lede">Coach reads today, the last 7 days and the last 30, and tells you how it went, what it sees, and what could change. Nothing changes until you tap.</p>
        {status === "running"
          ? <p className="br-status" role="status">Reading 3 periods…</p>
          : <button type="button" className="br-run" onClick={onBriefMe}>Brief me</button>}
        {status === "error" && <p className="br-error" role="alert">{error || "Couldn’t reach Coach. Try again."}</p>}
        <p className="br-privacy">Sends summary numbers and up to 10 open tasks (title, first step, front and category) to your AI provider.</p>
      </div>
    );
  }

  // A move the task already made (here or elsewhere) has nothing left to do.
  const movable = (uuid, to) => live(uuid) && live(uuid).horizonLevel !== to;
  const tooMuch = brief.tooMuch ? { ...brief.tooMuch, items: brief.tooMuch.items.filter(i => movable(i.uuid, i.to) || done[`move:${i.uuid}:${i.to}`]) } : null;
  // A split task is gone once split; its line stays to show "✓ Split" and Undo.
  const estimates = (brief.estimates || []).filter(e => (e.action === "split" ? live(e.uuid) : movable(e.uuid, e.action)) || done[`split:${e.uuid}`] || done[`move:${e.uuid}:${e.action}`]);
  const next = brief.next && live(brief.next.uuid) ? brief.next : null;
  const foldMiddle = phone && (tooMuch?.items.length || estimates.length);
  const patterns = [weekdayLine, ...(brief.patterns || [])].filter(Boolean);

  return (
    <div className="br">
      {head}
      {status === "error" && <p className="br-error" role="alert">{error || "Couldn’t reach Coach. Try again."}</p>}

      <div className="br-groups">
        {brief.howItWent?.length > 0 && (
          <Group kicker="How it went"><p className="br-line">{brief.howItWent.join(" ")}</p></Group>
        )}
        {patterns.length > 0 && (
          <Group kicker="Patterns" folded={phone}><p className="br-line">{patterns.join(" ")}</p></Group>
        )}
        {foldMiddle ? (
          <details className="br-group br-fold">
            <summary className="br-label">{[tooMuch?.items.length && "Too much planned", estimates.length && "Estimates"].filter(Boolean).join(" · ")} ▸</summary>
            <div className="br-text">
              {tooMuch?.items.length > 0 && <TooMuch />}
              {estimates.length > 0 && <Estimates />}
            </div>
          </details>
        ) : (
          <>
            {tooMuch?.items.length > 0 && <Group kicker="Too much planned" warn><TooMuch /></Group>}
            {estimates.length > 0 && <Group kicker="Estimates"><Estimates /></Group>}
          </>
        )}
      </div>
      {next && (
        <div className="br-next">
          <h3 className="br-next-kicker">Do next</h3>
          <p className="br-next-title">{live(next.uuid).title}</p>
          {next.line && <p className="br-next-line">{next.line.replace(/^\.\s*/, "")}</p>}
          <div className="br-next-actions">
            {done[`one:${next.uuid}`]
              ? <Action k={`one:${next.uuid}`} />
              : isEventTask(live(next.uuid))
                ? null
                : live(next.uuid).isNowFocus
                ? <span className="br-applied">It’s the one thing now</span>
                : <button type="button" className="br-run" disabled={actionsDisabled} onClick={() => apply(`one:${next.uuid}`, `The one thing · ${live(next.uuid).title}`, () => onMakeOneThing(next.uuid))}>Make it the one thing</button>}
            <button type="button" className="br-link br-ask" onClick={() => onAsk(brief)}>Ask about this →</button>
          </div>
        </div>
      )}
      {!next && <button type="button" className="br-link br-ask" onClick={() => onAsk(brief)}>Ask about this →</button>}
    </div>
  );

  function TooMuch() {
    return (
      <>
        {tooMuch.line && <p className="br-line">{tooMuch.line}</p>}
        <div className="br-rows">
          {tooMuch.items.map(i => (
            <React.Fragment key={i.uuid}>
              <span className="br-row-name">{live(i.uuid)?.title || i.title}{estimate(live(i.uuid))}</span>
              <Action k={`move:${i.uuid}:${i.to}`} label={horizonName(i.to)} doneLabel={`Moved to ${horizonName(i.to)}`} run={() => onMove(i.uuid, i.to)} />
            </React.Fragment>
          ))}
        </div>
      </>
    );
  }

  function Estimates() {
    return (
      <div className="br-rows">
        {estimates.map(e => (
          <React.Fragment key={e.uuid}>
            <span className="br-row-name is-wrap"><strong>{live(e.uuid)?.title || e.title}</strong> · {e.fact}</span>
            {e.action === "split"
              ? (done[`split:${e.uuid}`]
                ? <Action k={`split:${e.uuid}`} />
                : <button type="button" className="br-link" disabled={actionsDisabled} onClick={() => onSplit(e.uuid, (label, undo) => setDone(d => ({ ...d, [`split:${e.uuid}`]: { label, undo } })))}>Split it</button>)
              : <Action k={`move:${e.uuid}:${e.action}`} label={horizonName(e.action)} doneLabel={`Moved to ${horizonName(e.action)}`} run={() => onMove(e.uuid, e.action)} />}
          </React.Fragment>
        ))}
      </div>
    );
  }
}
