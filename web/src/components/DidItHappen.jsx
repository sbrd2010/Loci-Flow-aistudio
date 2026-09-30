import React, { useEffect, useRef, useState } from "react";
import { formatClock24 } from "../utils/dayMapPlan";

// Q47.5 (frame 60): the second line of a set-time stop still open 5 minutes
// after it ended (Q36a). "Did it happen?", Done (outlined) and Move (text).
// Move opens its choices under the row — a small bottom sheet on a phone:
// Later today (the next free slot, when one fits before the day ends),
// Tomorrow (its time cleared), or Pick a time…
export default function DidItHappen({ title, laterAt = null, onDone, onLater, onTomorrow, onPickTime }) {
  const [open, setOpen] = useState(false);
  const moveRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => { if (open) menuRef.current?.querySelector("button")?.focus(); }, [open]);

  const close = () => { setOpen(false); moveRef.current?.focus(); };
  const choose = (fn) => () => { setOpen(false); fn(); };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...menuRef.current.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    // A tap on the line itself isn't the row's: only Done and Move act here.
    <div className="dih" role="group" aria-label={`Did it happen? ${title}`} onPointerDown={e => e.stopPropagation()}>
      <span className="dih-text">Did it happen?</span>
      <span className="dih-actions">
        <button type="button" className="dih-done" onClick={onDone}>Done</button>
        <button type="button" className="dih-move" ref={moveRef} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>Move</button>
      </span>
      {open && (
        <>
          <div className="dih-scrim" onClick={close} />
          <div className="dih-menu" role="menu" aria-label={`Move ${title}`} ref={menuRef} onKeyDown={onKeyDown}>
            {laterAt != null && (
              <button type="button" role="menuitem" className="dih-item" onClick={choose(() => onLater(laterAt))}>
                <span>Later today</span><span className="dih-meta">{formatClock24(laterAt)}</span>
              </button>
            )}
            <button type="button" role="menuitem" className="dih-item" onClick={choose(onTomorrow)}>
              <span>Tomorrow</span><span className="dih-meta is-note">time cleared</span>
            </button>
            <button type="button" role="menuitem" className="dih-item is-pick" onClick={choose(onPickTime)}>Pick a time…</button>
          </div>
        </>
      )}
    </div>
  );
}
