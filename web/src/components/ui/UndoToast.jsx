import React, { useEffect, useRef, useState } from "react";
import { IconUndo } from "./icons";
import "../../styles/undoToast.css";

// "Undo, not confirm" (brief; README checklist): the action has already
// happened, and this offers it back for 5 seconds. A live region, and it
// stays while it has focus or the pointer is on it. Remount it (a new key)
// for each action so the 5 seconds start again.
const UNDO_MS = 5000;

export default function UndoToast({ message, onUndo, onClose }) {
  const [held, setHeld] = useState(false);
  const leftRef = useRef(UNDO_MS);
  const [barKey, setBarKey] = useState(0);

  useEffect(() => {
    if (held) return undefined;
    const startedAt = Date.now();
    const timer = setTimeout(onClose, leftRef.current);
    return () => {
      clearTimeout(timer);
      leftRef.current = Math.max(0, leftRef.current - (Date.now() - startedAt));
    };
  }, [held]); // eslint-disable-line react-hooks/exhaustive-deps

  const hold = () => setHeld(true);
  const release = () => { setHeld(false); setBarKey(k => k + 1); };

  return (
    <div
      className="undo-toast"
      role="status"
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
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
