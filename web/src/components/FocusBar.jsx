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
//
// At block end (Q41) it goes through the same states as the focus page:
// "BLOCK n DONE" with a full ring, Take a break (Enter) · Back to focus; the
// break counting down; then "BREAK'S OVER", Start block n+1 (Enter) · Back.
// On a phone that is Break · Back, then Start · Back.
export default function FocusBar({
  task, secondsLeft, maxSeconds, isRunning, sessionMinutes = 0,
  onPlayPause, onBack, onEnd, pipOpen, onOpenPiP,
  blockEnd = null, blockNumber = 1, onStartBreak, onStartNext, onHoldBlockEnd,
}) {
  const [ending, setEnding] = useState(false);
  const [more, setMore] = useState(false);
  const pressRef = useRef(null);
  // A long press opens the menu; the tap its release makes (on Pause, say)
  // is swallowed, or opening the menu would also pause (Codex review of #437).
  const longPressedRef = useRef(false);

  const phase = blockEnd?.phase || null;
  // The End session question holds block end's 60 s wait; and 0:00 no
  // longer takes the bar away, so the question survives it (Codex review
  // of #435).
  const onHoldRef = useRef(onHoldBlockEnd);
  onHoldRef.current = onHoldBlockEnd;
  useEffect(() => {
    onHoldRef.current?.(ending);
    return () => { if (ending) onHoldRef.current?.(false); };
  }, [ending]);

  // F goes back to focus, from anywhere the bar shows (not while typing).
  // At block end, Enter takes the break, or starts the next block.
  const keysRef = useRef({});
  keysRef.current = { onBack, ending, phase, onStartBreak, onStartNext };
  useEffect(() => {
    const onKey = (e) => {
      if (keysRef.current.ending || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); keysRef.current.onBack?.(); return; }
      if (e.key === "Enter" && !(t && (t.tagName === "BUTTON" || t.tagName === "A"))) {
        const k = keysRef.current;
        if (k.phase === "done") { e.preventDefault(); k.onStartBreak?.(); }
        else if (k.phase === "over") { e.preventDefault(); k.onStartNext?.(); }
      }
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
  const n = Math.max(1, blockNumber);
  const ring = phase === "break"
    ? { secondsLeft: blockEnd.breakLeft, maxSeconds: blockEnd.breakSeconds, paused: false }
    : phase ? { secondsLeft: 1, maxSeconds: 1, paused: false } // full: the block is done
      : { secondsLeft, maxSeconds, paused: !isRunning };

  return (
    <>
      <div
        className={`focus-bar${isRunning || phase ? "" : " is-paused"}${phase ? " is-block-end" : ""}`}
        role="region"
        aria-label="Focus session"
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onClickCapture={swallowAfterLongPress}
        onContextMenu={e => { e.preventDefault(); setMore(true); }}
      >
        <MiniRing secondsLeft={ring.secondsLeft} maxSeconds={ring.maxSeconds} paused={ring.paused} />
        <span className="fb-time" aria-live="polite">
          {phase === "done" ? (
            <span className="fb-of">BLOCK {n} DONE</span>
          ) : phase === "break" ? (
            <>
              <span className="fb-clock">{clock(blockEnd.breakLeft)}</span>
              <span className="fb-of">BREAK</span>
            </>
          ) : phase === "over" ? (
            <span className="fb-of">BREAK&rsquo;S OVER</span>
          ) : (
            <>
              <span className="fb-clock">{clock(secondsLeft)}</span>
              <span className="fb-of">{isRunning ? `OF ${blockLabel}` : "PAUSED"}</span>
            </>
          )}
        </span>
        <span className="fb-title">{task.title}</span>
        {phase === "done" ? (
          <button type="button" className="fb-btn" onClick={onStartBreak}>
            <span className="fb-long">Take a break</span><span className="fb-short">Break</span> <kbd className="fb-kbd" aria-hidden="true">Enter</kbd>
          </button>
        ) : phase === "over" ? (
          <button type="button" className="fb-btn" onClick={onStartNext}>
            <span className="fb-long">Start block {n + 1}</span><span className="fb-short">Start</span> <kbd className="fb-kbd" aria-hidden="true">Enter</kbd>
          </button>
        ) : phase === "break" ? null : (
          <>
            <button type="button" className="fb-btn" onClick={onPlayPause} aria-label={isRunning ? "Pause focus timer" : "Resume focus timer"}>
              {isRunning ? "Pause" : "Resume"}
            </button>
            {PIP_SUPPORTED && !pipOpen && onOpenPiP && (
              <button type="button" className="fb-btn fb-more" onClick={onOpenPiP}>Mini window</button>
            )}
            <button type="button" className="fb-btn fb-more" onClick={() => setEnding(true)}>End session…</button>
          </>
        )}
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
