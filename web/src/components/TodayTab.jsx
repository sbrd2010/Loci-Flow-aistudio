import React, { useState, useEffect, useRef } from "react";
import TaskRow from "./TaskRow";

export default function TodayTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  // Local state for pomodoro timer
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const timerIntervalRef = useRef(null);

  // Active focus task (if any)
  const activeTask = tasks.find((t) => t.isNowFocus && !t.isDeleted && !t.isCompleted);

  // Synchronize timer duration if active task estimate changes or is pinned
  useEffect(() => {
    if (activeTask) {
      // Fix #16: guard against NaN/0 from missing timeEstimateMinutes
      const rawMins = Number(activeTask.timeEstimateMinutes);
      const taskSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(taskSecs);
      // Reset timer countdown if not already running
      if (!isTimerRunning) {
        setTimerSecondsLeft(taskSecs);
      }
    } else {
      const rawMins = Number(config.pomodoroDurationMinutes);
      const defaultSecs = (rawMins > 0 ? rawMins : 25) * 60;
      setTimerMaxSeconds(defaultSecs);
      if (!isTimerRunning) {
        setTimerSecondsLeft(defaultSecs);
      }
    }
  }, [activeTask?.uuid, activeTask?.timeEstimateMinutes, config.pomodoroDurationMinutes]);

  // Pomodoro countdown timer logic
  useEffect(() => {
    if (isTimerRunning) {
      timerIntervalRef.current = setInterval(() => {
        setTimerSecondsLeft((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isTimerRunning]);

  // Handle Pomodoro Timer Completion Side-Effect
  useEffect(() => {
    if (isTimerRunning && timerSecondsLeft === 0) {
      setIsTimerRunning(false);
      // Fix #17: Pomodoro finished — alert user but do NOT auto-complete the task
      // The user may have stopped the focus block without finishing the actual task.
      handlePomodoroCompletion();
    }
  }, [timerSecondsLeft, isTimerRunning]);

  // Dopamine Affirmations state
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

  // Timeline progress calculations
  const [timelineProgress, setTimelineProgress] = useState(0.5);
  const [currentTimeStr, setCurrentTimeStr] = useState("");

  const updateTimeline = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Formatting display clock
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    const amPmStr = hour >= 12 ? "PM" : "AM";
    setCurrentTimeStr(`${displayHour}:${String(minute).padStart(2, "0")} ${amPmStr}`);

    // Day boundary progress: 7 AM to 2 AM next day (19 hours total)
    const startHour = 7;
    const endHour = 26; // 2 AM next day is 26 hours from 0

    const currentHourFloat = hour + minute / 60;
    const adjustedHour = hour < 7 ? currentHourFloat + 24 : currentHourFloat;

    const progress = (adjustedHour - startHour) / (endHour - startHour);
    setTimelineProgress(Math.max(0, Math.min(1, progress)));
  };

  useEffect(() => {
    updateTimeline();
    const interval = setInterval(updateTimeline, 60000);
    return () => clearInterval(interval);
  }, []);

  // Stuck Rescue pod modal states
  const [showRescue, setShowRescue] = useState(false);
  const [rescueStepIndex, setRescueStepIndex] = useState(0);
  const rescueSteps = [
    "Take one deep breath. Closed eyes. Breathe in for 4, hold for 4, out for 4.",
    "What is the absolute, laughably smallest first step? Writing a single sentence counts as a step.",
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

  // Brain Dump capture field
  const [brainDumpText, setBrainDumpText] = useState("");

  // Inline task editing
  const [editingTaskUuid, setEditingTaskUuid] = useState(null);
  const [editFields, setEditFields] = useState({ title: "", concreteStep: "", priority: "P2" });

  // Collapsible panels
  const [streakOpen, setStreakOpen] = useState(false);
  const [xpOpen, setXpOpen] = useState(false);

  // Undo delete
  const [undoTask, setUndoTask] = useState(null);
  const undoTimeoutRef = useRef(null);

  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;
    const newItem = { id: crypto.randomUUID(), text: brainDumpText.trim(), createdAt: Date.now() };
    savePayload({ ...payload, brainDump: [...(payload.brainDump || []), newItem] });
    setBrainDumpText("");
  };

  // Helper: Format date as YYYY-MM-DD
  const getTodayDateString = () => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
  };

  // Update contribution count inside the payload
  const incrementContribution = (newContributions, dateStr) => {
    const index = newContributions.findIndex((c) => c.dateString === dateStr);
    const compositeKey = `${payload.userId}_${dateStr}`;
    if (index === -1) {
      newContributions.push({
        compositeKey,
        userId: payload.userId,
        dateString: dateStr,
        count: 1,
        lastUpdated: Date.now()
      });
    } else {
      newContributions[index] = {
        ...newContributions[index],
        count: newContributions[index].count + 1,
        lastUpdated: Date.now()
      };
    }
    return newContributions;
  };

  // Handlers for Task Actions
  const handleToggleComplete = (task) => {
    const todayDateStr = getTodayDateString();
    const isCompleted = !task.isCompleted;

    // 1. Update task completed markers
    const updatedTasks = tasks.map((t) => {
      if (t.uuid === task.uuid) {
        return {
          ...t,
          isCompleted,
          isNowFocus: false,
          dateCompletedString: isCompleted ? todayDateStr : null,
          lastUpdated: Date.now()
        };
      }
      return t;
    });

    // 2. Adjust XP balance and Streak contributions
    let nextXp = Number(config.totalXp) || 0;
    let nextContributions = [...contributions];
    if (isCompleted) {
      // Task checked: +100 XP and add contribution
      nextXp += 100;
      nextContributions = incrementContribution(nextContributions, todayDateStr);
    } else {
      // Task unchecked: deduct 100 XP (floor 0) and reverse contribution
      nextXp = Math.max(0, nextXp - 100);
      // Decrement contribution count if present
      const contrIdx = nextContributions.findIndex((c) => c.dateString === todayDateStr);
      if (contrIdx !== -1 && nextContributions[contrIdx].count > 0) {
        nextContributions[contrIdx] = {
          ...nextContributions[contrIdx],
          count: nextContributions[contrIdx].count - 1,
          lastUpdated: Date.now()
        };
      }
    }

    savePayload({
      ...payload,
      tasks: updatedTasks,
      config: {
        ...config,
        totalXp: nextXp,
        lastUpdated: Date.now()
      },
      contributions: nextContributions
    });
  };

  const handlePinTask = (task) => {
    const now = Date.now();
    const updatedTasks = tasks.map((t) => {
      const newFocus = t.uuid === task.uuid;
      if (t.isNowFocus === newFocus) return t;
      return { ...t, isNowFocus: newFocus, lastUpdated: now };
    });

    savePayload({
      ...payload,
      tasks: updatedTasks
    });
  };

  const handleDeleteTask = (task) => {
    const updatedTasks = tasks.map((t) =>
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
    const updatedTasks = tasks.map((t) =>
      t.uuid === undoTask.uuid ? { ...t, isDeleted: false, lastUpdated: Date.now() } : t
    );
    savePayload({ ...payload, tasks: updatedTasks });
    setUndoTask(null);
  };

  const handlePomodoroCompletion = () => {
    if (activeTask) {
      const todayDateStr = getTodayDateString();

      // Fix #17: Don't silently auto-complete the task — ask the user first
      const didFinish = window.confirm(
        `⏱️ Focus block complete!\n\nDid you fully finish:\n"${activeTask.title}"?\n\nOK = Mark task done (+120 XP)\nCancel = Keep task active (+50 XP focus reward)`
      );

      if (didFinish) {
        // User confirms task is done — complete it and give full bonus XP
        const updatedTasks = tasks.map((t) => {
          if (t.uuid === activeTask.uuid) {
            return {
              ...t,
              isCompleted: true,
              isNowFocus: false,
              dateCompletedString: todayDateStr,
              lastUpdated: Date.now()
            };
          }
          return t;
        });

        savePayload({
          ...payload,
          tasks: updatedTasks,
          config: {
            ...config,
            totalXp: (Number(config.totalXp) || 0) + 120, // 100 base + 20 pomodoro bonus
            lastUpdated: Date.now()
          },
          contributions: incrementContribution([...contributions], todayDateStr)
        });
      } else {
        // User says task not done — reward focus XP only, keep task active
        savePayload({
          ...payload,
          config: {
            ...config,
            totalXp: (Number(config.totalXp) || 0) + 50,
            lastUpdated: Date.now()
          }
        });
      }
    } else {
      // No active task — just reward baseline focus XP
      savePayload({
        ...payload,
        config: {
          ...config,
          totalXp: (Number(config.totalXp) || 0) + 50,
          lastUpdated: Date.now()
        }
      });
    }
  };

  const handleEnergyToggle = () => {
    savePayload({
      ...payload,
      config: {
        ...config,
        isLowEnergyMode: !config.isLowEnergyMode,
        lastUpdated: Date.now()
      }
    });
  };

  const handleStartEdit = (task) => {
    setEditingTaskUuid(task.uuid);
    setEditFields({ title: task.title, concreteStep: task.concreteStep || "", priority: task.priority });
  };
  const handleCancelEdit = () => setEditingTaskUuid(null);
  const handleSaveEdit = () => {
    if (!editFields.title.trim()) return;
    const updatedTasks = tasks.map(t =>
      t.uuid === editingTaskUuid
        ? { ...t, title: editFields.title.trim(), concreteStep: editFields.concreteStep.trim(), priority: editFields.priority, lastUpdated: Date.now() }
        : t
    );
    savePayload({ ...payload, tasks: updatedTasks });
    setEditingTaskUuid(null);
  };

  const handleMoveTask = (task, direction) => {
    const list = [...remainingTasks];
    const idx = list.findIndex(t => t.uuid === task.uuid);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const aIdx = list[idx].orderIndex ?? idx;
    const bIdx = list[swapIdx].orderIndex ?? swapIdx;
    const updatedTasks = tasks.map(t => {
      if (t.uuid === list[idx].uuid) return { ...t, orderIndex: bIdx, lastUpdated: Date.now() };
      if (t.uuid === list[swapIdx].uuid) return { ...t, orderIndex: aIdx, lastUpdated: Date.now() };
      return t;
    });
    savePayload({ ...payload, tasks: updatedTasks });
  };

  // Today Statistics & level calculation rules
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

  // Filter today tasks list based on active Level Energy Filters (excluding parked tasks)
  const todayTasksAll = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isParked);
  const todayTasksFiltered = config.isLowEnergyMode
    ? todayTasksAll.filter((t) => t.priority === "P4")
    : todayTasksAll;

  const remainingTasks = todayTasksFiltered
    .filter((t) => !t.isCompleted)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  const completedTasks = todayTasksFiltered.filter((t) => t.isCompleted);

  // Bento contribution grid calculation (previous 7 days)
  const getBentoDays = () => {
    const days = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const past = new Date(d);
      past.setDate(d.getDate() - i);
      const month = String(past.getMonth() + 1).padStart(2, "0");
      const day = String(past.getDate()).padStart(2, "0");
      const dateStr = `${past.getFullYear()}-${month}-${day}`;

      const contr = contributions.find((c) => c.dateString === dateStr);
      days.push({
        dateStr,
        label: past.toLocaleDateString("en-US", { weekday: "short" }).substring(0, 2),
        count: contr ? contr.count : 0
      });
    }
    return days;
  };

  const bentoDays = getBentoDays();

  // Timer SVG configuration — guard against division-by-zero when timerMaxSeconds is 0
  const progressRatio = timerMaxSeconds > 0 ? timerSecondsLeft / timerMaxSeconds : 0;
  const strokeDashoffset = 439.8 * (1 - progressRatio);

  const formatTimerMinutes = Math.floor(timerSecondsLeft / 60);
  const formatTimerSeconds = String(timerSecondsLeft % 60).padStart(2, "0");

  return (
    <>
      {/* 1 ── Day Horizon Timeline */}
      <section className="timeline-card">
        <div className="timeline-header">
          <div className="timeline-title">
            <h2 className="section-title" style={{ fontSize: "15px", marginBottom: 0 }}>⏰ Day Horizon</h2>
          </div>
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
      </section>

      {/* 2 ── Dopamine Affirmation */}
      <div className="affirmation-banner" onClick={handleAffirmationTap}>
        <span style={{ fontSize: "14px" }}>💖</span>
        <span className="affirmation-text">
          {showAffirmation ? randomAffirmation : "Tap for today's motivation ✨"}
        </span>
      </div>

      {/* 3 ── Today's Focus (primary section) */}
      <section className="tasks-section" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="section-header">
          <h2 className="section-title">
            Today's Focus
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
          {todayTasksAll.length === 0 && (
            <div style={{
              textAlign: "center", padding: "24px 16px",
              background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)",
              border: "1px dashed var(--border)"
            }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🧠</div>
              <p style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "6px" }}>
                Welcome to Loci!
              </p>
              <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: "1.6", marginBottom: "14px" }}>
                Loci helps you capture tasks, prioritize them with AI, and build daily focus habits — designed for ADHD brains.
              </p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                Tap the <strong style={{ color: "var(--accent)" }}>+</strong> button below to add your first task. The AI will help you break it down.
              </p>
            </div>
          )}
          {todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && config.isLowEnergyMode && (
            <div style={{ textAlign: "center", padding: "24px 10px", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: "600" }}>No easy wins available right now.</p>
              <p style={{ fontSize: "12px", marginTop: "6px", lineHeight: "1.5" }}>
                All your tasks need more energy today. Try <strong>Bad Day Reset</strong> on the AI Coach tab, or turn off Low Energy mode.
              </p>
            </div>
          )}
          {todayTasksFiltered.length > 0 && (
            <>
              {remainingTasks.map((task, idx) => (
                editingTaskUuid === task.uuid ? (
                  <div className="task-edit-card" key={task.uuid}>
                    <input className="text-input" value={editFields.title}
                      onChange={e => setEditFields(f => ({ ...f, title: e.target.value }))}
                      placeholder="Task title" style={{ marginBottom: "8px" }} />
                    <input className="text-input" value={editFields.concreteStep}
                      onChange={e => setEditFields(f => ({ ...f, concreteStep: e.target.value }))}
                      placeholder="Micro step (optional)" style={{ marginBottom: "8px" }} />
                    <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
                      {["P1","P2","P3","P4"].map(p => (
                        <button key={p} type="button"
                          className={`priority-badge ${p.toLowerCase()}`}
                          onClick={() => setEditFields(f => ({ ...f, priority: p }))}
                          style={{ border: editFields.priority === p ? "2px solid var(--accent)" : "2px solid transparent", cursor: "pointer", padding: "4px 10px", opacity: editFields.priority === p ? 1 : 0.55 }}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button className="btn" onClick={handleSaveEdit} style={{ flex: 1 }}>Save</button>
                      <button className="btn" onClick={handleCancelEdit}
                        style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <TaskRow
                    key={task.uuid}
                    task={task}
                    onToggleComplete={handleToggleComplete}
                    onPin={handlePinTask}
                    onDelete={handleDeleteTask}
                    onEdit={handleStartEdit}
                    onMoveUp={idx > 0 ? t => handleMoveTask(t, "up") : undefined}
                    onMoveDown={idx < remainingTasks.length - 1 ? t => handleMoveTask(t, "down") : undefined}
                  />
                )
              ))}
              {completedTasks.length > 0 && (
                <>
                  <div className="completed-section-title">Completed</div>
                  {completedTasks.map(task => (
                    <TaskRow key={task.uuid} task={task}
                      onToggleComplete={handleToggleComplete}
                      onDelete={handleDeleteTask} />
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
            <button className="stuck-btn" onClick={() => setShowRescue(true)}>Stuck?</button>
          </div>
          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <h3 className="focus-title">{activeTask.title}</h3>
            <div className="step-badge">
              <span>⚡</span> First small step: {activeTask.concreteStep}
            </div>
            <div className="timer-circle-container">
              <svg className="timer-svg" viewBox="0 0 160 160">
                <circle className="timer-ring-bg" cx="80" cy="80" r="70" strokeWidth="8" />
                <circle className="timer-ring-progress" cx="80" cy="80" r="70" strokeWidth="8"
                  style={{ strokeDashoffset }} />
              </svg>
              <div className="timer-text-container">
                <span className="timer-time">{formatTimerMinutes}:{formatTimerSeconds}</span>
                <span className="timer-est">EST: {activeTask.timeEstimateMinutes} MIN</span>
              </div>
            </div>
            <div className="timer-controls">
              <button className="control-btn control-btn-play" onClick={() => setIsTimerRunning(!isTimerRunning)}>
                {isTimerRunning ? "⏸" : "▶"}
              </button>
              <button className="control-btn control-btn-done" onClick={() => handleToggleComplete(activeTask)}>✓</button>
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
        <h2 className="section-title" style={{ fontSize: "15px" }}>📝 Brain Dump</h2>
        <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
          <input type="text" className="braindump-input"
            placeholder="Anything on your mind — sort it to the Roadmap later..."
            value={brainDumpText}
            onChange={e => setBrainDumpText(e.target.value)} />
          <button type="submit" className="braindump-submit">➔</button>
        </form>
      </section>

      {/* 6+7 ── Streak + XP Stats — compact side-by-side at bottom */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>

        {/* 7-Day Streak */}
        <section className="bento-card" style={{ padding: "12px 10px" }}>
          <h3 style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            📊 7-Day Progress
          </h3>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "6px" }}>
            {bentoDays.map((day, i) => {
              const isToday = i === 6;
              const done = day.count > 0;
              return (
                <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                  <span style={{
                    fontSize: "8px", fontWeight: "700", color: isToday ? "var(--accent)" : "var(--text-muted)",
                    textTransform: "uppercase", letterSpacing: "0.04em"
                  }}>{day.label}</span>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    background: done ? (isToday ? "var(--accent)" : "var(--success, #22c55e)") : "var(--bg-secondary)",
                    border: isToday ? "2px solid var(--accent)" : "2px solid transparent",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>
                    {done && <span style={{ fontSize: "10px", fontWeight: "800", color: "#fff" }}>{day.count}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "6px", lineHeight: "1.4" }}>
            Green = tasks completed · Today is highlighted
          </p>
        </section>

        {/* XP / Level Progress */}
        <section className="card" style={{ padding: "12px 10px" }}>
          <h3 style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-secondary)", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            ⚡ XP & Level
          </h3>
          <p style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "6px" }}>Earn XP by completing tasks</p>
          <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "6px", lineHeight: "1.3" }}>
            {levelTitle}
          </div>
          <div className="progress-track" style={{ height: "5px", marginBottom: "8px" }}>
            <div className="progress-bar" style={{ width: `${levelProgress}%` }}></div>
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "3px" }}>
            <span>⚡ {currentXp} XP · {xpInLevel}/200 next</span>
            <span>🔥 {config.visitStreakCount || 1} day streak</span>
            <span>✓ {completedTasks.length}/{todayTasksFiltered.length} today</span>
          </div>
        </section>

      </div>

      {/* ── Undo Delete Toast */}
      {undoTask && (
        <div style={{
          position: "fixed", bottom: "76px", left: "50%", transform: "translateX(-50%)",
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "20px",
          padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)", zIndex: 200,
          fontSize: "12.5px", whiteSpace: "nowrap", maxWidth: "90vw"
        }}>
          <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
            "{undoTask.title.length > 28 ? undoTask.title.substring(0, 28) + "…" : undoTask.title}" deleted
          </span>
          <button onClick={handleUndoDelete}
            style={{ background: "var(--accent)", color: "var(--btn-text, #fff)", border: "none",
              borderRadius: "12px", padding: "5px 14px", fontSize: "12px", fontWeight: "700",
              cursor: "pointer", flexShrink: 0 }}>
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
