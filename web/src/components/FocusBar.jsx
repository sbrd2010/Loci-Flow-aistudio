import React, { useEffect, useRef, useState } from "react";
import { MiniRing } from "./FocusClock";
import EndSessionDialog from "./EndSessionDialog";
import "../styles/focusBar.css";

const PIP_SUPPORTED = typeof window !== "undefined" && "documentPictureInPicture" in window;
const LONG_PRESS_MS = 500;

const clock = (s) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};

// The focus bar (59e): shown while a session runs and you are off the focus
// page — on Plan, Mind Box, Coach and the Day map page, never on Today, where
// the wall says "Back to focus" instead (59f). A 28px ring, the time and "OF
// 25:00" (or "PAUSED"), the title, Pause/Resume, Mini window, End session…
// (it asks, 59h) and a filled "Back to focus (F)". No ×. On a phone: full
// width above the tab bar with Pause and Back; a long press offers the rest.
export default function FocusBar({
  task, secondsLeft, maxSeconds, isRunning, sessionMinutes = 0,
  onPlayPause, onBack, onEnd, pipOpen, onOpenPiP,
}) {
  const [ending, setEnding] = useState(false);
  const [more, setMore] = useState(false);
  const pressRef = useRef(null);
  // A long press opens the menu; the tap its release makes (on Pause, say)
  // is swallowed, or opening the menu would also pause (Codex review of #437).
  const longPressedRef = useRef(false);

  // F goes back to focus, from anywhere the bar shows (not while typing).
  const keysRef = useRef({});
  keysRef.current = { onBack, ending };
  useEffect(() => {
    const onKey = (e) => {
      if (keysRef.current.ending || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); keysRef.current.onBack?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!task) return null;

  const startPress = () => {
    longPressedRef.current = false;
    clearTimeout(pressRef.current);
    pressRef.current = setTimeout(() => { longPressedRef.current = true; setMore(true); }, LONG_PRESS_MS);
  };
  const endPress = () => clearTimeout(pressRef.current);
  const swallowAfterLongPress = (e) => {
    if (!longPressedRef.current) return;
    longPressedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const blockLabel = clock(maxSeconds);

  return (
    <>
      <div
        className={`focus-bar${isRunning ? "" : " is-paused"}`}
        role="region"
        aria-label="Focus session"
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onClickCapture={swallowAfterLongPress}
        onContextMenu={e => { e.preventDefault(); setMore(true); }}
      >
        <MiniRing secondsLeft={secondsLeft} maxSeconds={maxSeconds} paused={!isRunning} />
        <span className="fb-time">
          <span className="fb-clock">{clock(secondsLeft)}</span>
          <span className="fb-of">{isRunning ? `OF ${blockLabel}` : "PAUSED"}</span>
        </span>
        <span className="fb-title">{task.title}</span>
        <button type="button" className="fb-btn" onClick={onPlayPause} aria-label={isRunning ? "Pause focus timer" : "Resume focus timer"}>
          {isRunning ? "Pause" : "Resume"}
        </button>
        {PIP_SUPPORTED && !pipOpen && onOpenPiP && (
          <button type="button" className="fb-btn fb-more" onClick={onOpenPiP}>Mini window</button>
        )}
        <button type="button" className="fb-btn fb-more" onClick={() => setEnding(true)}>End session…</button>
        <button type="button" className="fb-back" onClick={onBack}>
          Back to focus <kbd className="fb-kbd" aria-hidden="true">F</kbd>
        </button>
      </div>

      {/* Phone: what a long press offers. */}
      {more && (
        <div className="fb-menu-scrim" onClick={() => setMore(false)}>
          <div className="fb-menu" role="menu" aria-label="Focus session" onClick={e => e.stopPropagation()}>
            {PIP_SUPPORTED && !pipOpen && onOpenPiP && (
              <button type="button" role="menuitem" className="fb-menu-item" onClick={() => { setMore(false); onOpenPiP(); }}>Mini window</button>
            )}
            <button type="button" role="menuitem" className="fb-menu-item" onClick={() => { setMore(false); setEnding(true); }}>End session…</button>
            <button type="button" role="menuitem" className="fb-menu-item" onClick={() => setMore(false)}>Close</button>
          </div>
        </div>
      )}

      {ending && (
        <EndSessionDialog
          minutes={sessionMinutes}
          onEnd={({ note, tomorrow }) => { setEnding(false); onEnd?.({ note, tomorrow }); }}
          onClose={() => setEnding(false)}
        />
      )}
    </>
  );
}
