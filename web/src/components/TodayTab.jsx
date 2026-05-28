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
      const taskSecs = activeTask.timeEstimateMinutes * 60;
      setTimerMaxSeconds(taskSecs);
      // Reset timer countdown if not already running
      if (!isTimerRunning) {
        setTimerSecondsLeft(taskSecs);
      }
    } else {
      const defaultSecs = config.pomodoroDurationMinutes * 60;
      setTimerMaxSeconds(defaultSecs);
      if (!isTimerRunning) {
        setTimerSecondsLeft(defaultSecs);
      }
    }
  }, [activeTask?.uuid, config.pomodoroDurationMinutes]);

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

  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;

    // Evening Guard window block logic
    const now = new Date();
    const hour = now.getHours();
    if (config.eveningGuardWindowActive && hour >= 20) {
      alert("Evening Guard is ACTIVE: To protect your evening recovery and sleep, new tasks cannot be added after 8:00 PM. Go rest! 🌙");
      return;
    }

    const todayTasksCount = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted).length;

    const freshTask = {
      id: Date.now(),
      userId: payload.userId,
      uuid: crypto.randomUUID(),
      title: brainDumpText.trim(),
      concreteStep: "Do first tiny step",
      horizonLevel: "today",
      priority: "P3",
      category: "Personal",
      timeEstimateMinutes: 25,
      deadlineTimestamp: null,
      isCompleted: false,
      isParked: false,
      isNowFocus: false,
      orderIndex: todayTasksCount,
      dateCompletedString: null,
      isDeleted: false,
      lastUpdated: Date.now()
    };

    savePayload({
      ...payload,
      tasks: [...tasks, freshTask]
    });
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
    let nextXp = config.totalXp;
    let nextContributions = [...contributions];
    if (isCompleted) {
      nextXp += 100;
      nextContributions = incrementContribution(nextContributions, todayDateStr);
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
    // Unpin all other tasks first
    const updatedTasks = tasks.map((t) => {
      return {
        ...t,
        isNowFocus: t.uuid === task.uuid,
        lastUpdated: Date.now()
      };
    });

    savePayload({
      ...payload,
      tasks: updatedTasks
    });
  };

  const handleDeleteTask = (task) => {
    const updatedTasks = tasks.map((t) => {
      if (t.uuid === task.uuid) {
        return {
          ...t,
          isDeleted: true,
          lastUpdated: Date.now()
        };
      }
      return t;
    });

    savePayload({
      ...payload,
      tasks: updatedTasks
    });
  };

  const handlePomodoroCompletion = () => {
    if (activeTask) {
      // Complete focused task immediately + give 120 XP Pomodoro Bonus!
      const todayDateStr = getTodayDateString();
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
          totalXp: config.totalXp + 120, // 100 base + 20 pomodoro bonus
          lastUpdated: Date.now()
        },
        contributions: incrementContribution([...contributions], todayDateStr)
      });
    } else {
      // Just reward some baseline dopamine XP if no task was pinned
      savePayload({
        ...payload,
        config: {
          ...config,
          totalXp: config.totalXp + 50,
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

  // Today Statistics & level calculation rules
  const currentXp = config.totalXp || 0;
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
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.orderIndex - b.orderIndex);

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

  // Timer SVG configuration
  const progressRatio = timerSecondsLeft / timerMaxSeconds;
  const strokeDashoffset = 439.8 * (1 - progressRatio);

  const formatTimerMinutes = Math.floor(timerSecondsLeft / 60);
  const formatTimerSeconds = String(timerSecondsLeft % 60).padStart(2, "0");

  return (
    <>
      {/* 1. Statistics Row Bento block */}
      <section className="card stats-header-card">
        <div className="stats-row">
          <div className="stats-header-info">
            <h2 className="level-title">{levelTitle}</h2>
            <span className="xp-label">{xpInLevel}/200 XP to next level</span>
          </div>
          <div className="commit-badge" style={{ color: "var(--accent)", background: "var(--accent-ring)" }}>
            {todayTasksFiltered.length > 0
              ? `${Math.floor((completedTasks.length / todayTasksFiltered.length) * 100)}% Committed`
              : "0% Committed"}
          </div>
        </div>

        {/* Sleek Gradient level tracker */}
        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${levelProgress}%` }}></div>
        </div>

        {/* traditional XP, streak metrics row */}
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
              <span className="metric-name">Task Ratio</span>
              <span className="metric-val">{completedTasks.length}/{todayTasksFiltered.length}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Dopamine Affirmation Banner */}
      <div className="affirmation-banner" onClick={handleAffirmationTap}>
        <span style={{ fontSize: "14px" }}>💖</span>
        <span className="affirmation-text">
          {showAffirmation ? randomAffirmation : "Tap here for your daily Dopamine Affirmation..."}
        </span>
      </div>

      {/* 3. Brain Dump Instant Capture */}
      <section className="braindump-card">
        <div className="braindump-header">
          <span>📝</span> Instant Brain Dump & Quick Capture
        </div>
        <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
          <input
            type="text"
            className="braindump-input"
            placeholder="Dump anything — 'workout today', 'read code this week'..."
            value={brainDumpText}
            onChange={(e) => setBrainDumpText(e.target.value)}
          />
          <button type="submit" className="braindump-submit">➔</button>
        </form>
      </section>

      {/* 4. Active Focus Card Hero */}
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

        {activeTask ? (
          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <h3 className="focus-title">{activeTask.title}</h3>
            <div className="step-badge">
              <span>⚡</span> First small step: {activeTask.concreteStep}
            </div>

            {/* Circular Timer Ring */}
            <div className="timer-circle-container">
              <svg className="timer-svg" viewBox="0 0 160 160">
                <circle className="timer-ring-bg" cx="80" cy="80" r="70" strokeWidth="8" />
                <circle
                  className="timer-ring-progress"
                  cx="80"
                  cy="80"
                  r="70"
                  strokeWidth="8"
                  style={{ strokeDashoffset }}
                />
              </svg>
              <div className="timer-text-container">
                <span className="timer-time">
                  {formatTimerMinutes}:{formatTimerSeconds}
                </span>
                <span className="timer-est">EST: {activeTask.timeEstimateMinutes} MIN</span>
              </div>
            </div>

            {/* Play, check actions */}
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
        ) : (
          <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "14px", fontWeight: "600" }}>No focus commit running.</p>
            <p style={{ fontSize: "12px", marginTop: "4px" }}>
              Pick one tiny action below and click the pin icon (📌) to activate Focus Mode!
            </p>
          </div>
        )}

        <div className="focus-coach-divider"></div>
        <p className="coach-statement">
          "{config.intentionMessage}" — {config.mentorName || "Marcus Aurelius"}
        </p>
      </section>

      {/* 5. Day Horizon timeline progress bar */}
      <section className="timeline-card">
        <div className="timeline-header">
          <div className="timeline-title">
            <span>⏰</span> Day Horizon Timeline Progress
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

        <div className="timeline-slots">
          <div className="timeline-slot">
            <span className="slot-label">Current Block</span>
            <span className="slot-task">{activeTask ? activeTask.title : "No active focus"}</span>
          </div>
          <div className="timeline-slot" style={{ borderLeft: "1px solid var(--border)", paddingLeft: "12px" }}>
            <span className="slot-label">Upcoming Block</span>
            <span className="slot-task">
              {remainingTasks.find((t) => !t.isNowFocus)?.title || "Day commitments complete ✓"}
            </span>
          </div>
        </div>
      </section>

      {/* 6. Today Commitments Stack */}
      <section className="tasks-section" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="section-header">
          <h2 className="section-title">
            Today's Focus Commits
            {config.isLowEnergyMode && " (Low Energy)"}
          </h2>
          <div className="section-header-right" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              className="stuck-btn"
              onClick={handleEnergyToggle}
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
          {todayTasksFiltered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 10px", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px" }}>
                0 focused commits today. Enter a brain dump or click the floating action button to commit.
              </p>
            </div>
          ) : (
            <>
              {/* Remaining Tasks */}
              {remainingTasks.map((task) => (
                <TaskRow
                  key={task.uuid}
                  task={task}
                  onToggleComplete={handleToggleComplete}
                  onPin={handlePinTask}
                  onDelete={handleDeleteTask}
                />
              ))}

              {/* Completed Section Title */}
              {completedTasks.length > 0 && (
                <>
                  <div className="completed-section-title">Completed Commits</div>
                  {completedTasks.map((task) => (
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

      {/* 7. Streak Bento contribution map */}
      <section className="bento-card">
        <h3 className="bento-title">🏆 ADHD Consistency Streaks Grid</h3>
        <div className="bento-grid">
          {bentoDays.map((day) => {
            const levelClass =
              day.count === 0 ? "" :
              day.count === 1 ? "active-lvl-1" :
              day.count === 2 ? "active-lvl-2" :
              day.count === 3 ? "active-lvl-3" :
              "active-lvl-4";

            return (
              <div
                key={day.dateStr}
                className={`bento-cell ${levelClass}`}
                data-tooltip={`${day.count} commit${day.count === 1 ? "" : "s"} on ${day.dateStr}`}
              >
                <span className="bento-cell-date">{day.label}</span>
                {day.count > 0 && <span style={{ fontSize: "9px", fontWeight: "700", marginTop: "2px" }}>{day.count}</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Stuck Rescue Modal Window Overlay */}
      {showRescue && (
        <div className="rescue-overlay" onClick={() => setShowRescue(false)}>
          <div className="rescue-card card" onClick={(e) => e.stopPropagation()}>
            <span className="rescue-icon">⚠️</span>
            <h3 className="rescue-title">Executive Freeze Rescue Pod</h3>
            <span className="rescue-step-badge">
              Step {rescueStepIndex + 1} of {rescueSteps.length}
            </span>
            <p className="rescue-step-text">{rescueSteps[rescueStepIndex]}</p>
            <button className="btn" onClick={handleNextRescueStep} style={{ width: "100%", marginTop: "10px" }}>
              {rescueStepIndex === rescueSteps.length - 1
                ? "I am ready to move the needle!"
                : "Next Step"}
            </button>
            <button className="btn btn-cancel" onClick={() => setShowRescue(false)} style={{ width: "100%" }}>
              Close pod
            </button>
          </div>
        </div>
      )}
    </>
  );
}
