import React, { useState, useEffect, useRef } from "react";
import TaskRow from "./TaskRow";
import RescueMode from "./RescueMode";
import ConfirmDialog from "./ConfirmDialog";

export default function TodayTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  const [confirmDialog, setConfirmDialog] = useState(null);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const timerIntervalRef = useRef(null);

  // Morning Ritual — declared before useEffects that reference them
  const [ritualActive, setRitualActive] = useState(false);
  const [ritualStepIndex, setRitualStepIndex] = useState(-1);
  const [ritualSecondsLeft, setRitualSecondsLeft] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
  const [ritualSuccess, setRitualSuccess] = useState(false);
  const ritualIntervalRef = useRef(null);

  const activeTask = tasks.find((t) => t.isNowFocus && !t.isDeleted && !t.isCompleted);

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
        setTimerSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [isTimerRunning]);

  useEffect(() => {
    if (isTimerRunning && timerSecondsLeft === 0) {
      setIsTimerRunning(false);
      handlePomodoroCompletion();
    }
  }, [timerSecondsLeft, isTimerRunning]);

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

  const QUOTES = [
    { quote: "Either you run the day or the day runs you.", author: "Jim Rohn" },
    { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { quote: "Procrastination is the thief of time — collar him.", author: "Charles Dickens" },
    { quote: "You can't build a reputation on what you're going to do.", author: "Henry Ford" },
    { quote: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
    { quote: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
    { quote: "Schedule your priorities, don't prioritize your schedule.", author: "Stephen Covey" },
    { quote: "Until we can manage time, we can manage nothing else.", author: "Peter Drucker" },
    { quote: "Lost time is never found again.", author: "Benjamin Franklin" },
    { quote: "Do the hard jobs first. The easy jobs take care of themselves.", author: "Dale Carnegie" },
    { quote: "An hour of planning can save you 10 hours of doing.", author: "Dale Carnegie" },
    { quote: "Deep work is the ability to focus without distraction.", author: "Cal Newport" },
    { quote: "The main thing is to keep the main thing the main thing.", author: "Stephen Covey" },
    { quote: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
    { quote: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
    { quote: "What gets measured gets managed.", author: "Peter Drucker" },
    { quote: "You don't have to be great to start, but you must start to be great.", author: "Zig Ziglar" },
    { quote: "Don't count the days — make the days count.", author: "Muhammad Ali" },
    { quote: "Clarity about what matters gives clarity about what does not.", author: "Cal Newport" },
    { quote: "Absorb what is useful, discard what is not.", author: "Bruce Lee" },
    { quote: "Your future is created by what you do today, not tomorrow.", author: "Robert Kiyosaki" },
    { quote: "Someday is not a day of the week.", author: "Janet Dailey" },
    { quote: "Begin. The rest is easy.", author: "Seneca" },
    { quote: "Action is the antidote to despair.", author: "Joan Baez" },
    { quote: "Execution is the strategy.", author: "Anonymous" },
  ];
  const currentQuote = QUOTES[Math.floor(Date.now() / (2 * 3600 * 1000)) % QUOTES.length];

  const [timelineProgress, setTimelineProgress] = useState(0.5);
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [currentDateStr, setCurrentDateStr] = useState("");

  const formatHourLabel = (h) => {
    const h24 = h % 24;
    const isAM = h24 < 12 || h24 === 0;
    const displayH = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
    return `${displayH}${isAM ? "am" : "pm"}`;
  };

  const updateTimeline = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    const amPmStr = hour >= 12 ? "PM" : "AM";
    setCurrentTimeStr(`${displayHour}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")} ${amPmStr}`);
    setCurrentDateStr(now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
    const startHour = config.dayStartHour ?? 7;
    const endHour = config.dayEndHour ?? 26;
    const currentHourFloat = hour + minute / 60;
    const adjustedHour = hour < startHour ? currentHourFloat + 24 : currentHourFloat;
    setTimelineProgress(Math.max(0, Math.min(1, (adjustedHour - startHour) / (endHour - startHour))));
  };

  useEffect(() => {
    updateTimeline();
    const interval = setInterval(updateTimeline, 1000);
    return () => clearInterval(interval);
  }, [config.dayStartHour, config.dayEndHour]);

  useEffect(() => {
    const container = document.querySelector('.screen-content');
    if (!container) return;
    const onScroll = () => setIsScrolled(container.scrollTop > 15);
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const [rescueActive, setRescueActive] = useState(false);
  const [rescueTask, setRescueTask] = useState(null);
  // null | "ritual" | "dump" | "progress"
  const [toolPanel, setToolPanel] = useState(null);

  const openRescueMode = () => {
    const pinned = tasks.find(t => !t.isDeleted && !t.isCompleted && t.isNowFocus);
    const first = tasks.find(t => !t.isDeleted && !t.isCompleted);
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

  const [showRescue, setShowRescue] = useState(false);
  const [rescueStepIndex, setRescueStepIndex] = useState(0);
  const rescueSteps = [
    "Take one deep breath. Breathe in for 4, hold for 4, out for 4.",
    "What is the laughably smallest first step? A single sentence counts.",
    "Close all tabs that aren't this task right now.",
    "Commit to just 2 minutes. You can stop after that."
  ];
  const handleNextRescueStep = () => {
    if (rescueStepIndex < rescueSteps.length - 1) setRescueStepIndex(rescueStepIndex + 1);
    else { setShowRescue(false); setRescueStepIndex(0); }
  };

  const [brainDumpText, setBrainDumpText] = useState("");
  const [editingTaskUuid, setEditingTaskUuid] = useState(null);
  const [editFields, setEditFields] = useState({ title: "", concreteStep: "", priority: "P2" });
  const [vizMode, setVizMode] = useState(() => localStorage.getItem("loci_viz") || "streak");
  const [undoTask, setUndoTask] = useState(null);
  const undoTimeoutRef = useRef(null);

  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;
    const currentDump = payload.brainDump || [];
    if (currentDump.length >= 50) return;
    savePayload({ ...payload, brainDump: [...currentDump, { id: crypto.randomUUID(), text: brainDumpText.trim(), createdAt: Date.now() }] });
    setBrainDumpText("");
  };

  const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const incrementContribution = (newContributions, dateStr) => {
    const index = newContributions.findIndex((c) => c.dateString === dateStr);
    const uid = payload.userId || payload.config?.userId || "";
    const compositeKey = `${uid}_${dateStr}`;
    if (index === -1) {
      newContributions.push({ compositeKey, userId: uid, dateString: dateStr, count: 1, lastUpdated: Date.now() });
    } else {
      newContributions[index] = { ...newContributions[index], count: newContributions[index].count + 1, lastUpdated: Date.now() };
    }
    return newContributions;
  };

  const handleToggleComplete = (task) => {
    const todayDateStr = getTodayDateString();
    const isCompleted = !task.isCompleted;
    const updatedTasks = tasks.map((t) =>
      t.uuid === task.uuid ? { ...t, isCompleted, isNowFocus: false, dateCompletedString: isCompleted ? todayDateStr : null, lastUpdated: Date.now() } : t
    );
    let nextXp = Number(config.totalXp) || 0;
    let nextContributions = [...contributions];
    if (isCompleted) {
      nextXp += 100;
      nextContributions = incrementContribution(nextContributions, todayDateStr);
    } else {
      nextXp = Math.max(0, nextXp - 100);
      const contrIdx = nextContributions.findIndex((c) => c.dateString === todayDateStr);
      if (contrIdx !== -1 && nextContributions[contrIdx].count > 0) {
        nextContributions[contrIdx] = { ...nextContributions[contrIdx], count: nextContributions[contrIdx].count - 1, lastUpdated: Date.now() };
      }
    }
    savePayload({ ...payload, tasks: updatedTasks, config: { ...config, totalXp: nextXp, lastUpdated: Date.now() }, contributions: nextContributions });
  };

  const handlePinTask = (task) => {
    const now = Date.now();
    savePayload({ ...payload, tasks: tasks.map((t) => {
      const newFocus = t.uuid === task.uuid;
      if (t.isNowFocus === newFocus) return t;
      return { ...t, isNowFocus: newFocus, lastUpdated: now };
    })});
  };

  const handleDeleteTask = (task) => {
    savePayload({ ...payload, tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isDeleted: true, lastUpdated: Date.now() } : t) });
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoTask(task);
    undoTimeoutRef.current = setTimeout(() => setUndoTask(null), 5000);
  };

  const handleUndoDelete = () => {
    if (!undoTask) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    savePayload({ ...payload, tasks: tasks.map((t) => t.uuid === undoTask.uuid ? { ...t, isDeleted: false, lastUpdated: Date.now() } : t) });
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
          savePayload({
            ...payload,
            tasks: tasks.map((t) => t.uuid === task.uuid ? { ...t, isCompleted: true, isNowFocus: false, dateCompletedString: todayDateStr, lastUpdated: Date.now() } : t),
            config: { ...config, totalXp: (Number(config.totalXp) || 0) + 120, lastUpdated: Date.now() },
            contributions: incrementContribution([...contributions], todayDateStr)
          });
          setConfirmDialog(null);
        },
        onCancel: () => {
          savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() } });
          setConfirmDialog(null);
        }
      });
    } else {
      savePayload({ ...payload, config: { ...config, totalXp: (Number(config.totalXp) || 0) + 50, lastUpdated: Date.now() } });
    }
  };

  const handleEnergyToggle = () => {
    savePayload({ ...payload, config: { ...config, isLowEnergyMode: !config.isLowEnergyMode, lastUpdated: Date.now() } });
  };

  const handleStartEdit = (task) => {
    setEditingTaskUuid(task.uuid);
    setEditFields({ title: task.title, concreteStep: task.concreteStep || "", priority: task.priority });
  };
  const handleCancelEdit = () => setEditingTaskUuid(null);
  const handleSaveEdit = () => {
    if (!editFields.title.trim()) return;
    savePayload({ ...payload, tasks: tasks.map(t => t.uuid === editingTaskUuid ? { ...t, title: editFields.title.trim(), concreteStep: editFields.concreteStep.trim(), priority: editFields.priority, lastUpdated: Date.now() } : t) });
    setEditingTaskUuid(null);
  };

  const handleMoveTask = (task, direction) => {
    const list = [...remainingTasks];
    const idx = list.findIndex(t => t.uuid === task.uuid);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const aIdx = list[idx].orderIndex ?? idx;
    const bIdx = list[swapIdx].orderIndex ?? swapIdx;
    savePayload({ ...payload, tasks: tasks.map(t => {
      if (t.uuid === list[idx].uuid) return { ...t, orderIndex: bIdx, lastUpdated: Date.now() };
      if (t.uuid === list[swapIdx].uuid) return { ...t, orderIndex: aIdx, lastUpdated: Date.now() };
      return t;
    })});
  };

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

  const todayTasksAll = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isParked);
  const todayTasksFiltered = config.isLowEnergyMode ? todayTasksAll.filter((t) => t.priority === "P4") : todayTasksAll;
  const remainingTasks = todayTasksFiltered.filter((t) => !t.isCompleted).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const completedTasks = todayTasksFiltered.filter((t) => t.isCompleted);

  const getBentoDays = () => {
    const days = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const past = new Date(d);
      past.setDate(d.getDate() - i);
      const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
      const contr = contributions.find((c) => c.dateString === dateStr);
      days.push({ dateStr, label: past.toLocaleDateString("en-US", { weekday: "short" }).substring(0, 2), count: contr ? contr.count : 0 });
    }
    return days;
  };
  const bentoDays = getBentoDays();

  const progressRatio = timerMaxSeconds > 0 ? timerSecondsLeft / timerMaxSeconds : 0;
  const strokeDashoffset = 439.8 * (1 - progressRatio);
  const formatTimerMinutes = Math.floor(timerSecondsLeft / 60);
  const formatTimerSeconds = String(timerSecondsLeft % 60).padStart(2, "0");

  const dumpCount = (payload.brainDump || []).length;

  return (
    <>
      {ritualSuccess && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "12px 24px", borderRadius: "20px", fontWeight: "700", fontSize: "14px", zIndex: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          🎉 Morning Ritual complete! +80 XP
        </div>
      )}

      {/* ── Day header: style switchable via Settings → Header Style ── */}
      {(() => {
        const startHour = config.dayStartHour ?? 7;
        const endHour = config.dayEndHour ?? 26;
        const daySpan = endHour - startHour;
        const labelCount = daySpan > 10 ? 5 : 3;
        const timeLabels = Array.from({ length: labelCount }, (_, i) =>
          formatHourLabel(startHour + Math.round((daySpan / (labelCount - 1)) * i))
        );
        const nowHour = new Date().getHours();
        const greeting = nowHour < 12 ? "Good morning" : nowHour < 17 ? "Good afternoon" : "Good evening";
        const firstName = (config.userName || "").split(" ")[0];
        const headerStyle = config.headerStyle || "full";

        // Option E: Auto-hide — wraps the full card, collapses on scroll
        if (headerStyle === "autohide") {
          const fullCard = (
            <section style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
              {firstName ? (
                <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px", letterSpacing: "-0.01em" }}>
                  {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
                <div style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{currentTimeStr}</div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>{currentDateStr}</div>
              </div>
              <div style={{ height: "8px", background: "var(--bg-secondary)", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${timelineProgress * 100}%`, background: "var(--accent)", borderRadius: "4px", transition: "width 1s linear" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", marginBottom: "10px" }}>
                {timeLabels.map((label, i) => (
                  <span key={i} style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "600" }}>{label}</span>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: "12px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.45, fontWeight: "600" }}>
                "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "11px" }}>— {currentQuote.author}</span>
              </p>
            </section>
          );
          return (
            <div className={`header-autohide-wrapper${isScrolled ? " header-collapsed" : ""}`}>
              {fullCard}
            </div>
          );
        }

        // Option C: Compact strip — tap ▾ to reveal full details
        if (headerStyle === "compact") {
          return (
            <section style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 14px" }}>
              <div onClick={() => setHeaderExpanded(e => !e)} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
                <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", flexShrink: 0 }}>
                  {currentTimeStr}
                </span>
                <div style={{ flex: 1, height: "6px", background: "var(--bg-secondary)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${timelineProgress * 100}%`, background: "var(--accent)", borderRadius: "3px", transition: "width 1s linear" }} />
                </div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600", flexShrink: 0 }}>{currentDateStr}</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", flexShrink: 0 }}>{headerExpanded ? "▴" : "▾"}</span>
              </div>
              {headerExpanded && (
                <div style={{ marginTop: "10px" }}>
                  {firstName && (
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px" }}>
                      {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
                    </div>
                  )}
                  <div style={{ height: "8px", background: "var(--bg-secondary)", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${timelineProgress * 100}%`, background: "var(--accent)", borderRadius: "4px", transition: "width 1s linear" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", marginBottom: "8px" }}>
                    {timeLabels.map((label, i) => (
                      <span key={i} style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "600" }}>{label}</span>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.45, fontWeight: "600" }}>
                    "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "11px" }}>— {currentQuote.author}</span>
                  </p>
                </div>
              )}
            </section>
          );
        }

        // Option D: Frameless bar — no card border/padding, all info on two rows
        if (headerStyle === "frameless") {
          return (
            <div style={{ padding: "4px 2px 8px 2px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
                {firstName ? (
                  <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
                    {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
                  </span>
                ) : (
                  <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{currentTimeStr}</span>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                  {firstName && <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{currentTimeStr}</span>}
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>{currentDateStr}</span>
                </div>
              </div>
              <div style={{ height: "6px", background: "var(--bg-secondary)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${timelineProgress * 100}%`, background: "var(--accent)", borderRadius: "3px", transition: "width 1s linear" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px", marginBottom: "6px" }}>
                {timeLabels.map((label, i) => (
                  <span key={i} style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "600" }}>{label}</span>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: "11px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.4, fontWeight: "600" }}>
                "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "10px" }}>— {currentQuote.author}</span>
              </p>
            </div>
          );
        }

        // Default ("full"): original 4-row card
        return (
          <section style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
            {firstName ? (
              <div style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "8px", letterSpacing: "-0.01em" }}>
                {greeting}, <span style={{ color: "var(--accent)" }}>{firstName}</span> 👋
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
              <div style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {currentTimeStr}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>
                {currentDateStr}
              </div>
            </div>
            <div style={{ height: "8px", background: "var(--bg-secondary)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${timelineProgress * 100}%`, background: "var(--accent)", borderRadius: "4px", transition: "width 1s linear" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", marginBottom: "10px" }}>
              {timeLabels.map((label, i) => (
                <span key={i} style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "600" }}>{label}</span>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: "12px", fontStyle: "italic", color: "var(--accent)", lineHeight: 1.45, fontWeight: "600" }}>
              "{currentQuote.quote}" <span style={{ fontStyle: "normal", fontWeight: "400", color: "var(--text-muted)", fontSize: "11px" }}>— {currentQuote.author}</span>
            </p>
          </section>
        );
      })()}

      {/* ── Key Deadline countdown strip */}
      {config.deadlineDate && (() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const target = new Date(config.deadlineDate + "T00:00:00");
        const days = Math.round((target - today) / 86400000);
        if (days < 0) return null;
        const label = (config.deadlineLabel || "Deadline").trim();
        const color = days === 0 ? "var(--danger)" : days <= 14 ? "var(--danger)" : days <= 45 ? "var(--warning)" : "var(--accent)";
        const bg = days === 0 ? "rgba(248,113,113,0.13)" : days <= 14 ? "rgba(248,113,113,0.10)" : days <= 45 ? "rgba(251,191,36,0.10)" : "var(--accent-light)";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", background: bg, border: `1px solid ${color}`, borderRadius: "var(--radius-sm)", padding: "10px 14px" }}>
            <span style={{ fontSize: "22px", fontWeight: "900", color, fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", lineHeight: 1, flexShrink: 0 }}>
              {days === 0 ? "TODAY" : `${days}d`}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
              <span style={{ fontSize: "9px", fontWeight: "900", letterSpacing: "0.1em", textTransform: "uppercase", color }}>
                KEY DEADLINE
              </span>
              <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
          </div>
        );
      })()}

      {/* ── Today's Focus — tasks dominate the screen */}
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
              title={config.isLowEnergyMode ? "Low Energy ON — tap to disable" : "Enable Low Energy mode"}
              style={{
                background: config.isLowEnergyMode ? "var(--success)" : "var(--bg-secondary)",
                color: config.isLowEnergyMode ? "#fff" : "var(--text-secondary)"
              }}
            >
              🔋 {config.isLowEnergyMode ? "Low Energy ON" : "Low Energy"}
            </button>
            <span className="section-count-badge">
              {completedTasks.length}/{todayTasksFiltered.length}
            </span>
          </div>
        </div>

        <div className="tasks-list">
          {todayTasksAll.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 16px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--border)" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🧠</div>
              <p style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "6px" }}>Welcome to Loci!</p>
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
                        <button key={p} type="button" className={`priority-badge ${p.toLowerCase()}`}
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
                    <TaskRow key={task.uuid} task={task} onToggleComplete={handleToggleComplete} onDelete={handleDeleteTask} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Active Focus Block — only when a task is pinned */}
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
                <circle className="timer-ring-progress" cx="80" cy="80" r="70" strokeWidth="8" style={{ strokeDashoffset }} />
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

      {/* ── Utility strip: inline (hidden when dock is active) */}
      {(config.toolsStyle || "inline") !== "dock" && <section style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
        <div className="habits-tools-row" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px" }}>
          {/* Streak + 7-day dots — tap to expand progress detail */}
          <button
            onClick={() => setToolPanel(p => p === "progress" ? null : "progress")}
            style={{ display: "flex", alignItems: "center", gap: "5px", flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
          >
            <span style={{ fontSize: "12px", fontWeight: "800", color: "var(--accent)", whiteSpace: "nowrap" }}>
              🔥 {config.visitStreakCount || 0}d
            </span>
            <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
              {bentoDays.map((day, i) => (
                <div key={day.dateStr} style={{
                  width: i === 6 ? "10px" : "7px",
                  height: i === 6 ? "10px" : "7px",
                  borderRadius: "50%",
                  background: day.count > 0 ? "var(--accent)" : "var(--bg-secondary)",
                  border: i === 6 ? "2px solid var(--accent)" : "1px solid var(--border)",
                  flexShrink: 0
                }} />
              ))}
            </div>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{toolPanel === "progress" ? "▲" : "▼"}</span>
          </button>

          {/* Morning Ritual */}
          <button
            onClick={() => setToolPanel(p => p === "ritual" ? null : "ritual")}
            title="Morning Ritual"
            style={{
              fontSize: "15px", padding: "5px 9px",
              background: (ritualActive || toolPanel === "ritual") ? "var(--accent)" : "var(--bg-secondary)",
              color: (ritualActive || toolPanel === "ritual") ? "var(--btn-text, #fff)" : "var(--text-secondary)",
              border: ritualActive ? "2px solid var(--success)" : "1px solid var(--border)",
              borderRadius: "8px", cursor: "pointer", lineHeight: 1
            }}
          >
            🌅<span className="tool-btn-text">Ritual</span>
          </button>

          {/* Brain Dump */}
          <button
            onClick={() => setToolPanel(p => p === "dump" ? null : "dump")}
            title="Brain Dump"
            style={{
              fontSize: "15px", padding: "5px 9px", position: "relative",
              background: toolPanel === "dump" ? "var(--accent)" : "var(--bg-secondary)",
              color: toolPanel === "dump" ? "var(--btn-text, #fff)" : "var(--text-secondary)",
              border: "1px solid var(--border)", borderRadius: "8px", cursor: "pointer", lineHeight: 1
            }}
          >
            📝<span className="tool-btn-text">Dump</span>
            {dumpCount > 0 && (
              <span style={{ position: "absolute", top: "-5px", right: "-5px", background: "var(--accent)", color: "var(--btn-text, #fff)", fontSize: "8px", fontWeight: "800", borderRadius: "6px", padding: "1px 4px", lineHeight: 1.3 }}>
                {dumpCount}
              </span>
            )}
          </button>

          {/* Rescue */}
          <button onClick={openRescueMode} title="Rescue Mode"
            style={{ fontSize: "15px", padding: "5px 9px", background: "rgba(248,113,113,0.12)", border: "1px solid var(--danger)", borderRadius: "8px", color: "var(--danger)", cursor: "pointer", lineHeight: 1 }}>
            🚨<span className="tool-btn-text">Rescue</span>
          </button>

          {/* Bad Day Reset */}
          <button onClick={handleBadDayReset} title="Bad Day Reset"
            style={{ fontSize: "15px", padding: "5px 9px", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-secondary)", cursor: "pointer", lineHeight: 1 }}>
            🌪️<span className="tool-btn-text">Reset</span>
          </button>
        </div>

        {/* Expandable: 7-Day Progress */}
        {toolPanel === "progress" && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                📊 7-Day Progress
              </h3>
              <div style={{ display: "flex", gap: "4px" }}>
                {[{ id: "streak", label: "🔥" }, { id: "dots", label: "●" }].map(v => (
                  <button key={v.id} onClick={() => { setVizMode(v.id); localStorage.setItem("loci_viz", v.id); }}
                    style={{ padding: "3px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "20px", cursor: "pointer", fontWeight: "700", background: vizMode === v.id ? "var(--accent)" : "var(--bg-secondary)", color: vizMode === v.id ? "var(--btn-text, #fff)" : "var(--text-muted)", transition: "all 0.15s" }}>
                    {v.label}
                  </button>
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
                          <div style={{ width: isToday ? "28px" : "22px", height: isToday ? "28px" : "22px", borderRadius: "50%", background: done ? "var(--accent)" : "var(--bg-secondary)", border: isToday ? "2px solid var(--accent)" : "2px solid var(--border)", transition: "all 0.2s" }} />
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
                        <div style={{ width: isToday ? "32px" : "26px", height: isToday ? "32px" : "26px", borderRadius: "50%", background: done ? "var(--success, #22c55e)" : "var(--bg-secondary)", border: isToday ? "2.5px solid var(--accent)" : done ? "none" : "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
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

        {/* Expandable: Morning Ritual */}
        {toolPanel === "ritual" && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: ritualActive ? "10px" : 0 }}>
              <span style={{ fontSize: "16px" }}>🌅</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Morning Ritual</span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>7 min · +80 XP</span>
              </div>
              {!ritualActive ? (
                <button className="btn" onClick={handleBeginRitual} style={{ padding: "6px 16px", fontSize: "12px", fontWeight: "700" }}>
                  Begin
                </button>
              ) : (
                <button onClick={handleAbortRitual} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
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
                  <button className="btn" onClick={handleAdvanceRitualStep} style={{ padding: "5px 14px", fontSize: "12px", background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                    Skip →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expandable: Brain Dump */}
        {toolPanel === "dump" && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h2 className="section-title" style={{ fontSize: "13px", margin: 0 }}>📝 Brain Dump</h2>
              {dumpCount > 0 && (
                <span style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700" }}>
                  {dumpCount}/50
                </span>
              )}
            </div>
            {dumpCount >= 50 && (
              <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "8px", fontWeight: "600" }}>
                Inbox full (50/50). Go to the Roadmap tab to triage items first.
              </p>
            )}
            <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
              <input type="text" className="braindump-input"
                placeholder="Add anything on your mind."
                value={brainDumpText}
                onChange={e => setBrainDumpText(e.target.value)}
                disabled={dumpCount >= 50} />
              <button type="submit" className="braindump-submit" disabled={dumpCount >= 50}>➔</button>
            </form>
          </div>
        )}
      </section>}
      {(config.toolsStyle || "inline") !== "dock" && (
        <div className="mobile-tools-legend" style={{ display: "none", justifyContent: "center", gap: "8px", fontSize: "10.5px", color: "var(--text-muted)", marginTop: "4px", padding: "0 6px" }}>
          <span>🌅 Ritual</span> · <span>📝 Dump</span> · <span>🚨 Rescue</span> · <span>🌪️ Reset</span>
        </div>
      )}

      {/* ── Floating Bottom Dock (Concept 3) */}
      {config.toolsStyle === "dock" && (
        <>
          {/* Spacer so tasks aren't hidden behind the dock */}
          <div style={{ height: "72px" }} />

          {/* Backdrop */}
          {toolPanel && (
            <div className="tools-sheet-backdrop" onClick={() => setToolPanel(null)} />
          )}

          {/* Bottom Sheet content */}
          {toolPanel && (
            <div className="tools-bottom-sheet">
              <div className="tools-sheet-handle" />

              {toolPanel === "progress" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                      📊 7-Day Progress
                    </h3>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {[{ id: "streak", label: "🔥" }, { id: "dots", label: "●" }].map(v => (
                        <button key={v.id} onClick={() => { setVizMode(v.id); localStorage.setItem("loci_viz", v.id); }}
                          style={{ padding: "3px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "20px", cursor: "pointer", fontWeight: "700", background: vizMode === v.id ? "var(--accent)" : "var(--bg-secondary)", color: vizMode === v.id ? "var(--btn-text, #fff)" : "var(--text-muted)", transition: "all 0.15s" }}>
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {vizMode === "streak" && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ marginBottom: "14px" }}>
                        <span style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: "900", color: "var(--accent)", lineHeight: "1", fontFamily: "var(--font-display)" }}>
                          {config.visitStreakCount || 0}
                        </span>
                        <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "2px" }}>day streak 🔥</div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "8px" }}>
                        {bentoDays.map((day, i) => {
                          const isToday = i === 6;
                          const done = day.count > 0;
                          return (
                            <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                              <div style={{ width: isToday ? "28px" : "22px", height: isToday ? "28px" : "22px", borderRadius: "50%", background: done ? "var(--accent)" : "var(--bg-secondary)", border: isToday ? "2px solid var(--accent)" : "2px solid var(--border)", transition: "all 0.2s" }} />
                              <span style={{ fontSize: "8px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>{day.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600" }}>Filled = tasks done that day</p>
                    </div>
                  )}
                  {vizMode === "dots" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        {bentoDays.map((day, i) => {
                          const isToday = i === 6;
                          const done = day.count > 0;
                          return (
                            <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1 }}>
                              <span style={{ fontSize: "9px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>{day.label}</span>
                              <div style={{ width: isToday ? "32px" : "26px", height: isToday ? "32px" : "26px", borderRadius: "50%", background: done ? "var(--success, #22c55e)" : "var(--bg-secondary)", border: isToday ? "2.5px solid var(--accent)" : done ? "none" : "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                                {done && <span style={{ fontSize: "12px" }}>✓</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600", marginTop: "4px" }}>Green ✓ = showed up · Today highlighted</p>
                    </div>
                  )}
                </div>
              )}

              {toolPanel === "ritual" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: ritualActive ? "10px" : 0 }}>
                    <span style={{ fontSize: "16px" }}>🌅</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Morning Ritual</span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>7 min · +80 XP</span>
                    </div>
                    {!ritualActive ? (
                      <button className="btn" onClick={handleBeginRitual} style={{ padding: "6px 16px", fontSize: "12px", fontWeight: "700" }}>Begin</button>
                    ) : (
                      <button onClick={handleAbortRitual} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Stop</button>
                    )}
                  </div>
                  {ritualActive && (
                    <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "12px", display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>STEP {ritualStepIndex + 1} OF {ritualSteps.length}</span>
                      <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>{ritualSteps[ritualStepIndex].name}</p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "20px", fontWeight: "800", color: "var(--accent)", fontFamily: "var(--font-display)" }}>{formatRitualTime(ritualSecondsLeft)}</span>
                        <button className="btn" onClick={handleAdvanceRitualStep} style={{ padding: "5px 14px", fontSize: "12px", background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>Skip →</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {toolPanel === "dump" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <h2 className="section-title" style={{ fontSize: "13px", margin: 0 }}>📝 Brain Dump</h2>
                    {dumpCount > 0 && (
                      <span style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--text-muted)", fontWeight: "700" }}>{dumpCount}/50</span>
                    )}
                  </div>
                  {dumpCount >= 50 && (
                    <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "8px", fontWeight: "600" }}>Inbox full (50/50). Go to Roadmap to triage first.</p>
                  )}
                  <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
                    <input type="text" className="braindump-input"
                      placeholder="Add anything on your mind."
                      value={brainDumpText}
                      onChange={e => setBrainDumpText(e.target.value)}
                      disabled={dumpCount >= 50} />
                    <button type="submit" className="braindump-submit" disabled={dumpCount >= 50}>➔</button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* The dock itself */}
          <div className="floating-tools-dock">
            <button
              onClick={() => setToolPanel(p => p === "progress" ? null : "progress")}
              style={{ display: "flex", alignItems: "center", gap: "5px", background: toolPanel === "progress" ? "rgba(255,255,255,0.1)" : "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "16px" }}
            >
              <span style={{ fontSize: "12px", fontWeight: "800", color: "var(--accent)", whiteSpace: "nowrap" }}>🔥 {config.visitStreakCount || 0}d</span>
              <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                {bentoDays.map((day, i) => (
                  <div key={day.dateStr} style={{ width: i === 6 ? "8px" : "6px", height: i === 6 ? "8px" : "6px", borderRadius: "50%", background: day.count > 0 ? "var(--accent)" : "rgba(255,255,255,0.15)", border: i === 6 ? "1.5px solid var(--accent)" : "1px solid rgba(255,255,255,0.2)", flexShrink: 0 }} />
                ))}
              </div>
            </button>

            <div style={{ width: "1px", height: "24px", background: "rgba(255,255,255,0.12)" }} />

            <button onClick={() => setToolPanel(p => p === "ritual" ? null : "ritual")}
              style={{ fontSize: "18px", padding: "6px", background: (ritualActive || toolPanel === "ritual") ? "rgba(255,255,255,0.15)" : "transparent", border: ritualActive ? "1.5px solid var(--success)" : "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1, color: "inherit" }} title="Morning Ritual">
              🌅
            </button>

            <button onClick={() => setToolPanel(p => p === "dump" ? null : "dump")}
              style={{ fontSize: "18px", padding: "6px", background: toolPanel === "dump" ? "rgba(255,255,255,0.15)" : "transparent", border: "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1, position: "relative" }} title="Brain Dump">
              📝
              {dumpCount > 0 && (
                <span style={{ position: "absolute", top: "2px", right: "2px", background: "var(--accent)", color: "#fff", fontSize: "7px", fontWeight: "800", borderRadius: "5px", padding: "1px 3px", lineHeight: 1.2 }}>{dumpCount}</span>
              )}
            </button>

            <button onClick={openRescueMode}
              style={{ fontSize: "18px", padding: "6px", background: "transparent", border: "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1 }} title="Rescue Mode">
              🚨
            </button>

            <button onClick={handleBadDayReset}
              style={{ fontSize: "18px", padding: "6px", background: "transparent", border: "none", borderRadius: "10px", cursor: "pointer", lineHeight: 1 }} title="Bad Day Reset">
              🌪️
            </button>
          </div>
        </>
      )}

      {/* ── Undo Delete Toast */}
      {undoTask && (
        <div style={{ position: "fixed", bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "20px", padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.35)", zIndex: 200, fontSize: "12.5px", whiteSpace: "nowrap", maxWidth: "90vw" }}>
          <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
            "{undoTask.title.length > 28 ? undoTask.title.substring(0, 28) + "…" : undoTask.title}" deleted
          </span>
          <button onClick={handleUndoDelete}
            style={{ background: "var(--accent)", color: "var(--btn-text, #fff)", border: "none", borderRadius: "12px", padding: "5px 14px", fontSize: "12px", fontWeight: "700", cursor: "pointer", flexShrink: 0 }}>
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

      {/* Rescue Mode v2 */}
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
