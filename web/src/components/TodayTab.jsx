import React, { useState, useEffect, useRef } from "react";
import TaskRow from "./TaskRow";

export default function TodayTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  // ── Pomodoro timer ──────────────────────────────────────────────────────────
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const timerIntervalRef = useRef(null);

  const activeTask = tasks.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted);

  useEffect(() => {
    if (activeTask) {
      const rawMins = Number(activeTask.timeEstimateMinutes);
      const taskSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(taskSecs);
      if (!isTimerRunning) setTimerSecondsLeft(taskSecs);
    } else {
      const rawMins = Number(config.pomodoroDurationMinutes);
      const defaultSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(defaultSecs);
      if (!isTimerRunning) setTimerSecondsLeft(defaultSecs);
    }
  }, [activeTask?.uuid, activeTask?.timeEstimateMinutes, config.pomodoroDurationMinutes]);

  useEffect(() => {
    if (isTimerRunning) {
      timerIntervalRef.current = setInterval(() => {
        setTimerSecondsLeft(prev => prev <= 1 ? 0 : prev - 1);
      }, 1000);
    } else {
      clearInterval(timerIntervalRef.current);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [isTimerRunning]);

  useEffect(() => {
    if (isTimerRunning && timerSecondsLeft === 0) {
      setIsTimerRunning(false);
      handlePomodoroCompletion();
    }
  }, [timerSecondsLeft, isTimerRunning]);

  // ── Dopamine affirmation ────────────────────────────────────────────────────
  const affirmations = [
    "You are fully capable of doing this. Break it down to 1 minute.",
    "One small physical action is better than a perfect layout plan.",
    "Your focus is your sovereign power. Protect it right now.",
    "Action builds dopamine. Clarity follows the work.",
    "Progress is compounding. Breathe in, pick one task, start."
  ];
  const [showAffirmation, setShowAffirmation] = useState(false);
  const [randomAffirmation, setRandomAffirmation] = useState("");
  useEffect(() => {
    setRandomAffirmation(affirmations[Math.floor(Math.random() * affirmations.length)]);
  }, []);
  const handleAffirmationTap = () => {
    setShowAffirmation(!showAffirmation);
    if (!showAffirmation) {
      setRandomAffirmation(affirmations[Math.floor(Math.random() * affirmations.length)]);
    }
  };

  // ── Day horizon timeline ────────────────────────────────────────────────────
  const [timelineProgress, setTimelineProgress] = useState(0.5);
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const updateTimeline = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    setCurrentTimeStr(`${displayHour}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`);
    const currentHourFloat = hour + minute / 60;
    const adjustedHour = hour < 7 ? currentHourFloat + 24 : currentHourFloat;
    setTimelineProgress(Math.max(0, Math.min(1, (adjustedHour - 7) / (26 - 7))));
  };
  useEffect(() => {
    updateTimeline();
    const interval = setInterval(updateTimeline, 60000);
    return () => clearInterval(interval);
  }, []);

  // ── Stuck rescue modal ──────────────────────────────────────────────────────
  const [showRescue, setShowRescue] = useState(false);
  const [rescueStepIndex, setRescueStepIndex] = useState(0);
  const rescueSteps = [
    "Take one deep breath. Closed eyes. Breathe in for 4, hold for 4, out for 4.",
    "What is the absolute, laughably smallest first step? Writing a single sentence counts.",
    "Close all browser tabs that aren't this single task right now.",
    "Commit to doing this tiny action for just 2 minutes. If you want to stop then, you can."
  ];
  const handleNextRescueStep = () => {
    if (rescueStepIndex < rescueSteps.length - 1) {
      setRescueStepIndex(rescueStepIndex + 1);
    } else {
      setShowRescue(false);
      setRescueStepIndex(0);
    }
  };

  // ── Brain dump ──────────────────────────────────────────────────────────────
  const [brainDumpText, setBrainDumpText] = useState("");
  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;
    const hour = new Date().getHours();
    if (config.eveningGuardWindowActive && hour >= 20) {
      alert("Evening Guard is ACTIVE: New tasks cannot be added after 8:00 PM. Go rest! 🌙");
      return;
    }
    const text = brainDumpText.trim();
    const lower = text.toLowerCase();
    let horizon = "today";
    let category = "Personal";
    if (/\bthis week\b|\bweek\b/.test(lower)) horizon = "week";
    else if (/\bthis month\b|\bmonth\b/.test(lower)) horizon = "month";
    else if (/\bquarter\b|\bq[1-4]\b/.test(lower)) horizon = "quarter";
    else if (/\b6 months?\b|\bhalf.?year\b/.test(lower)) horizon = "halfyear";
    if (/\bwork\b|\boffice\b|\bmeet(?:ing)?\b|\bclient\b|\bproject\b/.test(lower)) category = "Work";
    else if (/\bcareer\b|\bresume\b|\bjob\b|\binterview\b|\blinkedin\b/.test(lower)) category = "Career";
    else if (/\bhealth\b|\bworkout\b|\bexercise\b|\bwalk\b|\bgym\b|\bsleep\b|\bmeditat\b/.test(lower)) category = "Health";
    const freshTask = {
      id: Date.now(),
      userId: payload.userId || payload.config?.userId || "",
      uuid: crypto.randomUUID(),
      title: text,
      concreteStep: "Do first tiny step",
      horizonLevel: horizon,
      priority: "P3",
      category,
      timeEstimateMinutes: 25,
      deadlineTimestamp: null,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex: tasks.filter(t => t.horizonLevel === horizon && !t.isDeleted).length,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: Date.now()
    };
    savePayload({ ...payload, tasks: [...tasks, freshTask] });
    setBrainDumpText("");
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const incrementContribution = (arr, dateStr) => {
    const idx = arr.findIndex(c => c.dateString === dateStr);
    const compositeKey = `${payload.userId}_${dateStr}`;
    if (idx === -1) {
      arr.push({ compositeKey, userId: payload.userId, dateString: dateStr, count: 1, lastUpdated: Date.now() });
    } else {
      arr[idx] = { ...arr[idx], count: arr[idx].count + 1, lastUpdated: Date.now() };
    }
    return arr;
  };

  // ── Undo delete ─────────────────────────────────────────────────────────────
  const [undoTask, setUndoTask] = useState(null);
  const undoTimeoutRef = useRef(null);

  const handleDeleteTask = (task) => {
    const updatedTasks = tasks.map(t =>
      t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t
    );
    savePayload({ ...payload, tasks: updatedTasks });
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoTask(task);
    undoTimeoutRef.current = setTimeout(() => setUndoTask(null), 5000);
  };

  const handleUndoDelete = () => {
    if (!undoTask) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    const updatedTasks = tasks.map(t =>
      t.uuid === undoTask.uuid ? { ...t, isDeleted: false, lastUpdated: Date.now() } : t
    );
    savePayload({ ...payload, tasks: updatedTasks });
    setUndoTask(null);
  };

  // ── Task action handlers ────────────────────────────────────────────────────
  const handleToggleComplete = (task) => {
    const todayDateStr = getTodayDateString();
    const isCompleted = !task.isCompleted;
    const updatedTasks = tasks.map(t =>
      t.uuid === task.uuid
        ? { ...t, isCompleted, isNowFocus: false, dateCompletedString: isCompleted ? todayDateStr : null, lastUpdated: Date.now() }
        : t
    );
    let nextXp = Number(config.totalXp) || 0;
    let nextContributions = [...contributions];
    if (isCompleted) {
      nextXp += 100;
      nextContributions = incrementContribution(nextContributions, todayDateStr);
    } else {
      nextXp = Math.max(0, nextXp - 100);
      const idx = nextContributions.findIndex(c => c.dateString === todayDateStr);
      if (idx !== -1 && nextContributions[idx].count > 0) {
        nextContributions[idx] = { ...nextContributions[idx], count: nextContributions[idx].count - 1, lastUpdated: Date.now() };
      }
    }
    savePayload({ ...payload, tasks: updatedTasks, config: { ...config, totalXp: nextXp, lastUpdated: Date.now() }, contributions: nextContributions });
  };

  // Clicking the pin on an already-pinned task unpins it (toggle behaviour)
  const handlePinTask = (task) => {
    const now = Date.now();
    const isUnpinning = task.isNowFocus;
    const updatedTasks = tasks.map(t => {
      if (isUnpinning) {
        if (t.uuid !== task.uuid) return t;
        return { ...t, isNowFocus: false, lastUpdated: now };
      }
      const newFocus = t.uuid === task.uuid;
      if (t.isNowFocus === newFocus) return t;
      return { ...t, isNowFocus: newFocus, lastUpdated: now };
    });
    savePayload({ ...payload, tasks: updatedTasks });
  };

  const handlePomodoroCompletion = () => {
    const todayDateStr = getTodayDateString();
    if (activeTask) {
      const didFinish = window.confirm(
        `⏱️ Focus block complete!\n\nDid you fully finish:\n"${activeTask.title}"?\n\nOK = Mark task done (+120 XP)\nCancel = Keep task active (+50 XP focus reward)`
      );
      if (didFinish) {
        const updatedTasks = tasks.map(t =>
          t.uuid === activeTask.uuid
            ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: todayDateStr, lastUpdated: Date.now() }
            : t
        );
        savePayload({ ...payload, tasks: updatedTasks, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 120, lastUpdated: Date.now() }, contributions: incrementContribution([...contributions], todayDateStr) });
      } else {
        savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() } });
      }
    } else {
      savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() } });
    }
  };

  const handleEnergyToggle = () => {
    savePayload({ ...payload, config: { ...config, isLowEnergyMode: !config.isLowEnergyMode, lastUpdated: Date.now() } });
  };

  // ── Computed values ─────────────────────────────────────────────────────────
  const currentXp = Number(config.totalXp) || 0;
  const levelNum = Math.floor(currentXp / 200) + 1;
  const xpInLevel = currentXp % 200;
  const levelProgress = (xpInLevel / 200) * 100;
  const levelTitle =
    levelNum === 1 ? "Mindful Catalyst (L1)" :
    levelNum === 2 ? "Inertia Crusher (L2)" :
    levelNum === 3 ? "Deep Flow Initiate (L3)" :
    levelNum === 4 ? "Strategic Executer (L4)" :
    "Master of Loci (L5+)";

  const todayTasksAll = tasks.filter(t => t.horizonLevel === "today" && !t.isDeleted && !t.isParked);
  const todayTasksFiltered = config.isLowEnergyMode
    ? todayTasksAll.filter(t => t.priority === "P4")
    : todayTasksAll;
  const remainingTasks = todayTasksFiltered
    .filter(t => !t.isCompleted)
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.orderIndex - b.orderIndex);
  const completedTasks = todayTasksFiltered.filter(t => t.isCompleted);

  // ── 7-day streak grid ──────────────────────────────────────────────────────
  const getBentoDays = () => {
    const days = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const past = new Date(d);
      past.setDate(d.getDate() - i);
      const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
      const contr = contributions.find(c => c.dateString === dateStr);
      days.push({ dateStr, label: past.toLocaleDateString("en-US", { weekday: "short" }).substring(0, 2), count: contr ? contr.count : 0 });
    }
    return days;
  };
  const bentoDays = getBentoDays();

  // ── Timer SVG ───────────────────────────────────────────────────────────────
  const progressRatio = timerMaxSeconds > 0 ? timerSecondsLeft / timerMaxSeconds : 0;
  const strokeDashoffset = 439.8 * (1 - progressRatio);
  const formatTimerMinutes = Math.floor(timerSecondsLeft / 60);
  const formatTimerSeconds = String(timerSecondsLeft % 60).padStart(2, "0");

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* 1 ── Day Horizon Timeline */}
      <section className="timeline-card">
        <div className="timeline-header">
          <div className="timeline-title"><span>⏰</span> Day Horizon</div>
          <span className="timeline-clock">{currentTimeStr}</span>
        </div>
        <div className="timeline-progress-track">
          <div className="timeline-labels">
            <span className="timeline-label">7 am</span>
            <span className="timeline-label">1 pm</span>
            <span className="timeline-label">7 pm</span>
            <span className="timeline-label">2 am</span>
          </div>
          <div className="timeline-progress-fill" style={{ width: `${timelineProgress * 100}%` }}></div>
        </div>
        <div className="timeline-slots">
          <div className="timeline-slot">
            <span className="slot-label">Current Block</span>
            <span className="slot-task">{activeTask ? activeTask.title : "No active focus"}</span>
          </div>
          <div className="timeline-slot" style={{ borderLeft: "1px solid var(--border)", paddingLeft: "12px" }}>
            <span className="slot-label">Upcoming Block</span>
            <span className="slot-task">
              {remainingTasks.find(t => !t.isNowFocus)?.title || "All done for today ✓"}
            </span>
          </div>
        </div>
      </section>

      {/* 2 ── Dopamine Affirmation */}
      <div className="affirmation-banner" onClick={handleAffirmationTap}>
        <span style={{ fontSize: "14px" }}>💖</span>
        <span className="affirmation-text">
          {showAffirmation ? randomAffirmation : "Tap for your daily Dopamine Affirmation..."}
        </span>
      </div>

      {/* 3 ── Today's Focus Commits (primary section) */}
      <section className="tasks-section" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="section-header">
          <h2 className="section-title">
            Today's Focus Commits
            {config.isLowEnergyMode && (
              <span style={{ color: "var(--warning)", fontSize: "11px", fontWeight: "700", marginLeft: "8px" }}>
                ⚡ LOW ENERGY
              </span>
            )}
          </h2>
          <div className="section-header-right" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              className="stuck-btn"
              onClick={handleEnergyToggle}
              title="Toggle Low Energy mode — shows only easy P4 quick wins"
              style={{
                background: config.isLowEnergyMode ? "var(--success)" : "var(--bg-secondary)",
                color: config.isLowEnergyMode ? "#fff" : "var(--text-secondary)"
              }}
            >
              🔋 Low Energy
            </button>
            <span className="section-count-badge">
              {completedTasks.length}/{todayTasksFiltered.length}
            </span>
          </div>
        </div>

        <div className="tasks-list">
          {/* Case 1: No tasks at all today */}
          {todayTasksAll.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 10px", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: "600" }}>No tasks for today.</p>
              <p style={{ fontSize: "12px", marginTop: "6px", lineHeight: "1.5" }}>
                Pull one from your Roadmap, use the Brain Dump below, or tap + to add a commit.
              </p>
            </div>
          )}

          {/* Case 2: Low Energy is ON but no P4 tasks exist */}
          {todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && config.isLowEnergyMode && (
            <div style={{ textAlign: "center", padding: "24px 10px", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: "600" }}>No easy wins available right now.</p>
              <p style={{ fontSize: "12px", marginTop: "6px", lineHeight: "1.5" }}>
                All your tasks need more energy today. Try <strong>Bad Day Reset</strong> on the Coach tab to park them, or turn off Low Energy mode above.
              </p>
            </div>
          )}

          {/* Case 3: Normal task list */}
          {todayTasksFiltered.length > 0 && (
            <>
              {remainingTasks.map(task => (
                <TaskRow
                  key={task.uuid}
                  task={task}
                  onToggleComplete={handleToggleComplete}
                  onPin={handlePinTask}
                  onDelete={handleDeleteTask}
                />
              ))}
              {completedTasks.length > 0 && (
                <>
                  <div className="completed-section-title">Completed Commits</div>
                  {completedTasks.map(task => (
                    <TaskRow
                      key={task.uuid}
                      task={task}
                      onToggleComplete={handleToggleComplete}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* 4 ── Active Focus Block — only visible when a task is pinned */}
      {activeTask && (
        <section className="card focus-card">
          <div className="focus-top-bar">
            <div className="focus-live-indicator">
              <div className="live-dot"></div>
              ACTIVE FOCUS NOW
            </div>
            <button className="stuck-btn" onClick={() => setShowRescue(true)}>
              Stuck?
            </button>
          </div>

          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <h3 className="focus-title">{activeTask.title}</h3>
            <div className="step-badge">
              <span>⚡</span> First small step: {activeTask.concreteStep}
            </div>

            <div className="timer-circle-container">
              <svg className="timer-svg" viewBox="0 0 160 160">
                <circle className="timer-ring-bg" cx="80" cy="80" r="70" strokeWidth="8" />
                <circle
                  className="timer-ring-progress"
                  cx="80" cy="80" r="70" strokeWidth="8"
                  style={{ strokeDashoffset }}
                />
              </svg>
              <div className="timer-text-container">
                <span className="timer-time">{formatTimerMinutes}:{formatTimerSeconds}</span>
                <span className="timer-est">EST: {activeTask.timeEstimateMinutes} MIN</span>
              </div>
            </div>

            <div className="timer-controls">
              <button
                className="control-btn control-btn-play"
                onClick={() => setIsTimerRunning(!isTimerRunning)}
              >
                {isTimerRunning ? "⏸" : "▶"}
              </button>
              <button
                className="control-btn control-btn-done"
                onClick={() => handleToggleComplete(activeTask)}
              >
                ✓
              </button>
            </div>
          </div>

          <div className="focus-coach-divider"></div>
          <p className="coach-statement">
            "{config.intentionMessage}" — {config.mentorName || "Marcus Aurelius"}
          </p>
        </section>
      )}

      {/* 5 ── Brain Dump Quick Capture */}
      <section className="braindump-card">
        <div className="braindump-header">
          <span>📝</span> Brain Dump — Quick Capture
        </div>
        <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
          <input
            type="text"
            className="braindump-input"
            placeholder="Anything on your mind — 'workout today', 'report this week'..."
            value={brainDumpText}
            onChange={e => setBrainDumpText(e.target.value)}
          />
          <button type="submit" className="braindump-submit">➔</button>
        </form>
      </section>

      {/* 6 ── 7-Day Completion Streak Grid */}
      <section className="bento-card">
        <h3 className="bento-title">📊 7-Day Completion Streak</h3>
        <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "10px" }}>
          Each cell = tasks completed that day. Darker = more done. Track your consistency here.
        </p>
        <div className="bento-grid">
          {bentoDays.map(day => {
            const levelClass =
              day.count === 0 ? "" :
              day.count === 1 ? "active-lvl-1" :
              day.count === 2 ? "active-lvl-2" :
              day.count === 3 ? "active-lvl-3" : "active-lvl-4";
            return (
              <div
                key={day.dateStr}
                className={`bento-cell ${levelClass}`}
                title={`${day.count} task${day.count === 1 ? "" : "s"} on ${day.dateStr}`}
              >
                <span className="bento-cell-date">{day.label}</span>
                {day.count > 0 && <span style={{ fontSize: "9px", fontWeight: "700", marginTop: "2px" }}>{day.count}</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* 7 ── XP Progress (at bottom — secondary info) */}
      <section className="card stats-header-card">
        <div className="stats-row">
          <div className="stats-header-info">
            <h2 className="level-title">{levelTitle}</h2>
            <span className="xp-label">{xpInLevel}/200 XP to next level</span>
          </div>
          <div className="commit-badge" style={{ color: "var(--accent)", background: "var(--accent-ring)" }}>
            {todayTasksFiltered.length > 0
              ? `${Math.floor((completedTasks.length / todayTasksFiltered.length) * 100)}% Done`
              : "0% Done"}
          </div>
        </div>
        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${levelProgress}%` }}></div>
        </div>
        <div className="metrics-row">
          <div className="metric-box">
            <div className="metric-circle" style={{ background: "var(--accent-ring)", color: "var(--accent)" }}>⚡</div>
            <div className="metric-content">
              <span className="metric-name">XP Balance</span>
              <span className="metric-val">{currentXp} XP</span>
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-circle" style={{ background: "var(--p2-bg)", color: "var(--p2-text)" }}>🔥</div>
            <div className="metric-content">
              <span className="metric-name">Streak</span>
              <span className="metric-val">{config.visitStreakCount || 1} Days</span>
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-circle" style={{ background: "rgba(46, 125, 82, 0.12)", color: "var(--success)" }}>✓</div>
            <div className="metric-content">
              <span className="metric-name">Today</span>
              <span className="metric-val">{completedTasks.length}/{todayTasksFiltered.length}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Undo Delete Toast (5-second window) */}
      {undoTask && (
        <div style={{
          position: "fixed",
          bottom: "76px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          zIndex: 200,
          fontSize: "12.5px",
          whiteSpace: "nowrap",
          maxWidth: "90vw"
        }}>
          <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
            "{undoTask.title.length > 28 ? undoTask.title.substring(0, 28) + "…" : undoTask.title}" deleted
          </span>
          <button
            onClick={handleUndoDelete}
            style={{
              background: "var(--accent)",
              color: "var(--btn-text, #fff)",
              border: "none",
              borderRadius: "12px",
              padding: "5px 14px",
              fontSize: "12px",
              fontWeight: "700",
              cursor: "pointer",
              flexShrink: 0
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* ── Stuck Rescue Modal */}
      {showRescue && (
        <div className="rescue-overlay" onClick={() => setShowRescue(false)}>
          <div className="rescue-card card" onClick={e => e.stopPropagation()}>
            <span className="rescue-icon">⚠️</span>
            <h3 className="rescue-title">Executive Freeze Rescue Pod</h3>
            <span className="rescue-step-badge">Step {rescueStepIndex + 1} of {rescueSteps.length}</span>
            <p className="rescue-step-text">{rescueSteps[rescueStepIndex]}</p>
            <button className="btn" onClick={handleNextRescueStep} style={{ width: "100%", marginTop: "10px" }}>
              {rescueStepIndex === rescueSteps.length - 1 ? "I am ready to move the needle!" : "Next Step"}
            </button>
            <button className="btn btn-cancel" onClick={() => setShowRescue(false)} style={{ width: "100%" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
