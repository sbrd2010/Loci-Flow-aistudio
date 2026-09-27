import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

// Today's show/hide list (turn 51, 51e–f): the only layout motion in the app.
// FLIP with the Web Animations API, on transform and opacity only: switch the
// layout, measure, invert with a transform, play. A second toggle mid-move
// measures where things are (a bounding box includes the running transform)
// and plays from there, so it reverses from where the task is.

const GLIDE = "cubic-bezier(0.2, 0, 0, 1)";
const ENTER = "cubic-bezier(0, 0, 0.2, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";

// Laptop glides; a tablet (840–1023) rises, because its hidden task becomes a
// different shape and a scale would re-wrap mid-flight; phones keep the sheet.
export function listMotionMode(win = typeof window !== "undefined" ? window : null) {
  if (!win || win.innerWidth < 840) return "none";
  if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "reduce";
  return win.innerWidth >= 1024 ? "glide" : "rise";
}

function rects(root) {
  const out = {};
  root.querySelectorAll("[data-flip]").forEach(el => { out[el.dataset.flip] = el.getBoundingClientRect(); });
  return out;
}

// A fixed-position copy that fades out after the real element has gone: its
// computed styles are copied node by node, so it looks the same outside the
// layout that styled it.
function ghostOf(el) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const copy = el.cloneNode(true);
  const from = [el, ...el.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((node, i) => {
    const cs = getComputedStyle(node);
    for (const prop of cs) to[i].style.setProperty(prop, cs.getPropertyValue(prop));
    to[i].removeAttribute("id");
  });
  Object.assign(copy.style, {
    position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, margin: "0",
    width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: "none", zIndex: "5",
  });
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  document.body.appendChild(copy);
  return copy;
}

const visible = el => !!el && el.getClientRects().length > 0;

export function useListChoreography({ rootRef, listRef, setOpen }) {
  const anims = useRef([]);
  const ghosts = useRef([]);
  const leaving = useRef(null);
  const busyUntil = useRef(0);

  // The list faded out: back to the display React gave it.
  const releaseLeaving = useCallback(() => {
    if (!leaving.current) return;
    const el = leaving.current;
    ["position", "left", "top", "width", "height", "margin", "pointerEvents", "zIndex"].forEach(p => { el.style[p] = ""; });
    el.style.display = el.dataset.restoreDisplay || "";
    delete el.dataset.restoreDisplay;
    leaving.current = null;
  }, []);

  // Ends the previous toggle's motion. The ghosts to remove are passed in, so
  // a toggle can take its own exit ghosts first and keep them.
  const settle = useCallback((staleGhosts = ghosts.current) => {
    anims.current.forEach(a => a.cancel());
    anims.current = [];
    staleGhosts.forEach(g => g.remove());
    ghosts.current = ghosts.current.filter(g => !staleGhosts.includes(g));
    releaseLeaving();
  }, [releaseLeaving]);
  useEffect(() => () => settle(), [settle]);

  const play = (el, keyframes, opts) => {
    if (!el?.animate) return null;
    const a = el.animate(keyframes, { fill: "backwards", ...opts });
    anims.current.push(a);
    return a;
  };

  const fadeOutGhost = (el, duration, easing) => {
    if (!visible(el)) return;
    const g = ghostOf(el);
    if (!g) return;
    ghosts.current.push(g);
    const a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing, fill: "forwards" });
    a.onfinish = () => { g.remove(); ghosts.current = ghosts.current.filter(x => x !== g); };
  };

  // Keeps the list on screen where it was while it fades out; React has
  // already set it to display: none.
  const holdLeavingList = (el, rect, fromOpacity) => {
    el.dataset.restoreDisplay = el.style.display;
    Object.assign(el.style, {
      display: "flex", position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none", zIndex: "4",
    });
    leaving.current = el;
    const a = el.animate(
      [{ opacity: fromOpacity, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(12px)" }],
      { duration: 120, easing: EXIT, fill: "forwards" },
    );
    anims.current.push(a);
    // Only the list is done at 120ms: the task's glide and the controls'
    // fade-in run on to 320ms and 380ms.
    a.onfinish = () => {
      if (leaving.current !== el) return;
      releaseLeaving();
      a.cancel();
      anims.current = anims.current.filter(x => x !== a);
    };
  };

  const toggle = useCallback((next) => {
    const root = rootRef.current;
    const mode = listMotionMode();
    if (!root || mode === "none") { setOpen(next); return; }
    const now = performance.now();
    // The toggle keeps focus: Show list → Hide list, and back.
    const toggleHadFocus = document.activeElement?.matches?.(".wall-peek, .today-list-hide");
    const handFocus = () => {
      if (toggleHadFocus) root.querySelector(next ? ".today-list-hide" : ".wall-peek")?.focus({ preventScroll: true });
    };
    if (mode === "reduce") {
      if (now < busyUntil.current) return;
      busyUntil.current = now + 130;
      settle();
      const out = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 60, easing: "linear", fill: "forwards" });
      out.onfinish = () => {
        flushSync(() => setOpen(next));
        out.cancel();
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60, easing: "linear" });
        handFocus();
      };
      return;
    }

    const interrupted = anims.current.some(a => a.playState === "running");
    const list = listRef.current;
    const listWasShown = visible(list);
    const listRect = listWasShown ? list.getBoundingClientRect() : null;
    const listOpacity = listWasShown ? Number(getComputedStyle(list).opacity) : 0;
    const before = rects(root);
    const controlsBefore = [...root.querySelectorAll("[data-flip-controls]")].filter(visible);
    const entersBefore = [...root.querySelectorAll("[data-flip-enter]")].filter(visible);
    const heroBefore = root.querySelector(".wall-hero");
    // The previous toggle's ghosts go; this toggle's are taken before the
    // layout changes, while they still look right, and fade out after it.
    const staleGhosts = ghosts.current;
    ghosts.current = [];
    if (next) controlsBefore.forEach(el => fadeOutGhost(el, 80, "linear"));
    else entersBefore.forEach(el => fadeOutGhost(el, 80, "linear"));
    if (mode === "rise") fadeOutGhost(heroBefore, 120, EXIT);

    settle(staleGhosts);
    flushSync(() => setOpen(next));
    const d = ms => (interrupted ? 0 : ms);

    if (!next && listRect && list) holdLeavingList(list, listRect, listOpacity);

    if (mode === "rise") {
      const targets = [root.querySelector(".wall-hero"), next ? list : null];
      targets.filter(visible).forEach(el => play(el,
        [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
        { duration: 220, easing: ENTER, delay: d(60) }));
    } else {
      const after = rects(root);
      for (const [key, a] of Object.entries(after)) {
        const b = before[key];
        const el = root.querySelector(`[data-flip="${key}"]`);
        if (!b || !el || !a.width) continue;
        const dx = b.left - a.left;
        const dy = b.top - a.top;
        const scale = key === "title" ? b.width / a.width : 1;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.001) continue;
        play(el,
          [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }],
          next ? { duration: 280, easing: GLIDE } : { duration: 240, easing: GLIDE, delay: d(80) });
      }
      if (next) {
        if (visible(list)) {
          play(list,
            [{ opacity: interrupted ? listOpacity : 0, transform: "translateX(12px)" }, { opacity: 1, transform: "none" }],
            { duration: 220, easing: ENTER, delay: d(60) });
        }
        root.querySelectorAll("[data-flip-enter]").forEach(el => visible(el) && play(el,
          [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: ENTER, delay: d(60) }));
      } else {
        root.querySelectorAll("[data-flip-controls]").forEach(el => visible(el) && play(el,
          [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: ENTER, delay: d(220) }));
      }
    }

    handFocus();
  }, [rootRef, listRef, setOpen, settle]); // eslint-disable-line react-hooks/exhaustive-deps

  return toggle;
}
