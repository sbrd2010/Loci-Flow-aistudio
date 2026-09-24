import React, { useEffect, useRef, useState } from "react";
import { IconUndo } from "./icons";
import "../../styles/undoToast.css";

// "Undo, not confirm" (brief; README checklist): the action has already
// happened, and this offers it back for 5 seconds. It stays while it has
// focus or the pointer is on it. Remount it (a new key) for each action so
// the 5 seconds start again. It is not itself the live region: a region
// inserted already holding its text is often not announced, so the parent
// keeps an always-present one (UndoAnnouncer) and changes its text.
const UNDO_MS = 5000;

export default function UndoToast({ message, onUndo, onClose }) {
  // Held while the pointer is over it OR focus is inside it — tracked apart,
  // so leaving with the mouse can't restart the clock under a focused Undo.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const leftRef = useRef(UNDO_MS);
  const [barKey, setBarKey] = useState(0);

  useEffect(() => {
    if (held) return undefined;
    setBarKey(k => k + 1);
    const startedAt = Date.now();
    const timer = setTimeout(onClose, leftRef.current);
    return () => {
      clearTimeout(timer);
      leftRef.current = Math.max(0, leftRef.current - (Date.now() - startedAt));
    };
  }, [held]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="undo-toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
    >
      <span className="undo-toast-text">{message}</span>
      <button type="button" className="undo-toast-btn" onClick={onUndo}>
        <IconUndo size={17} strokeWidth={2.2} />
        Undo
      </button>
      {!held && (
        <span
          key={barKey}
          className="undo-toast-bar"
          aria-hidden="true"
          style={{ animationDuration: `${leftRef.current}ms`, width: `${(leftRef.current / UNDO_MS) * 100}%` }}
        />
      )}
    </div>
  );
}

// The polite live region for the toast, rendered once and always present;
// only its text changes (37 table: "Done. Undo available.").
export function UndoAnnouncer({ message }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {message ? `${message}. Undo available.` : ""}
    </span>
  );
}
