import React, { useEffect, useState } from "react";

// Coach's brief (Q51, 62a–b): runs only on "Brief me", keeps only the latest,
// and every action is a button with Undo (Q50). The groups show only when they
// have something; on smaller screens the middle ones fold to one line.

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
        <summary className={`br-kicker${warn ? " is-warn" : ""}`}>{kicker} ▸</summary>
        {children}
      </details>
    );
  }
  return (
    <section className="br-group">
      <h3 className={`br-kicker${warn ? " is-warn" : ""}`}>{kicker}</h3>
      {children}
    </section>
  );
}

export default function CoachBrief({ brief, status = "idle", error = "", tasks = [], horizonName = (id) => id, onBriefMe, onAsk, onMove, onMakeOneThing, onSplit, actionsDisabled = false }) {
  // What this session applied, by line: { label, undo }.
  const [done, setDone] = useState({});
  useEffect(() => { setDone({}); }, [brief?.at]);
  const small = useMedia("(max-width: 1279px)");
  const phone = useMedia("(max-width: 599px)");

  const live = (uuid) => tasks.find(t => t.uuid === uuid && !t.isDeleted && !t.isCompleted);
  const apply = (key, label, run) => {
    const undo = run();
    if (undo !== null && undo !== undefined) setDone(d => ({ ...d, [key]: { label, undo: typeof undo === "function" ? undo : null } }));
  };
  const undoLine = (key) => {
    const entry = done[key];
    setDone(d => { const n = { ...d }; delete n[key]; return n; });
    entry?.undo?.();
  };
  const Action = ({ k, label, doneLabel, run }) => (done[k]
    ? (
      <span className="br-applied">
        ✓ {done[k].label}
        {done[k].undo && <button type="button" className="br-link" onClick={() => undoLine(k)}>Undo</button>}
      </span>
    )
    : <button type="button" className="br-link" disabled={actionsDisabled} onClick={() => apply(k, doneLabel, run)}>{label}</button>);

  const head = (
    <div className="br-head">
      <h2 className="br-title">Coach’s brief</h2>
      {brief && status !== "running" && (
        <span className="br-stamp">{stamp(brief.at)} <button type="button" className="br-link br-refresh" onClick={onBriefMe}>Refresh</button></span>
      )}
    </div>
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
        <p className="br-privacy">Sends summary numbers and up to 10 task titles to your AI provider.</p>
      </div>
    );
  }

  // A move the task already made (here or elsewhere) has nothing left to do.
  const movable = (uuid, to) => live(uuid) && live(uuid).horizonLevel !== to;
  const tooMuch = brief.tooMuch ? { ...brief.tooMuch, items: brief.tooMuch.items.filter(i => movable(i.uuid, i.to) || done[`move:${i.uuid}`]) } : null;
  // A split task is gone once split; its line stays to show "✓ Split" and Undo.
  const estimates = (brief.estimates || []).filter(e => (e.action === "split" ? live(e.uuid) : movable(e.uuid, e.action)) || done[`split:${e.uuid}`] || done[`move:${e.uuid}`]);
  const next = brief.next && live(brief.next.uuid) ? brief.next : null;
  const foldMiddle = small && (tooMuch?.items.length || estimates.length);

  return (
    <div className="br">
      {head}
      <span className="br-read">Read today, 7 and 30 days</span>
      {status === "error" && <p className="br-error" role="alert">{error || "Couldn’t reach Coach. Try again."}</p>}

      {brief.howItWent?.length > 0 && (
        <Group kicker="How it went">{brief.howItWent.map((l, i) => <p key={i} className="br-line">{l}</p>)}</Group>
      )}
      {brief.patterns?.length > 0 && (
        <Group kicker="Patterns" folded={phone}>{brief.patterns.map((l, i) => <p key={i} className="br-line">{l}</p>)}</Group>
      )}
      {foldMiddle ? (
        <details className="br-group br-fold">
          <summary className="br-kicker">{[tooMuch?.items.length && "Too much planned", estimates.length && "Estimates"].filter(Boolean).join(" · ")} ▸</summary>
          {tooMuch?.items.length > 0 && <TooMuch />}
          {estimates.length > 0 && <Estimates />}
        </details>
      ) : (
        <>
          {tooMuch?.items.length > 0 && <Group kicker="Too much planned" warn><TooMuch /></Group>}
          {estimates.length > 0 && <Group kicker="Estimates"><Estimates /></Group>}
        </>
      )}
      {next && (
        <Group kicker="Next">
          <p className="br-line"><strong>{live(next.uuid).title}</strong>{next.line ? `. ${next.line.replace(/^\.\s*/, "")}` : ""}</p>
          <div className="br-next-actions">
            {done[`one:${next.uuid}`]
              ? <Action k={`one:${next.uuid}`} />
              : live(next.uuid).isNowFocus
                ? <span className="br-applied">It’s the one thing now</span>
                : <button type="button" className="br-run" disabled={actionsDisabled} onClick={() => apply(`one:${next.uuid}`, `The one thing · ${live(next.uuid).title}`, () => onMakeOneThing(next.uuid))}>Make it the one thing</button>}
            <button type="button" className="br-link br-ask" onClick={() => onAsk(brief)}>Ask about this →</button>
          </div>
        </Group>
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
              <Action k={`move:${i.uuid}`} label={horizonName(i.to)} doneLabel={`Moved to ${horizonName(i.to)}`} run={() => onMove(i.uuid, i.to)} />
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
              : <Action k={`move:${e.uuid}`} label={horizonName(e.action)} doneLabel={`Moved to ${horizonName(e.action)}`} run={() => onMove(e.uuid, e.action)} />}
          </React.Fragment>
        ))}
      </div>
    );
  }
}
