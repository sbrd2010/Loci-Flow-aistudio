import React, { useEffect, useRef, useState } from "react";
import { db, auth } from "../firebase";
import { ref, push } from "firebase/database";
import { IconX } from "./ui/icons";

// Report a bug: a dialog, as Add task is. Writes to /bugReports; not in demo.
// With `context` it reports a Coach reply: the reply (replyReport.js) fills the
// second field, which the tester sees and can edit before sending.
export default function BugReport({ onClose, context = "" }) {
  const [what, setWhat] = useState("");
  const [steps, setSteps] = useState(context);
  const [device, setDevice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.querySelector("#bug-what")?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    if (done) dialogRef.current?.querySelector(".add-close")?.focus();
  }, [done]);
  const onDialogKeyDown = (e) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]")];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!what.trim()) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { setError("Couldn't send — sign in and try again."); return; }
    setBusy(true); setError("");
    try {
      await push(ref(db, "bugReports"), {
        what: what.trim(), steps: steps.trim(), device: device.trim(),
        userId: uid, userEmail: auth.currentUser?.email || null,
        appVersion: import.meta.env.VITE_APP_VERSION || "dev", submittedAt: Date.now(),
      });
      setDone(true);
      setTimeout(onClose, 2000);
    } catch {
      setError("Couldn't send — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-overlay" onClick={() => !busy && onClose()}>
      <div ref={dialogRef} className="add-card set-key-card" role="dialog" aria-modal="true" aria-labelledby="bug-title" onClick={e => e.stopPropagation()} onKeyDown={onDialogKeyDown}>
        <div className="add-head">
          <h2 id="bug-title" className="add-heading">{context ? "Report this reply" : "Report a bug"}</h2>
          {!busy && <button type="button" className="add-close" onClick={onClose} aria-label="Close"><IconX size={20} /></button>}
        </div>
        {done ? (
          <p className="set-lede" role="status">Sent. Thank you — we'll look into it.</p>
        ) : (
          <form onSubmit={submit}>
            <label className="set-field">
              <span className="set-label">{context ? "What was wrong with it?" : "What happened?"}</span>
              <textarea id="bug-what" className="set-input set-textarea" rows={3} maxLength={2000} value={what} onChange={e => setWhat(e.target.value)} placeholder={context ? "Wrong, unkind, unsafe, off-topic…" : "What did you expect, and what happened instead?"} required />
            </label>
            <label className="set-field">
              <span className="set-label">{context ? "Sent with your report (you can edit it)" : "Steps to reproduce (optional)"}</span>
              <textarea id="bug-steps" className="set-input set-textarea" rows={context ? 6 : 2} maxLength={2000} value={steps} onChange={e => setSteps(e.target.value)} placeholder="1. Go to… 2. Tap… 3. See…" />
            </label>
            <label className="set-field">
              <span className="set-label">Device / browser (optional)</span>
              <input id="bug-device" className="set-input" value={device} onChange={e => setDevice(e.target.value)} placeholder="e.g. Pixel 8, Chrome" />
            </label>
            {error && <p className="set-window-hint" role="alert">{error}</p>}
            <button type="submit" className="add-submit" disabled={busy || !what.trim()}>{busy ? "Sending…" : "Send report"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
