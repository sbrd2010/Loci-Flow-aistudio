import React, { useLayoutEffect, useRef, useState } from "react";

// 74: a Coach reply shows at most four lines, then "Show all" (and "Show
// less" once open), so the last two messages each way stay on screen. The
// link sits at the right of the reply's name row (`head`), not on a line of
// its own, which would take the room the cut gives back. `text` re-checks
// the length when the reply changes.
export default function ClampedReply({ text, head, children }) {
  const ref = useRef(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  const headRef = useRef(null);
  const opened = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text, open]);
  // Opening scrolls the reply's head to the top; the scroll unpins the chat
  // from its bottom, so the reply reads from its start.
  useLayoutEffect(() => {
    if (open && opened.current) headRef.current?.scrollIntoView?.({ block: "start" });
    opened.current = false;
  }, [open]);
  return (
    <>
      <div className="coach-reply-head" ref={headRef}>
        {head}
        {(long || open) && (
          <button type="button" className="coach-show-all" aria-expanded={open} onClick={() => { opened.current = !open; setOpen(o => !o); }}>
            {open ? "Show less" : "Show all"}
          </button>
        )}
      </div>
      <div ref={ref} className={`coach-reply${open ? "" : " is-clamped"}`}>{children}</div>
    </>
  );
}
