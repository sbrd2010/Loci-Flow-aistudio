import React, { useState, useEffect, useRef } from "react";
import TaskRow from "./TaskRow";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { getAIKeys, callAI } from "../utils/aiCall";
import { celebrate } from "../utils/celebrations";
import { scheduleReminder, cancelReminder, formatReminderLabel } from "../utils/reminders";

export default function TodayTab({ payload, savePayload }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  const [confirmDialog, setConfirmDialog] = useState(null);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showRescue, setShowRescue] = useState(false);
  const [rescueStep, setRescueStep] = useState(0);
  const [isMVDMode, setIsMVDMode] = useState(false);

  const rescueSteps = [
    "Take one deep breath. Breathe in for 4, hold for 4, out for 4.",
    "What is the laughably smallest first step? A single sentence counts.",
    "Close all tabs that aren't this task right now.",
    "Commit to just 2 minutes. You can stop after that.",
  ];

  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const [timerMaxSeconds, setTimerMaxSeconds] = useState((config.pomodoroDurationMinutes || 25) * 60);
  const timerIntervalRef = useRef(null);

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

  const QUOTES = [
    { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { quote: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
    { quote: "Schedule your priorities, don't prioritize your schedule.", author: "Stephen Covey" },
    { quote: "Until we can manage time, we can manage nothing else.", author: "Peter Drucker" },
    { quote: "Lost time is never found again.", author: "Benjamin Franklin" },
    { quote: "An hour of planning can save you 10 hours of doing.", author: "Dale Carnegie" },
    { quote: "Deep work is the ability to focus without distraction.", author: "Cal Newport" },
    { quote: "The main thing is to keep the main thing the main thing.", author: "Stephen Covey" },
    { quote: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
    { quote: "Clarity about what matters gives clarity about what does not.", author: "Cal Newport" },
    { quote: "Absorb what is useful, discard what is not.", author: "Bruce Lee" },
    { quote: "Begin. The rest is easy.", author: "Seneca" },
    { quote: "Action is the antidote to despair.", author: "Joan Baez" },
    { quote: "Progress, not perfection.", author: "Anonymous" },
    { quote: "What you do every day matters more than what you do once in a while.", author: "Gretchen Rubin" },
    { quote: "You don't rise to the level of your goals. You fall to the level of your systems.", author: "James Clear" },
    { quote: "Almost everything will work again if you unplug it for a few minutes — including you.", author: "Anne Lamott" },
    { quote: "Rest is not idleness.", author: "John Lubbock" },
    { quote: "It's not about time management. It's about attention management.", author: "Adam Grant" },
    { quote: "The two most powerful warriors are patience and time.", author: "Leo Tolstoy" },
    { quote: "Do less, but do it well.", author: "Anonymous" },
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

  const [breakdownLoadingUuid, setBreakdownLoadingUuid] = useState(null);

  const [editingTaskUuid, setEditingTaskUuid] = useState(null);
  const [editFields, setEditFields] = useState({ title: "", concreteStep: "", priority: "P2", reminderOn: false, reminderDate: "", reminderTime: "" });
  const [undoTask, setUndoTask] = useState(null);
  const undoTimeoutRef = useRef(null);

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
    if (isCompleted && task.reminderAt) cancelReminder(task.uuid);
    const updatedTasks = tasks.map((t) =>
      t.uuid === task.uuid ? { ...t, isCompleted, isNowFocus: false, dateCompletedString: isCompleted ? todayDateStr : null, lastUpdated: Date.now() } : t
    );
    if (isCompleted) celebrate();
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

  const handleToggleMVD = (task) => {
    savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? { ...t, isMVD: !t.isMVD, lastUpdated: Date.now() } : t) });
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
          celebrate();
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
    let reminderDate = "", reminderTime = "";
    if (task.reminderAt) {
      const d = new Date(task.reminderAt);
      reminderDate = d.toISOString().slice(0, 10);
      reminderTime = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    }
    setEditFields({ title: task.title, concreteStep: task.concreteStep || "", priority: task.priority, reminderOn: !!task.reminderAt, reminderDate, reminderTime });
  };
  const handleCancelEdit = () => setEditingTaskUuid(null);
  const handleSaveEdit = () => {
    if (!editFields.title.trim()) return;
    let reminderAt = null;
    if (editFields.reminderOn && editFields.reminderDate && editFields.reminderTime) {
      const ts = new Date(`${editFields.reminderDate}T${editFields.reminderTime}`).getTime();
      if (!isNaN(ts) && ts > Date.now()) reminderAt = ts;
    }
    const updatedTask = tasks.find(t => t.uuid === editingTaskUuid);
    if (updatedTask) {
      cancelReminder(editingTaskUuid);
      const saved = { ...updatedTask, title: editFields.title.trim(), concreteStep: editFields.concreteStep.trim(), priority: editFields.priority, reminderAt, lastUpdated: Date.now() };
      if (reminderAt) scheduleReminder(saved);
      savePayload({ ...payload, tasks: tasks.map(t => t.uuid === editingTaskUuid ? saved : t) });
    }
    setEditingTaskUuid(null);
  };

  const handleBreakdown = async (task) => {
    setBreakdownLoadingUuid(task.uuid);
    const { groqKey, geminiKey } = getAIKeys();
    try {
      const raw = await callAI({
        groqKey, geminiKey,
        systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array of strings, no markdown, no explanation.",
        messages: [{
          role: "user",
          content: `Break this task into 3–5 tiny, concrete micro-steps that each take under 5 minutes and feel easy to start.\n\nTask: "${task.title}"\nConcrete step: "${task.concreteStep || ""}"\nTime estimate: ${task.timeEstimateMinutes || 25} minutes\n\nReturn ONLY a JSON array of short strings (each under 12 words). Example: ["Open the document", "Write one sentence", "Save the file"]`
        }],
        maxTokens: 200
      });
      const cleaned = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
      const steps = JSON.parse(cleaned);
      if (!Array.isArray(steps) || steps.length === 0) throw new Error("bad response");
      const subSteps = steps.slice(0, 5).map(text => ({ id: safeUUID(), text: String(text).trim(), done: false }));
      savePayload({ ...payload, tasks: tasks.map(t => t.uuid === task.uuid ? { ...t, subSteps, lastUpdated: Date.now() } : t) });
    } catch (_) {
      // silently fail — user can retry via menu
    } finally {
      setBreakdownLoadingUuid(null);
    }
  };

  const handleSubStepToggle = (task, stepId) => {
    const updatedTasks = tasks.map(t => {
      if (t.uuid !== task.uuid) return t;
      const newSubSteps = (t.subSteps || []).map(s => s.id === stepId ? { ...s, done: !s.done } : s);
      return { ...t, subSteps: newSubSteps, lastUpdated: Date.now() };
    });
    savePayload({ ...payload, tasks: updatedTasks });
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

  const todayTasksAll = tasks.filter((t) => t.horizonLevel === "today" && !t.isDeleted && !t.isParked);
  const todayTasksFiltered = isMVDMode
    ? todayTasksAll.filter(t => t.isMVD)
    : config.isLowEnergyMode
      ? todayTasksAll.filter(t => t.priority === "P4")
      : todayTasksAll;
  const remainingTasks = todayTasksFiltered.filter((t) => !t.isCompleted).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const completedTasks = todayTasksFiltered.filter((t) => t.isCompleted);

  const progressRatio = timerMaxSeconds > 0 ? timerSecondsLeft / timerMaxSeconds : 0;
  const strokeDashoffset = 439.8 * (1 - progressRatio);
  const formatTimerMinutes = Math.floor(timerSecondsLeft / 60);
  const formatTimerSeconds = String(timerSecondsLeft % 60).padStart(2, "0");

  return (
    <>
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
            {isMVDMode && (
              <span style={{ color: "var(--warning)", fontSize: "11px", fontWeight: "700", marginLeft: "8px" }}>
                ⭐ MUST-DOS
              </span>
            )}
            {!isMVDMode && config.isLowEnergyMode && (
              <span style={{ color: "var(--warning)", fontSize: "11px", fontWeight: "700", marginLeft: "8px" }}>
                ⚡ LOW ENERGY
              </span>
            )}
          </h2>
          <div className="section-header-right" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button
              className="stuck-btn"
              onClick={() => setIsMVDMode(m => !m)}
              title={isMVDMode ? "Must-Do mode ON — tap to show all" : "Show only must-do tasks"}
              style={{
                background: isMVDMode ? "var(--warning)" : "var(--bg-secondary)",
                color: isMVDMode ? "#fff" : "var(--text-secondary)"
              }}
            >
              ⭐ {isMVDMode ? "Must-Dos" : "Must-Do"}
            </button>
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
              {completedTasks.length}/{todayTasksAll.length}
            </span>
          </div>
        </div>

        <div className="tasks-list" data-testid="today-tasks-list">
          {todayTasksAll.length === 0 && (() => {
            const hasEverHadTasks = tasks.filter(t => !t.isDeleted).length > 0;
            if (hasEverHadTasks) {
              return (
                <div style={{ textAlign: "center", padding: "24px 16px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--border)" }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>🎉</div>
                  <p style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "6px" }}>All clear for today!</p>
                  <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                    No tasks scheduled for today. Tap <strong style={{ color: "var(--accent)" }}>+</strong> to add one, or check other horizons on the Plan tab.
                  </p>
                </div>
              );
            }
            return (
              <div style={{ padding: "20px 16px", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--border)" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px", textAlign: "center" }}>🧠</div>
                <p style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)", marginBottom: "14px", textAlign: "center" }}>
                  Your first focus cycle
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                  {[
                    { n: "1", icon: "💭", text: "Dump what's on your mind", sub: "Tap 📝 above to capture thoughts" },
                    { n: "2", icon: "➕", text: "Add it as a task", sub: "Tap + below — AI breaks it into a micro-step" },
                    { n: "3", icon: "🎯", text: "Pick what matters Today", sub: "You're already on the right tab" },
                    { n: "4", icon: "📍", text: "Pin a task to start the timer", sub: "Tap ••• on any task → Pin to Focus" },
                    { n: "5", icon: "▶", text: "Work for 25 minutes", sub: "Use the focus timer — single task only" },
                    { n: "6", icon: "✓", text: "Done or reset gently", sub: "Complete it, or use Bad Day Reset — no shame" },
                  ].map(item => (
                    <div key={item.n} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "10px", fontWeight: "900", color: "var(--accent)", minWidth: "14px", paddingTop: "3px" }}>{item.n}</span>
                      <span style={{ fontSize: "16px", lineHeight: "1", paddingTop: "1px" }}>{item.icon}</span>
                      <div>
                        <span style={{ fontSize: "12.5px", fontWeight: "700", color: "var(--text-primary)" }}>{item.text}</span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginTop: "1px" }}>{item.sub}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: "12px", color: "var(--accent)", fontWeight: "700", textAlign: "center" }}>
                  Start with step 2 — tap + to add your first task.
                </p>
              </div>
            );
          })()}
          {todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && isMVDMode && (
            <div style={{ textAlign: "center", padding: "20px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "6px" }}>No must-do tasks marked yet.</p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}>
                Tap ••• on any task and choose <strong>⭐ Mark as must-do</strong> to add it to your minimum viable day.
              </p>
            </div>
          )}
          {todayTasksAll.length > 0 && todayTasksFiltered.length === 0 && !isMVDMode && config.isLowEnergyMode && (
            <div style={{ textAlign: "center", padding: "20px 14px", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "6px" }}>No low-energy tasks available.</p>
              <p style={{ fontSize: "12px", lineHeight: "1.5" }}>
                Tag a task P4 to surface it here, or tap 🌱 Clean Slate in Mind Box for a fresh start.
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
                    <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
                      {["P1","P2","P3","P4"].map(p => (
                        <button key={p} type="button" className={`priority-badge ${p.toLowerCase()}`}
                          onClick={() => setEditFields(f => ({ ...f, priority: p }))}
                          style={{ border: editFields.priority === p ? "2px solid var(--accent)" : "2px solid transparent", cursor: "pointer", padding: "4px 10px", opacity: editFields.priority === p ? 1 : 0.55 }}>
                          {p}
                        </button>
                      ))}
                    </div>
                    {/* Reminder */}
                    <button
                      type="button"
                      onClick={() => setEditFields(f => ({ ...f, reminderOn: !f.reminderOn }))}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 12px", marginBottom: "8px", background: editFields.reminderOn ? "var(--accent-ring, rgba(99,102,241,0.08))" : "var(--bg-secondary)", border: editFields.reminderOn ? "1.5px solid var(--accent)" : "1.5px solid var(--border)", borderRadius: "8px", cursor: "pointer" }}
                    >
                      <span style={{ fontSize: "12px", fontWeight: "700", color: editFields.reminderOn ? "var(--accent)" : "var(--text-secondary)" }}>
                        🔔 {editFields.reminderOn && editFields.reminderDate && editFields.reminderTime ? formatReminderLabel(new Date(`${editFields.reminderDate}T${editFields.reminderTime}`).getTime()) : "Set reminder"}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{editFields.reminderOn ? "remove" : "+"}</span>
                    </button>
                    {editFields.reminderOn && (
                      <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
                        <input type="date" className="text-input" value={editFields.reminderDate} min={new Date().toISOString().slice(0,10)} onChange={e => setEditFields(f => ({ ...f, reminderDate: e.target.value }))} style={{ flex: 1.4 }} />
                        <input type="time" className="text-input" value={editFields.reminderTime} onChange={e => setEditFields(f => ({ ...f, reminderTime: e.target.value }))} style={{ flex: 1 }} />
                      </div>
                    )}
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
                    onBreakdown={handleBreakdown}
                    onSubStepToggle={handleSubStepToggle}
                    isBreakingDown={breakdownLoadingUuid === task.uuid}
                    onToggleMVD={handleToggleMVD}
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
            <button
              className="stuck-btn"
              onClick={() => { setRescueStep(0); setShowRescue(true); }}
              title="Feeling stuck? Get unstuck in 4 steps"
            >Stuck?</button>
            <button
              className="stuck-btn"
              onClick={() => {
                setIsTimerRunning(false);
                savePayload({ ...payload, tasks: tasks.map(t => t.uuid === activeTask.uuid ? { ...t, isNowFocus: false, lastUpdated: Date.now() } : t) });
              }}
              title="Unpin this task and close the timer"
              style={{ color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
            >✕ Unpin</button>
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
              <button className="control-btn control-btn-play" data-testid="timer-play-pause" onClick={() => setIsTimerRunning(!isTimerRunning)}>
                {isTimerRunning ? "⏸" : "▶"}
              </button>
              <button className="control-btn" onClick={() => { setIsTimerRunning(false); setTimerSecondsLeft(timerMaxSeconds); }}
                title="Reset timer" style={{ fontSize: "16px" }}>
                ↺
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

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {/* Inline rescue overlay — triggered by Stuck? button on focus card */}
      {showRescue && (
        <div className="rescue-overlay" onClick={() => setShowRescue(false)}>
          <div className="rescue-card card" onClick={e => e.stopPropagation()}>
            <span className="rescue-icon">⚠️</span>
            <h3 className="rescue-title">Getting Unstuck</h3>
            <span className="rescue-step-badge">Step {rescueStep + 1} of {rescueSteps.length}</span>
            <p className="rescue-step-text">{rescueSteps[rescueStep]}</p>
            <button
              className="btn"
              onClick={() => {
                if (rescueStep < rescueSteps.length - 1) setRescueStep(rescueStep + 1);
                else setShowRescue(false);
              }}
              style={{ width: "100%", marginTop: "10px" }}
            >
              {rescueStep === rescueSteps.length - 1 ? "I'm ready to try again" : "Next →"}
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
