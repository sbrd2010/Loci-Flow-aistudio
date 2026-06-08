import React, { useEffect, useRef, useState } from "react";
import "../styles/focusMode.css";

const DURATION_OPTIONS = [15, 20, 25, 30, 45, 60, 90];

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.8 7.8A7 7 0 1 1 5 12.5" />
      <path d="M6.8 7.8H3.5V4.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 6v12" />
      <path d="M16 6v12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  );
}

const hiddenControlTextStyle = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

const PIP_SUPPORTED = "documentPictureInPicture" in window;

function buildPiPContent(pipWin) {
  const style = pipWin.document.createElement("style");
  style.textContent = [
    "* { box-sizing: border-box; margin: 0; padding: 0; }",
    "body { background: #05090b; display: flex; flex-direction: column;",
    "  align-items: center; justify-content: center; height: 100vh;",
    "  font-family: system-ui, sans-serif; user-select: none; }",
    "#pt { font-family: 'Space Mono','Courier New',monospace; font-size: 40px;",
    "  font-weight: 700; color: #f7fbf8; letter-spacing: -0.02em;",
    "  font-variant-numeric: tabular-nums; transition: color 0.3s; }",
    "#pt.paused { color: rgba(247,251,248,0.35); }",
    "#pl { font-size: 10px; color: rgba(196,223,210,0.65); margin-top: 5px;",
    "  max-width: 186px; overflow: hidden; text-overflow: ellipsis;",
    "  white-space: nowrap; text-align: center; }",
    "#pip-btns { display: flex; gap: 10px; margin-top: 12px; }",
    "#pip-play, #pip-reset { background: rgba(255,255,255,0.10);",
    "  border: 1px solid rgba(255,255,255,0.18); color: #f7fbf8;",
    "  border-radius: 8px; font-size: 18px; width: 44px; height: 36px;",
    "  display: flex; align-items: center; justify-content: center;",
    "  cursor: pointer; line-height: 1; }",
    "#pip-play:active, #pip-reset:active { opacity: 0.6; }",
  ].join(" ");
  pipWin.document.head.appendChild(style);

  const timeEl = pipWin.document.createElement("div");
  timeEl.id = "pt";
  pipWin.document.body.appendChild(timeEl);

  const labelEl = pipWin.document.createElement("div");
  labelEl.id = "pl";
  pipWin.document.body.appendChild(labelEl);

  const btnsEl = pipWin.document.createElement("div");
  btnsEl.id = "pip-btns";

  const playBtn = pipWin.document.createElement("button");
  playBtn.id = "pip-play";
  playBtn.textContent = "▶";
  playBtn.addEventListener("click", () => window.__lociTimer?.onPlayPause?.());

  const resetBtn = pipWin.document.createElement("button");
  resetBtn.id = "pip-reset";
  resetBtn.textContent = "↺";
  resetBtn.addEventListener("click", () => window.__lociTimer?.onReset?.());

  btnsEl.appendChild(playBtn);
  btnsEl.appendChild(resetBtn);
  pipWin.document.body.appendChild(btnsEl);
}

export default function FocusModePage({
  task,
  secondsLeft,
  maxSeconds,
  isRunning,
  onPlayPause,
  onReset,
  onDone,
  onExit,
  onChangeDuration,
  onAddBrainDump,
}) {
  const autoExitRef = useRef(null);
  const isComplete = secondsLeft === 0;

  const [dumpText, setDumpText] = useState("");
  const [dumpSaved, setDumpSaved] = useState(false);
  const dumpInputRef = useRef(null);

  const [pipOpen, setPipOpen] = useState(false);
  const pipIntervalRef = useRef(null);
  const pipWinRef = useRef(null);

  const handleOpenPiP = async () => {
    if (!PIP_SUPPORTED || pipOpen) return;
    try {
      const pipWin = await window.documentPictureInPicture.requestWindow({ width: 200, height: 165 });
      pipWinRef.current = pipWin;
      buildPiPContent(pipWin);
      setPipOpen(true);

      // Poll timer state from parent window every 500ms; parent writes window.__lociTimer
      const tick = () => {
        const state = window.__lociTimer;
        const timeEl = pipWin.document.getElementById("pt");
        if (!state || !timeEl) return;
        const mins = Math.floor(state.secondsLeft / 60);
        const s = String(state.secondsLeft % 60).padStart(2, "0");
        timeEl.textContent = `${mins}:${s}`;
        timeEl.className = state.isRunning ? "" : "paused";
        const labelEl = pipWin.document.getElementById("pl");
        if (labelEl) labelEl.textContent = state.taskTitle || "Deep Focus";
        const playBtn = pipWin.document.getElementById("pip-play");
        if (playBtn) playBtn.textContent = state.isRunning ? "⏸" : "▶";
      };
      pipIntervalRef.current = setInterval(tick, 500);
      tick();

      pipWin.addEventListener("pagehide", () => {
        clearInterval(pipIntervalRef.current);
        setPipOpen(false);
        pipWinRef.current = null;
      });
    } catch {
      // User dismissed or browser blocked — fail silently
    }
  };

  // Clean up PiP on focus overlay exit
  useEffect(() => () => {
    clearInterval(pipIntervalRef.current);
    try { pipWinRef.current?.close(); } catch {}
  }, []);

  useEffect(() => {
    if (isComplete) {
      autoExitRef.current = setTimeout(() => {
        onExit();
      }, 3000);
    }
    return () => {
      if (autoExitRef.current) clearTimeout(autoExitRef.current);
    };
  }, [isComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitDump = () => {
    if (!dumpText.trim()) return;
    onAddBrainDump?.(dumpText.trim());
    setDumpText("");
    setDumpSaved(true);
    setTimeout(() => setDumpSaved(false), 1500);
  };

  const R = 110;
  const circ = 2 * Math.PI * R;
  const ratio = maxSeconds > 0 ? secondsLeft / maxSeconds : 0;
  const strokeDashoffset = circ * (1 - ratio);
  const pct = ratio * 100;

  let ringStroke = "#7ab59b";
  if (isComplete) ringStroke = "#a5d6a7";
  else if (pct <= 20) ringStroke = "#d46a5f";
  else if (pct <= 50) ringStroke = "#c99248";

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const stateLabel = isComplete ? "Complete" : isRunning ? "In progress" : "Paused";
  const currentDurMins = Math.round(maxSeconds / 60);

  return (
    <div className={`focus-mode-overlay${isRunning ? " is-running" : ""}${isComplete ? " is-complete" : ""}`}>
      <button
        type="button"
        className="focus-mode-exit-btn"
        onClick={onExit}
        aria-label="Exit focus mode"
      >
        Exit
      </button>

      {PIP_SUPPORTED && !pipOpen && !isComplete && (
        <button
          type="button"
          className="focus-mode-pip-btn"
          onClick={handleOpenPiP}
          title="Pop out a floating mini-timer"
          aria-label="Pop out timer"
        >
          Pop out
        </button>
      )}

      <main className="focus-mode-body" aria-label="Deep focus session">
        <div className="focus-mode-session-meta">
          <span className="focus-mode-header-label">Deep Focus</span>
          <span className="focus-mode-state-pill">{stateLabel}</span>
        </div>

        <div className="focus-mode-ring-wrapper">
          <svg
            className="focus-mode-svg"
            viewBox="0 0 260 260"
            aria-hidden="true"
          >
            <circle
              className="focus-mode-ring-bg"
              cx="130"
              cy="130"
              r={R}
              strokeWidth="8"
            />
            <circle
              className="focus-mode-ring-progress"
              cx="130"
              cy="130"
              r={R}
              strokeWidth="8"
              stroke={ringStroke}
              style={{
                strokeDasharray: circ,
                strokeDashoffset,
              }}
            />
          </svg>

          <div className="focus-mode-time-overlay">
            <span className="focus-mode-time-digits">
              {mins}:{secs}
            </span>
            {isComplete && (
              <span className="focus-mode-complete-text">Session complete</span>
            )}
          </div>
        </div>

        {/* Duration picker — only when timer is paused/not started */}
        {!isRunning && !isComplete && (
          <div className="focus-mode-duration-row" aria-label="Focus duration">
            {DURATION_OPTIONS.map(m => (
              <button
                key={m}
                type="button"
                className={`focus-mode-dur-btn${currentDurMins === m ? " active" : ""}`}
                onClick={() => onChangeDuration?.(m)}
                aria-pressed={currentDurMins === m}
              >
                {m}m
              </button>
            ))}
          </div>
        )}

        <section className="focus-mode-task-panel" aria-label="Focused task">
          <div className="focus-mode-task-kicker">Now focusing on</div>
          <h1 className="focus-mode-task-title">{task.title}</h1>
          {task.concreteStep && (
            <p className="focus-mode-concrete-step">{task.concreteStep}</p>
          )}
        </section>

        {!isComplete && (
          <div className="focus-mode-controls" aria-label="Timer controls">
            <button
              type="button"
              className="focus-mode-ctrl-btn"
              onClick={onReset}
              title="Reset timer"
              aria-label="Reset timer"
            >
              <ResetIcon />
            </button>

            <button
              type="button"
              className="focus-mode-ctrl-btn focus-mode-ctrl-play"
              data-testid="timer-play-pause"
              onClick={onPlayPause}
              aria-label={isRunning ? "Pause timer" : "Start timer"}
            >
              {isRunning ? <PauseIcon /> : <PlayIcon />}
              <span
                className="focus-mode-control-text"
                aria-hidden="true"
                style={hiddenControlTextStyle}
              >
                {isRunning ? "⏸" : "▶"}
              </span>
            </button>
          </div>
        )}

        <button
          type="button"
          className="focus-mode-done-btn"
          onClick={onDone}
          aria-label="Mark task complete and exit"
        >
          <CheckIcon />
          <span>Done</span>
        </button>

        {/* Brain dump — capture stray thoughts without breaking focus */}
        {onAddBrainDump && (
          <div className="focus-mode-dump-row">
            <input
              ref={dumpInputRef}
              type="text"
              className="focus-mode-dump-input"
              placeholder="Stray thought? Capture it here ↵"
              value={dumpText}
              onChange={e => setDumpText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitDump(); }}
              aria-label="Capture a thought to Brain Dump"
            />
            <button
              type="button"
              className={`focus-mode-dump-btn${dumpSaved ? " saved" : ""}`}
              onClick={submitDump}
              aria-label="Save thought to Brain Dump"
            >
              {dumpSaved ? "✓" : "Save"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
