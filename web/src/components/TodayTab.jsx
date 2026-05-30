import React, { useState, useEffect, useRef } from "react";
import TaskRow from "./TaskRow";
import RescueMode from "./RescueMode";
import ConfirmDialog from "./ConfirmDialog";

export default function TodayTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  const [confirmDialog, setConfirmDialog] = useState(null);

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

  // Morning Ritual timer
  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft > 0) {
      ritualIntervalRef.current = setInterval(() => {
        setRitualSecondsLeft(prev => prev <= 1 ? 0 : prev - 1);
      }, 1000);
    } else {
      clearInterval(ritualIntervalRef.current);
    }
    return () => clearInterval(ritualIntervalRef.current);
  }, [ritualActive, ritualStepIndex, ritualSecondsLeft > 0]);

  useEffect(() => {
    if (ritualActive && ritualStepIndex >= 0 && ritualSecondsLeft === 0) {
      handleAdvanceRitualStep();
    }
  }, [ritualSecondsLeft, ritualActive, ritualStepIndex]);

  useEffect(() => {
    if (ritualDone) {
      savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 80, lastUpdated: Date.now() } });
      setRitualDone(false);
      setRitualSuccess(true);
      setTimeout(() => setRitualSuccess(false), 3500);
    }
  }, [ritualDone]);

  // Rotating quotes — change every 2 hours
  const QUOTES = [
    { quote: "Done is better than perfect.", author: "Sheryl Sandberg" },
    { quote: "Action cures fear.", author: "David J. Schwartz" },
    { quote: "Absorb what is useful.", author: "Bruce Lee" },
    { quote: "Deep work creates rare value.", author: "Cal Newport" },
    { quote: "Start before you feel ready.", author: "Marie Forleo" },
    { quote: "Clarity before speed.", author: "Anonymous" },
    { quote: "One task. Full attention.", author: "Anonymous" },
    { quote: "Progress beats perfection.", author: "Anonymous" },
    { quote: "Begin. The rest is easy.", author: "Seneca" },
    { quote: "Ship it. Learn. Improve.", author: "Anonymous" },
    { quote: "Your focus is your power.", author: "Anonymous" },
    { quote: "Do it now, not later.", author: "Anonymous" },
    { quote: "Momentum follows action.", author: "Anonymous" },
    { quote: "Execution is the strategy.", author: "Anonymous" },
    { quote: "Simplify, then execute.", author: "Steve Jobs" },
  ];
  const currentQuote = QUOTES[Math.floor(Date.now() / (2 * 3600 * 1000)) % QUOTES.length];

  // Timeline progress calculations
  const [timelineProgress, setTimelineProgress] = useState(0.5);
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [currentDateStr, setCurrentDateStr] = useState("");

  const updateTimeline = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();

    // Formatting display clock
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    const amPmStr = hour >= 12 ? "PM" : "AM";
    setCurrentTimeStr(`${displayHour}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")} ${amPmStr}`);
    setCurrentDateStr(now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));

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
    const interval = setInterval(updateTimeline, 1000);
    return () => clearInterval(interval);
  }, []);

  // Rescue Mode v2 + Quick menu
  const [rescueActive, setRescueActive] = useState(false);
  const [rescueTask, setRescueTask]     = useState(null);
  const [progressDetailOpen, setProgressDetailOpen] = useState(false);

  const openRescueMode = () => {
    const pinned = tasks.find(t => !t.isDeleted && !t.isCompleted && t.isNowFocus);
    const first  = tasks.find(t => !t.isDeleted && !t.isCompleted);
    setRescueTask(pinned || first || null);
    setRescueActive(true);
  };

  const handleBadDayReset = () => {
    setConfirmDialog({
      message: "Park all active tasks for today?\n\nYou can restore them from the AI Coach tab.",
      confirmLabel: "Park all", cancelLabel: "Cancel",
      onConfirm: () => {
        savePayload({ ...payload, tasks: tasks.map(t => (!t.isCompleted && !t.isDeleted) ? { ...t, isParked: true, isNowFocus: false } : t) });
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  // Legacy rescue pod (kept for pinned-task Stuck? button)
  const [showRescue, setShowRescue] = useState(false);
  const [rescueStepIndex, setRescueStepIndex] = useState(0);
  const rescueSteps = [
    "Take one deep breath. Breathe in for 4, hold for 4, out for 4.",
    "What is the laughably smallest first step? A single sentence counts.",
    "Close all tabs that aren't this task right now.",
    "Commit to just 2 minutes. You can stop after that."
  ];
  const handleNextRescueStep = () => {
    if (rescueStepIndex < rescueSteps.length - 1) { setRescueStepIndex(rescueStepIndex + 1); }
    else { setShowRescue(false); setRescueStepIndex(0); }
  };

  // Brain Dump capture field
  const [brainDumpText, setBrainDumpText] = useState("");

  // Inline task editing
  const [editingTaskUuid, setEditingTaskUuid] = useState(null);
  const [editFields, setEditFields] = useState({ title: "", concreteStep: "", priority: "P2" });

  // Bar chart selected day
  const [selectedDay, setSelectedDay] = useState(null);
  const [vizMode, setVizMode] = useState(() => localStorage.getItem("loci_viz") || "streak");

  // Undo delete
  const [undoTask, setUndoTask] = useState(null);
  const undoTimeoutRef = useRef(null);

  // Morning Ritual
  const [ritualActive, setRitualActive] = useState(false);
  const [ritualStepIndex, setRitualStepIndex] = useState(-1);
  const [ritualSecondsLeft, setRitualSecondsLeft] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
  const [ritualSuccess, setRitualSuccess] = useState(false);
  const ritualIntervalRef = useRef(null);

  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;
    const currentDump = payload.brainDump || [];
    if (currentDump.length >= 50) return;
    const newItem = { id: crypto.randomUUID(), text: brainDumpText.trim(), createdAt: Date.now() };
    savePayload({ ...payload, brainDump: [...currentDump, newItem] });
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
    const uid = payload.userId || payload.config?.userId || "";
    const compositeKey = `${uid}_${dateStr}`;
    if (index === -1) {
      newContributions.push({
        compositeKey,
        userId: uid,
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
      const task = activeTask;

      setConfirmDialog({
        message: `⏱️ Focus block complete!\n\nDid you fully finish:\n"${task.title}"?`,
        confirmLabel: "Done! +120 XP",
        cancelLabel: "+50 XP, keep going",
        onConfirm: () => {
          const updatedTasks = tasks.map((t) =>
            t.uuid === task.uuid
              ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: todayDateStr, lastUpdated: Date.now() }
              : t
          );
          savePayload({
            ...payload,
            tasks: updatedTasks,
            config: { ...config, totalXp: (Number(config.totalXp) || 0) + 120, lastUpdated: Date.now() },
            contributions: incrementContribution([...contributions], todayDateStr)
          });
          setConfirmDialog(null);
        },
        onCancel: () => {
          savePayload({
            ...payload,
            config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() }
          });
          setConfirmDialog(null);
        }
      });
    } else {
      savePayload({
        ...payload,
        config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() }
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

  // Morning Ritual steps & handlers
  const ritualSteps = [
    { name: "Hydrate — drink a full glass of water", seconds: 60 },
    { name: "Stand & Stretch (touch toes)", seconds: 90 },
    { name: "Box Breathing (4-hold-4 cycle)", seconds: 90 },
    { name: "Write ONE intention for today", seconds: 60 },
    { name: "Scan your task list — pick 3 priorities", seconds: 30 },
    { name: "Pick your very first action NOW", seconds: 30 }
  ];

  const formatRitualTime = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  const handleAdvanceRitualStep = () => {
    if (ritualStepIndex < ritualSteps.length - 1) {
      const next = ritualStepIndex + 1;
      setRitualStepIndex(next);
      setRitualSecondsLeft(ritualSteps[next].seconds);
    } else {
      setRitualActive(false);
      setRitualStepIndex(-1);
      setRitualSecondsLeft(0);
      setRitualDone(true);
    }
  };

  const handleBeginRitual = () => {
    setRitualActive(true);
    setRitualStepIndex(0);
    setRitualSecondsLeft(ritualSteps[0].seconds);
    setRitualDone(false);
  };

  const handleAbortRitual = () => {
    clearInterval(ritualIntervalRef.current);
    setRitualActive(false);
    setRitualStepIndex(-1);
    setRitualSecondsLeft(0);
  };

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
      {ritualSuccess && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "12px 24px", borderRadius: "20px", fontWeight: "700", fontSize: "14px", zIndex: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          🎉 Morning Ritual complete! +80 XP
        </div>
      )}

      {/* 1 ── Rotating Motivation Quote */}
      <section style={{
        background: "var(--accent)", borderRadius: "var(--radius-sm)",
        padding: "8px 14px", display: "flex", alignItems: "center", gap: "10px"
      }}>
        <p style={{
          fontSize: "13px", fontWeight: "700",
          color: "var(--btn-text, #fff)", lineHeight: "1.3",
          fontStyle: "italic", margin: 0, flex: 1
        }}>
          "{currentQuote.quote}"
        </p>
        <p style={{ fontSize: "10px", fontWeight: "600", color: "rgba(255,255,255,0.75)", margin: 0, flexShrink: 0, letterSpacing: "0.03em" }}>
          — {currentQuote.author}
        </p>
      </section>

      {/* 2 ── Day Horizon Timeline */}
      <section className="timeline-card">
        <div className="timeline-header">
          <div className="timeline-title">
            <h2 className="section-title" style={{ fontSize: "15px", marginBottom: 0 }}>⏰ Day Horizon</h2>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="timeline-clock">{currentTimeStr}</div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "600", marginTop: "1px" }}>{currentDateStr}</div>
          </div>
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

      {/* Morning Ritual — compact strip */}
      <section style={{
        background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
        padding: "10px 14px", display: "flex", flexDirection: "column", gap: "10px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>🌅</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Morning Ritual</span>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>7 min · +80 XP</span>
          </div>
          {!ritualActive ? (
            <button className="btn" onClick={handleBeginRitual}
              style={{ padding: "6px 16px", fontSize: "12px", fontWeight: "700" }}>
              Begin
            </button>
          ) : (
            <button onClick={handleAbortRitual}
              style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
              Stop
            </button>
          )}
        </div>
        {ritualActive && (
          <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              STEP {ritualStepIndex + 1} OF {ritualSteps.length}
            </span>
            <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
              {ritualSteps[ritualStepIndex].name}
            </p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "20px", fontWeight: "800", color: "var(--accent)", fontFamily: "var(--font-display)" }}>
                {formatRitualTime(ritualSecondsLeft)}
              </span>
              <button className="btn" onClick={handleAdvanceRitualStep}
                style={{ padding: "5px 14px", fontSize: "12px", background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                Skip →
              </button>
            </div>
          </div>
        )}
      </section>

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
              title="Toggle Low Energy mode"
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <h2 className="section-title" style={{ fontSize: "15px", margin: 0 }}>📝 Brain Dump</h2>
          {(payload.brainDump || []).length > 0 && (
            <span style={{ fontSize: "11px", color: (payload.brainDump || []).length >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700" }}>
              {(payload.brainDump || []).length}/50
            </span>
          )}
        </div>
        {(payload.brainDump || []).length >= 50 && (
          <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "8px", fontWeight: "600" }}>
            Inbox full (50/50). Go to the Roadmap tab to triage items first.
          </p>
        )}
        <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
          <input type="text" className="braindump-input"
            placeholder="Add anything on your mind."
            value={brainDumpText}
            onChange={e => setBrainDumpText(e.target.value)}
            disabled={(payload.brainDump || []).length >= 50} />
          <button type="submit" className="braindump-submit" disabled={(payload.brainDump || []).length >= 50}>➔</button>
        </form>
      </section>

      {/* 6 ── Progress + Quick Actions */}
      <section style={{
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)", padding: "10px 14px",
        display: "flex", flexDirection: "column", gap: "0"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Clickable progress strip */}
          <button
            onClick={() => setProgressDetailOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", gap: "10px", flex: 1,
              background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--accent)", whiteSpace: "nowrap" }}>
              🔥 {config.visitStreakCount || 0}d
            </span>
            <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
              {bentoDays.map((day, i) => (
                <div key={day.dateStr} style={{
                  width: i === 6 ? "12px" : "9px",
                  height: i === 6 ? "12px" : "9px",
                  borderRadius: "50%",
                  background: day.count > 0 ? "var(--accent)" : "var(--bg-secondary)",
                  border: i === 6 ? "2px solid var(--accent)" : "1px solid var(--border)",
                  flexShrink: 0
                }} />
              ))}
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "2px" }}>
              {progressDetailOpen ? "▲" : "▼"}
            </span>
          </button>
          {/* Action buttons */}
          <button onClick={openRescueMode}
            style={{ fontSize: "11px", fontWeight: "700", padding: "5px 10px", background: "rgba(248,113,113,0.12)", border: "1px solid var(--danger)", borderRadius: "8px", color: "var(--danger)", cursor: "pointer", whiteSpace: "nowrap" }}>
            🚨 Rescue
          </button>
          <button onClick={handleBadDayReset}
            style={{ fontSize: "11px", fontWeight: "700", padding: "5px 10px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}>
            🌪️ Reset
          </button>
        </div>

        {progressDetailOpen && (
          <div style={{ marginTop: "12px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
            {/* View toggle */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                📊 7-Day Progress
              </h3>
              <div style={{ display: "flex", gap: "4px" }}>
                {[{ id: "streak", label: "🔥" }, { id: "dots", label: "●" }].map(v => (
                  <button key={v.id} onClick={() => { setVizMode(v.id); localStorage.setItem("loci_viz", v.id); }}
                    style={{
                      padding: "3px 10px", fontSize: "12px", border: "1px solid var(--border)",
                      borderRadius: "20px", cursor: "pointer", fontWeight: "700",
                      background: vizMode === v.id ? "var(--accent)" : "var(--bg-secondary)",
                      color: vizMode === v.id ? "var(--btn-text, #fff)" : "var(--text-muted)",
                      transition: "all 0.15s"
                    }}>{v.label}</button>
                ))}
              </div>
            </div>

            {vizMode === "streak" && (() => {
              const streak = config.visitStreakCount || 0;
              return (
                <div style={{ textAlign: "center" }}>
                  <div style={{ marginBottom: "14px" }}>
                    <span style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: "900", color: "var(--accent)", lineHeight: "1", fontFamily: "var(--font-display)" }}>
                      {streak}
                    </span>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "2px" }}>
                      day streak 🔥
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "8px" }}>
                    {bentoDays.map((day, i) => {
                      const isToday = i === 6;
                      const done = day.count > 0;
                      return (
                        <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                          <div style={{
                            width: isToday ? "28px" : "22px", height: isToday ? "28px" : "22px",
                            borderRadius: "50%",
                            background: done ? "var(--accent)" : "var(--bg-secondary)",
                            border: isToday ? "2px solid var(--accent)" : "2px solid var(--border)",
                            transition: "all 0.2s"
                          }} />
                          <span style={{ fontSize: "8px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>
                            {day.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600" }}>Filled = tasks done that day</p>
                </div>
              );
            })()}

            {vizMode === "dots" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  {bentoDays.map((day, i) => {
                    const isToday = i === 6;
                    const done = day.count > 0;
                    return (
                      <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1 }}>
                        <span style={{ fontSize: "9px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>
                          {day.label}
                        </span>
                        <div style={{
                          width: isToday ? "32px" : "26px", height: isToday ? "32px" : "26px",
                          borderRadius: "50%",
                          background: done ? "var(--success, #22c55e)" : "var(--bg-secondary)",
                          border: isToday ? "2.5px solid var(--accent)" : done ? "none" : "2px solid var(--border)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.2s"
                        }}>
                          {done && <span style={{ fontSize: "12px" }}>✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600", marginTop: "4px" }}>
                  Green ✓ = showed up · Today highlighted
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Undo Delete Toast */}
      {undoTask && (
        <div style={{
          position: "fixed", bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)",
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

      {/* Rescue Mode v2 — triggered from ⋮ menu */}
      {rescueActive && (
        <RescueMode
          task={rescueTask}
          allTasks={tasks}
          firstName={(config.userName || "").split(" ")[0] || "friend"}
          apiKey={localStorage.getItem("loci_gemini_key") || import.meta.env.VITE_GEMINI_KEY || ""}
          onDismiss={() => setRescueActive(false)}
          onAccept={() => {
            setRescueActive(false);
            if (rescueTask) {
              savePayload({ ...payload, tasks: tasks.map(t => t.uuid === rescueTask.uuid ? { ...t, isNowFocus: true } : t) });
            }
          }}
        />
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </>
  );
}
