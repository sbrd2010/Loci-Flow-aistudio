import React, { useState, useEffect, useRef } from "react";
import RescueMode from "./RescueMode";
import ConfirmDialog from "./ConfirmDialog";
import { safeUUID } from "../utils/uuid";
import { getAIKeys, callAI, extractJsonArray, hasAIKey } from "../utils/aiCall";
import { normalizeAiOrganizeSuggestions, buildClearedBrainDump, buildOrganizedTaskSubSteps, CATEGORY_ICONS } from "../utils/taskOps";
import { submitOnEnter } from "../utils/formEvents";
import { computeRitualSecondsLeft, nextRitualStep } from "../utils/ritualTimer";

function IconTrendingUp() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}
function IconSun() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function IconLifeBuoy() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="4"/>
      <line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/>
      <line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/>
      <line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/>
      <line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/>
    </svg>
  );
}
function IconRefreshCw() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}
function IconFeather() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
      <line x1="16" y1="8" x2="2" y2="22"/>
      <line x1="17.5" y1="15" x2="9" y2="15"/>
    </svg>
  );
}
function IconInbox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

export default function MindBoxTab({ payload, savePayload, saveSubPath, userProfile, initialPanel, onOpenRoadmapInbox, isSyncingFromCache = false, syncWarning = null }) {
  const { tasks = [], config = {}, contributions = [] } = payload;

  // ── State ──────────────────────────────────────────────────────────────────
  const [toolPanel, setToolPanel] = useState(initialPanel || null);
  const [editedAnchors, setEditedAnchors] = useState(config.dailyAnchors || []);
  const [newAnchorText, setNewAnchorText] = useState("");
  const [editingAnchorId, setEditingAnchorId] = useState(null);
  const [editAnchorText, setEditAnchorText] = useState("");
  const [ritualActive, setRitualActive] = useState(false);
  const [ritualStepIndex, setRitualStepIndex] = useState(-1);
  const [ritualSecondsLeft, setRitualSecondsLeft] = useState(0);
  const [ritualDone, setRitualDone] = useState(false);
  const [ritualSuccess, setRitualSuccess] = useState(false);
  const ritualIntervalRef = useRef(null);
  const stepEndAtRef = useRef(null);
  const [showRescue, setShowRescue] = useState(false);
  const [rescueStepIndex, setRescueStepIndex] = useState(0);
  const [rescueActive, setRescueActive] = useState(false);
  const [rescueTask, setRescueTask] = useState(null);
  const [brainDumpText, setBrainDumpText] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizeResults, setOrganizeResults] = useState([]);
  // Tracked separately from organizeResults — updateOrganizeResult/moveOrganizeResult
  // replace that array via map()/spread, which would drop an expando property.
  const [organizeDroppedSourceIds, setOrganizeDroppedSourceIds] = useState(new Set());
  const [organizeSelected, setOrganizeSelected] = useState(new Set());
  const [organizeError, setOrganizeError] = useState("");
  const [organizeExpandedIndex, setOrganizeExpandedIndex] = useState(null);
  const [organizeInvalidCount, setOrganizeInvalidCount] = useState(0);

  // ── Ritual data ────────────────────────────────────────────────────────────
  const ritualSteps = [
    { name: "Hydrate — drink a full glass of water", seconds: 60 },
    { name: "Stand & Stretch (touch toes)", seconds: 90 },
    { name: "Box Breathing (4-hold-4 cycle)", seconds: 90 },
    { name: "Write ONE intention for today", seconds: 60 },
    { name: "Scan your task list — pick 3 priorities", seconds: 30 },
    { name: "Pick your very first action NOW", seconds: 30 }
  ];
  const formatRitualTime = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  // ── Rescue steps ───────────────────────────────────────────────────────────
  const rescueSteps = [
    "Take one deep breath. Breathe in for 4, hold for 4, out for 4.",
    "What is the laughably smallest first step? A single sentence counts.",
    "Close all tabs that aren't this task right now.",
    "Commit to just 2 minutes. You can stop after that."
  ];

  useEffect(() => {
    setEditedAnchors(config.dailyAnchors || []);
  }, [config.dailyAnchors]);

  // ── Ritual timer (wall-clock anchored) ────────────────────────────────────
  // Keyed on [ritualActive, ritualStepIndex] only — no dependency on ritualSecondsLeft.
  // stepEndAtRef stores the absolute end time so background-tab drift is corrected
  // on every tick. Advancement happens inside the interval (not a second effect),
  // eliminating the stale-closure risk of calling handleAdvanceRitualStep from an effect.
  useEffect(() => {
    if (!ritualActive || ritualStepIndex < 0) {
      clearInterval(ritualIntervalRef.current);
      return;
    }
    stepEndAtRef.current = Date.now() + ritualSteps[ritualStepIndex].seconds * 1000;
    setRitualSecondsLeft(ritualSteps[ritualStepIndex].seconds);
    clearInterval(ritualIntervalRef.current);
    ritualIntervalRef.current = setInterval(() => {
      const remaining = computeRitualSecondsLeft(stepEndAtRef.current);
      setRitualSecondsLeft(remaining);
      if (remaining === 0) {
        clearInterval(ritualIntervalRef.current);
        const { done, nextIndex } = nextRitualStep(ritualStepIndex, ritualSteps.length);
        if (done) {
          setRitualActive(false);
          setRitualStepIndex(-1);
          setRitualSecondsLeft(0);
          setRitualDone(true);
        } else {
          // Set display immediately to avoid a 0:00 flash on the new step
          setRitualSecondsLeft(ritualSteps[nextIndex].seconds);
          setRitualStepIndex(nextIndex);
          // Effect re-runs for nextIndex, resets stepEndAtRef and creates new interval
        }
      }
    }, 1000);
    return () => clearInterval(ritualIntervalRef.current);
  }, [ritualActive, ritualStepIndex]);

  useEffect(() => {
    if (ritualDone) {
      saveSubPath("config", { ...config, totalXp: (Number(config.totalXp) || 0) + 80, lastUpdated: Date.now() });
      setRitualDone(false);
      setRitualSuccess(true);
      setTimeout(() => setRitualSuccess(false), 3500);
    }
  }, [ritualDone]);

  // ── AI keys ────────────────────────────────────────────────────────────────
  const { groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const hasAnyKey = hasAIKey();

  // ── Helper data ────────────────────────────────────────────────────────────
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
  const dumpCount = (payload.brainDump || []).length;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const openRescueMode = () => {
    const pinned = tasks.find(t => !t.isDeleted && !t.isCompleted && t.isNowFocus);
    const first = tasks.find(t => !t.isDeleted && !t.isCompleted);
    setRescueTask(pinned || first || null);
    setRescueActive(true);
  };


  const setRescueTaskAsNowFocus = ({ close = false } = {}) => {
    if (close) setRescueActive(false);
    if (!rescueTask) return;
    const now = Date.now();
    savePayload({ ...payload, tasks: tasks.map(t => {
      const newFocus = t.uuid === rescueTask.uuid;
      if (!newFocus) {
        if (!t.isNowFocus) return t;
        return { ...t, isNowFocus: false, lastUpdated: now };
      }
      // Also clear isParked — a task Rescue parked earlier in the same
      // session (or previously) would otherwise become a hidden focus task:
      // todayTasksAll filters parked tasks out of view, but useFocusTimer
      // still treats any non-deleted, non-completed isNowFocus task as active.
      if (t.isNowFocus && !t.isParked) return t;
      return { ...t, isNowFocus: true, isParked: false, lastUpdated: now };
    }) });
  };

  const parkRescueTask = () => {
    if (!rescueTask) return;
    const now = Date.now();
    savePayload({ ...payload, tasks: tasks.map(t => (
      t.uuid === rescueTask.uuid
        ? { ...t, isParked: true, isNowFocus: false, lastUpdated: now }
        : t
    )) });
  };

  const handleBadDayReset = () => {
    setConfirmDialog({
      message: "Park all active tasks for today?\n\nThis is a restart without shame — everything moves to parked. You can restore tasks from the AI Coach tab whenever you're ready.",
      confirmLabel: "Yes, restart", cancelLabel: "Not now",
      onConfirm: () => {
        savePayload({ ...payload, tasks: tasks.map(t => (!t.isCompleted && !t.isDeleted) ? { ...t, isParked: true, isNowFocus: false, lastUpdated: Date.now() } : t) });
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const handleCleanSlate = () => {
    setConfirmDialog({
      message: "Move today's unfinished tasks to this week?\n\nNothing is lost — you'll find them in Roadmap → This Week. Fresh start, no shame.",
      confirmLabel: "Fresh start", cancelLabel: "Keep today",
      onConfirm: () => {
        savePayload({ ...payload, tasks: tasks.map(t =>
          (!t.isCompleted && !t.isDeleted && t.horizonLevel === "today")
            ? { ...t, horizonLevel: "week", lastUpdated: Date.now() } : t
        )});
        setConfirmDialog(null);
      },
      onCancel: () => setConfirmDialog(null)
    });
  };

  const handleOrganizeDump = async () => {
    const brainDumpItems = payload.brainDump || [];
    if (!brainDumpItems.length) return;
    setOrganizeLoading(true);
    setOrganizeResults([]);
    setOrganizeDroppedSourceIds(new Set());
    setOrganizeError("");
    setOrganizeInvalidCount(0);
    setOrganizeSelected(new Set());
    setToolPanel("organize");

    const profile = userProfile;
    const profileNote = profile && profile.totalTasks >= 5
      ? `\nUser context: completion rate ${Math.round(profile.completionRate * 100)}%, dominant horizon "${profile.dominantHorizon}", avg estimate ${profile.avgEstimateMinutes}min. Weight horizon suggestions toward their patterns.`
      : "";
    // Include each item's stable ID so AI can return sourceId for safe brain-dump clearing
    const prompt = `Here are raw thoughts from a brain dump:
${brainDumpItems.map((item, i) => `${i + 1}. [id:${item.id}] ${item.text}`).join("\n")}

Turn these into clear, atomic, actionable tasks. For each numbered thought, decide:
- ONE task — a single small action with nothing else worth keeping
- ONE task with subSteps and/or sourceSummary — a single action that carries extra details worth preserving
- MULTIPLE tasks sharing the same sourceId — when a thought mixes several distinct, unrelated actions, OR is one big/messy item covering more ground than a single 10-45 min task. Split it into separate atomic tasks instead of one vague catch-all
- ONE practical next-step task — only for pure venting/emotional overwhelm with no concrete action in it. Turn it into a single small, low-shame, concrete next step

Hard rules:
- Never merge unrelated thoughts into one task, and never write a vague catch-all title like "Handle admin" or "Sort things out"
- Titles are action-style and specific (max 60 chars) — keep the concrete subject from the text: company, person, amount, place, deadline
- Every task has a concreteStep: the single easiest physical/digital first action (max 60 chars), e.g. "Email Priya at Acme re: June 20 deadline", not "Follow up"
- Preserve every concrete detail — names, dates, deadlines, companies, amounts, links, places, people, constraints, decision criteria. Never invent details that aren't in the original text. Anything that doesn't fit in the title/concreteStep goes in subSteps (2-7 short bullet points) and/or sourceSummary (1-2 sentences). Don't drop it
- Prefer 10-45 minute tasks; if a thought is too big for one, split it rather than writing one vague multi-hour task

For each task, return:
- sourceId: the id from the [id:...] tag of the thought it came from. Every task split from the same thought shares that sourceId
- title, concreteStep: as above
- subSteps: 2-7 {"text": "..."} items preserving details that don't fit above. [] if nothing else to preserve
- sourceSummary: optional 1-2 sentence summary of context/details from the thought that don't fit elsewhere. "" if not needed
- splitReason: only when this is one of several tasks from the same thought — a short phrase (max 40 chars), e.g. "Recruiter follow-up". Omit otherwise
- horizonLevel: "today" (due/urgent today), "week" (default, most items), "month" or "quarter" (career/job-search pipeline, concrete future plans), "office" (current job/lab/company work), "halfyear" (vague long-term ideas with no real timeline)
- priority: "P1" (urgent), "P2" (important), "P3" (normal), "P4" (quick, <15 min)
- category: "Career" (job search, CV, applications, networking, career growth), "Work" (current job/lab/company tasks), "Health" (medicine, diet, walking, doctor, body/health admin), "Personal" (household, family, travel, errands, life admin)
- timeEstimateMinutes: realistic estimate for concreteStep — one of 15, 25, 45, 60, 120, 240, 360; prefer 15-45${profileNote}

Rules: default horizonLevel to "week" unless clearly urgent or work-related. Never use the word "ADHD".

Return ONLY a JSON array, no markdown. Example showing a thought split into two tasks, each with preserved details:
[{"sourceId":"abc1","title":"Email Priya at Acme re June 20 deadline","horizonLevel":"week","priority":"P2","category":"Work","timeEstimateMinutes":25,"concreteStep":"Open email, write 3 sentences, hit send","subSteps":[{"text":"Mention the June 20 sprint deadline explicitly"},{"text":"Ask for the updated spec doc link"},{"text":"CC manager on the thread"}],"sourceSummary":"Priya at Acme needs a reply before their June 20 sprint planning; she asked about the API contract.","splitReason":"Recruiter follow-up"},{"sourceId":"abc1","title":"Update project tracker for Acme sprint","horizonLevel":"week","priority":"P3","category":"Work","timeEstimateMinutes":15,"concreteStep":"Open Notion, mark Acme block as 'waiting on response'","subSteps":[{"text":"Link the email thread in the tracker"},{"text":"Set a follow-up flag for June 19"}],"sourceSummary":"","splitReason":"Tracker update"}]`;

    try {
      const raw = await callAI({
        groqKey, nvidiaKey, geminiKey, cerebrasKey, zaiKey,
        systemPrompt: "You are a productivity coach. Respond ONLY with a valid JSON array, no markdown. Preserve every concrete detail from the input — never compress or summarize away names, dates, deadlines, amounts, or other specifics to save space.",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4000,
        reasoningEffort: "low"
      });
      const parsed = extractJsonArray(raw);
      const valid = normalizeAiOrganizeSuggestions(parsed, brainDumpItems);
      setOrganizeResults(valid);
      setOrganizeDroppedSourceIds(valid.droppedSourceIds || new Set());
      setOrganizeInvalidCount(valid.invalidCount || 0);
      setOrganizeSelected(new Set(valid.map((_, i) => i)));
      if (valid.length === 0) {
        setOrganizeError("AI couldn't turn that into tasks — try again, or add tasks manually.");
      }
    } catch (_) {
      setOrganizeError("Couldn't organize — try again, or add tasks manually.");
    } finally {
      setOrganizeLoading(false);
    }
  };

  const updateOrganizeResult = (i, field, value) => {
    setOrganizeResults(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  };

  const moveOrganizeResult = (i, dir) => {
    const j = dir === "up" ? i - 1 : i + 1;
    setOrganizeResults(prev => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setOrganizeSelected(prev => {
      const j2 = dir === "up" ? i - 1 : i + 1;
      const next = new Set(prev);
      const iSel = prev.has(i), jSel = prev.has(j2);
      if (iSel) next.add(j2); else next.delete(j2);
      if (jSel) next.add(i); else next.delete(i);
      return next;
    });
    if (organizeExpandedIndex === i) setOrganizeExpandedIndex(dir === "up" ? i - 1 : i + 1);
    else if (organizeExpandedIndex === (dir === "up" ? i - 1 : i + 1)) setOrganizeExpandedIndex(i);
  };

  const handleAddOrganizedTasks = () => {
    const toAdd = organizeResults.filter((_, i) => organizeSelected.has(i));
    if (!toAdd.length) return;
    const baseCounts = {};
    const newTasks = toAdd.map((t, i) => {
      const hl = t.horizonLevel;
      if (baseCounts[hl] === undefined)
        baseCounts[hl] = (payload.tasks || []).filter(x => x.horizonLevel === hl && !x.isDeleted).length;
      const orderIndex = baseCounts[hl]++;
      return {
        id: Date.now() + i,
        userId: payload.config?.userId || "",
        uuid: safeUUID(),
        title: t.title,
        concreteStep: t.concreteStep || "Start with the first step",
        horizonLevel: hl,
        priority: t.priority,
        category: t.category,
        timeEstimateMinutes: t.timeEstimateMinutes,
        deadlineTimestamp: null,
        reminderAt: null,
        isCompleted: false,
        isParked: false,
        isNowFocus: false,
        orderIndex,
        dateCompletedString: null,
        isDeleted: false,
        lastUpdated: Date.now(),
        ...(() => {
          const subSteps = buildOrganizedTaskSubSteps(t.subSteps, t.sourceSummary);
          return subSteps.length > 0 ? { subSteps } : {};
        })(),
      };
    });
    // Pass all suggestions (not just accepted) so a split entry's source is only
    // cleared once every suggestion generated from it has been accepted.
    const clearedDump = buildClearedBrainDump(payload.brainDump || [], toAdd, organizeResults, organizeDroppedSourceIds);
    savePayload({ ...payload, tasks: [...(payload.tasks || []), ...newTasks], brainDump: clearedDump });
    setToolPanel(null);
    setOrganizeResults([]);
    setOrganizeDroppedSourceIds(new Set());
    setOrganizeInvalidCount(0);
    setOrganizeSelected(new Set());
  };

  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;
    const currentDump = payload.brainDump || [];
    if (currentDump.length >= 50) return;
    savePayload({ ...payload, brainDump: [...currentDump, { id: safeUUID(), text: brainDumpText.trim(), createdAt: Date.now() }] });
    setBrainDumpText("");
  };

  const handleNextRescueStep = () => {
    if (rescueStepIndex < rescueSteps.length - 1) setRescueStepIndex(rescueStepIndex + 1);
    else { setShowRescue(false); setRescueStepIndex(0); }
  };

  const handleAdvanceRitualStep = () => {
    clearInterval(ritualIntervalRef.current);
    const { done, nextIndex } = nextRitualStep(ritualStepIndex, ritualSteps.length);
    if (done) {
      stepEndAtRef.current = null;
      setRitualActive(false);
      setRitualStepIndex(-1);
      setRitualSecondsLeft(0);
      setRitualDone(true);
    } else {
      setRitualStepIndex(nextIndex);
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
    stepEndAtRef.current = null;
    setRitualActive(false);
    setRitualStepIndex(-1);
    setRitualSecondsLeft(0);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const handleAddAnchor = () => {
    if (!newAnchorText.trim()) return;
    const next = [...editedAnchors, { id: safeUUID(), text: newAnchorText.trim() }];
    setEditedAnchors(next);
    setNewAnchorText("");
    saveSubPath("config", { ...config, dailyAnchors: next, lastUpdated: Date.now() });
  };

  const handleDeleteAnchor = (id) => {
    const next = editedAnchors.filter(a => a.id !== id);
    setEditedAnchors(next);
    saveSubPath("config", { ...config, dailyAnchors: next, lastUpdated: Date.now() });
  };

  const handleEditAnchorSave = (id) => {
    if (!editAnchorText.trim()) { setEditingAnchorId(null); return; }
    const next = editedAnchors.map(a => a.id === id ? { ...a, text: editAnchorText.trim() } : a);
    setEditedAnchors(next);
    setEditingAnchorId(null);
    saveSubPath("config", { ...config, dailyAnchors: next, lastUpdated: Date.now() });
  };

  return (
    <>
      {ritualSuccess && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "12px 24px", borderRadius: "20px", fontWeight: "700", fontSize: "14px", zIndex: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          Morning Ritual complete! +80 XP
        </div>
      )}

      {/* ── Sub-view: AI Organize Dump */}
      {toolPanel === "organize" && (
        <>
          <div className="mindbox-subview-header">
            <button className="mindbox-back-btn" onClick={() => { setToolPanel(null); setOrganizeResults([]); setOrganizeDroppedSourceIds(new Set()); setOrganizeError(""); setOrganizeInvalidCount(0); }}>← Back</button>
            <h2 className="mindbox-subview-title">Organize Dump</h2>
          </div>
          {organizeLoading && (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <p style={{ fontSize: "15px", fontWeight: "700", color: "var(--accent)" }}>✨ Organizing your thoughts…</p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>This takes a few seconds</p>
            </div>
          )}
          {!organizeLoading && organizeError && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ fontSize: "13px", color: "var(--danger)", fontWeight: "600" }}>{organizeError}</p>
              <button className="btn" onClick={handleOrganizeDump} style={{ marginTop: "16px", padding: "8px 24px" }}>Try again</button>
            </div>
          )}
          {!organizeLoading && !organizeError && organizeResults.length > 0 && (() => {
            const horizonOptions = ["today","week","month","quarter","halfyear","office"];
            const horizonLabel = { today: "Today", week: "This Week", month: "Month", quarter: "Quarter", halfyear: "6 Months", office: "Work" };
            const priorityOptions = ["P1","P2","P3","P4"];
            const categoryOptions = Object.keys(CATEGORY_ICONS);
            const timeEstimateOptions = [15, 25, 45, 60, 120, 240, 360];
            // Suggestions sharing a sourceId came from splitting one brain-dump entry
            const sourceCounts = {};
            organizeResults.forEach(t => { if (t.sourceId) sourceCounts[t.sourceId] = (sourceCounts[t.sourceId] || 0) + 1; });
            return (
              <>
                {organizeInvalidCount > 0 && (
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.4", margin: "0 0 8px" }}>
                    ℹ️ {organizeInvalidCount} suggestion{organizeInvalidCount !== 1 ? "s" : ""} from the AI {organizeInvalidCount !== 1 ? "were" : "was"} incomplete and skipped.
                  </p>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                    Tap card to select · ✎ to edit · ↑↓ to reorder
                  </p>
                  <button
                    type="button"
                    onClick={() => { setOrganizeSelected(new Set(organizeResults.map((_, i) => i))); }}
                    style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", whiteSpace: "nowrap" }}
                  >Select all</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                  {organizeResults.map((t, i) => {
                    const isSelected = organizeSelected.has(i);
                    const isExpanded = organizeExpandedIndex === i;
                    return (
                      <div
                        key={i}
                        style={{
                          background: isSelected ? "var(--accent-ring, rgba(99,102,241,0.08))" : "var(--bg-card)",
                          border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                          borderRadius: "12px", overflow: "hidden", transition: "border-color 0.15s"
                        }}
                      >
                        {/* Card header row */}
                        <div
                          onClick={() => { const next = new Set(organizeSelected); isSelected ? next.delete(i) : next.add(i); setOrganizeSelected(next); }}
                          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "11px 12px", cursor: "pointer" }}
                        >
                          <span className={`priority-badge ${t.priority.toLowerCase()}`}>{t.priority}</span>
                          <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>{horizonLabel[t.horizonLevel] || t.horizonLevel}</span>
                          {CATEGORY_ICONS[t.category] && (
                            <span style={{ fontSize: "13px", flexShrink: 0 }} title={t.category}>{CATEGORY_ICONS[t.category]}</span>
                          )}
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", flex: 1, lineHeight: "1.3", minWidth: 0 }}>{t.title}</span>
                          {/* Sort buttons */}
                          <button onClick={e => { e.stopPropagation(); moveOrganizeResult(i, "up"); }} disabled={i === 0}
                            style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", fontSize: "13px", color: i === 0 ? "var(--border)" : "var(--text-muted)", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>↑</button>
                          <button onClick={e => { e.stopPropagation(); moveOrganizeResult(i, "down"); }} disabled={i === organizeResults.length - 1}
                            style={{ background: "none", border: "none", cursor: i === organizeResults.length - 1 ? "default" : "pointer", fontSize: "13px", color: i === organizeResults.length - 1 ? "var(--border)" : "var(--text-muted)", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>↓</button>
                          {/* Edit toggle */}
                          <button onClick={e => { e.stopPropagation(); setOrganizeExpandedIndex(isExpanded ? null : i); }}
                            style={{ background: isExpanded ? "var(--accent-ring)" : "none", border: "none", cursor: "pointer", fontSize: "14px", color: isExpanded ? "var(--accent)" : "var(--text-muted)", padding: "2px 4px", borderRadius: "5px", lineHeight: 1, flexShrink: 0 }}>✎</button>
                          <span style={{ fontSize: "16px", color: isSelected ? "var(--accent)" : "var(--border)", flexShrink: 0 }}>{isSelected ? "✓" : "○"}</span>
                        </div>
                        {/* Split-from-same-entry indicator */}
                        {t.sourceId && sourceCounts[t.sourceId] > 1 && (
                          <p style={{ fontSize: "11px", color: "var(--accent)", fontWeight: "600", margin: "0 12px 10px", lineHeight: "1.4" }}>
                            🔗 Split from same brain dump{t.splitReason ? ` · ${t.splitReason}` : ""}
                          </p>
                        )}
                        {/* Concrete step + time estimate */}
                        {!isExpanded && (
                          <p style={{ fontSize: "11.5px", color: "var(--text-muted)", margin: "0 12px 10px", lineHeight: "1.4" }}>
                            {t.concreteStep && <>⚡ {t.concreteStep} · </>}⏱ {t.timeEstimateMinutes}m
                          </p>
                        )}
                        {/* Preserved context from the original brain dump entry */}
                        {t.sourceSummary && !isExpanded && (
                          <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "0 12px 10px", lineHeight: "1.4", fontStyle: "italic" }}>💬 {t.sourceSummary}</p>
                        )}
                        {/* Preserved key points indicator */}
                        {t.subSteps && t.subSteps.length > 0 && !isExpanded && (
                          <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "0 12px 10px", lineHeight: "1.4" }}>📋 {t.subSteps.length} detail{t.subSteps.length !== 1 ? "s" : ""} preserved</p>
                        )}
                        {/* Inline edit panel */}
                        {isExpanded && (
                          <div style={{ borderTop: "1px solid var(--border)", padding: "12px", display: "flex", flexDirection: "column", gap: "10px", background: "var(--bg-secondary)" }}>
                            <input
                              className="text-input"
                              value={t.title}
                              onChange={e => updateOrganizeResult(i, "title", e.target.value)}
                              placeholder="Task title"
                              style={{ fontSize: "13px", marginBottom: 0 }}
                              onClick={e => e.stopPropagation()}
                            />
                            <input
                              className="text-input"
                              value={t.concreteStep || ""}
                              onChange={e => updateOrganizeResult(i, "concreteStep", e.target.value)}
                              placeholder="⚡ First action step (optional)"
                              style={{ fontSize: "12px", marginBottom: 0 }}
                              onClick={e => e.stopPropagation()}
                            />
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {priorityOptions.map(p => (
                                <button key={p} type="button" onClick={e => { e.stopPropagation(); updateOrganizeResult(i, "priority", p); }}
                                  style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "800", cursor: "pointer", border: t.priority === p ? "2px solid var(--accent)" : "1.5px solid var(--border)", background: t.priority === p ? "var(--accent)" : "var(--bg-card)", color: t.priority === p ? "#fff" : "var(--text-secondary)" }}>
                                  {p}
                                </button>
                              ))}
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", alignSelf: "center", marginLeft: "4px" }}>priority</span>
                            </div>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {horizonOptions.map(h => (
                                <button key={h} type="button" onClick={e => { e.stopPropagation(); updateOrganizeResult(i, "horizonLevel", h); }}
                                  style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "700", cursor: "pointer", border: t.horizonLevel === h ? "2px solid var(--accent)" : "1.5px solid var(--border)", background: t.horizonLevel === h ? "var(--accent)" : "var(--bg-card)", color: t.horizonLevel === h ? "#fff" : "var(--text-secondary)" }}>
                                  {horizonLabel[h]}
                                </button>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {categoryOptions.map(c => (
                                <button key={c} type="button" onClick={e => { e.stopPropagation(); updateOrganizeResult(i, "category", c); }}
                                  style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "700", cursor: "pointer", border: t.category === c ? "2px solid var(--accent)" : "1.5px solid var(--border)", background: t.category === c ? "var(--accent)" : "var(--bg-card)", color: t.category === c ? "#fff" : "var(--text-secondary)" }}>
                                  {CATEGORY_ICONS[c]} {c}
                                </button>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {timeEstimateOptions.map(m => (
                                <button key={m} type="button" onClick={e => { e.stopPropagation(); updateOrganizeResult(i, "timeEstimateMinutes", m); }}
                                  style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "700", cursor: "pointer", border: t.timeEstimateMinutes === m ? "2px solid var(--accent)" : "1.5px solid var(--border)", background: t.timeEstimateMinutes === m ? "var(--accent)" : "var(--bg-card)", color: t.timeEstimateMinutes === m ? "#fff" : "var(--text-secondary)" }}>
                                  ⏱ {m}m
                                </button>
                              ))}
                            </div>
                            {t.subSteps && t.subSteps.length > 0 && (
                              <div onClick={e => e.stopPropagation()}>
                                <label style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "4px" }}>Key points ({t.subSteps.length})</label>
                                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                  {t.subSteps.map((s, si) => (
                                    <div key={s.id || si} style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", gap: "6px", padding: "2px 0" }}>
                                      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>·</span>
                                      <span>{s.text}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  className="btn"
                  onClick={handleAddOrganizedTasks}
                  disabled={organizeSelected.size === 0}
                  style={{ width: "100%", fontSize: "14px", fontWeight: "700", padding: "13px" }}
                >
                  Add {organizeSelected.size} task{organizeSelected.size !== 1 ? "s" : ""} to my plan
                </button>
              </>
            );
          })()}
        </>
      )}

      {/* ── Sub-view: Daily Anchors */}
      {toolPanel === "anchors" && (
        <>
          <div className="mindbox-subview-header">
            <button className="mindbox-back-btn" onClick={() => { setToolPanel(null); setEditingAnchorId(null); }}>&#8592; Back</button>
            <h2 className="mindbox-subview-title">Daily Anchors</h2>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px", lineHeight: "1.5" }}>
            Short principles to keep front of mind. Aim for 3&#8211;7. Short phrases work best.
          </p>
          {editedAnchors.length === 0 && (
            <p style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
              No anchors yet. Add your first one below.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
            {editedAnchors.map(a => (
              <div key={a.id} className="anchor-edit-row">
                {editingAnchorId === a.id ? (
                  <input
                    className="anchor-edit-input"
                    autoFocus
                    value={editAnchorText}
                    onChange={e => setEditAnchorText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleEditAnchorSave(a.id);
                      if (e.key === "Escape") setEditingAnchorId(null);
                    }}
                    maxLength={80}
                  />
                ) : (
                  <span
                    className="anchor-edit-text"
                    onClick={() => { setEditingAnchorId(a.id); setEditAnchorText(a.text); }}
                    title="Tap to edit"
                  >{a.text}</span>
                )}
                <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                  {editingAnchorId === a.id ? (
                    <button className="anchor-save-btn" onClick={() => handleEditAnchorSave(a.id)}>Save</button>
                  ) : (
                    <button className="anchor-edit-btn" onClick={() => { setEditingAnchorId(a.id); setEditAnchorText(a.text); }} aria-label="Edit">&#9998;</button>
                  )}
                  <button className="anchor-delete-btn" onClick={() => handleDeleteAnchor(a.id)} aria-label="Delete">&#215;</button>
                </div>
              </div>
            ))}
          </div>
          <div className="anchor-add-row">
            <input
              className="anchor-input"
              type="text"
              placeholder="Type a new anchor&#8230;"
              value={newAnchorText}
              onChange={e => setNewAnchorText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddAnchor()}
              maxLength={80}
            />
            <button className="anchor-add-btn" onClick={handleAddAnchor} disabled={!newAnchorText.trim()}>Add</button>
          </div>
        </>
      )}

      {/* ── Sub-view: 7-Day Progress */}
      {toolPanel === "progress" && (() => {
        const currentXp = Number(config.totalXp) || 0;
        const xpInLevel = currentXp % 200;
        const levelNum = Math.floor(currentXp / 200) + 1;
        const levelProgress = (xpInLevel / 200) * 100;
        const levelTitles = ["Focus Seed", "Inertia Crusher", "Momentum Builder", "Flow Finder", "Deep Worker", "Focus Master"];
        const levelTitle = levelTitles[Math.min(levelNum - 1, levelTitles.length - 1)];
        const totalDone = tasks.filter(t => !t.isDeleted && t.isCompleted).length;
        const activeDays = bentoDays.filter(d => d.count > 0).length;
        return (
          <>
            <div className="mindbox-subview-header">
              <button className="mindbox-back-btn" onClick={() => setToolPanel(null)}>← Back</button>
              <h2 className="mindbox-subview-title">7-Day Progress</h2>
            </div>

            {/* Streak + bento */}
            <div style={{ textAlign: "center", padding: "16px 0 20px" }}>
              <span style={{ fontSize: "clamp(48px, 14vw, 72px)", fontWeight: "700", color: "var(--accent)", lineHeight: "1", fontFamily: "var(--font-mono)" }}>
                {config.visitStreakCount || 0}
              </span>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "4px", marginBottom: "20px" }}>
                day streak 🔥
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "8px" }}>
                {bentoDays.map((day, i) => {
                  const isToday = i === 6;
                  const count = day.count;
                  const intensity = count === 0 ? 0 : count < 2 ? 0.45 : count < 4 ? 0.7 : 1;
                  return (
                    <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                      <div style={{
                        width: isToday ? "36px" : "28px", height: isToday ? "36px" : "28px",
                        borderRadius: "50%",
                        background: count > 0 ? `rgba(99,102,241,${intensity})` : "var(--bg-secondary)",
                        border: isToday ? "2.5px solid var(--accent)" : "2px solid var(--border)",
                        transition: "all 0.2s",
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        {count > 0 && <span style={{ fontSize: "9px", fontWeight: "800", color: "#fff" }}>{count}</span>}
                      </div>
                      <span style={{ fontSize: "9px", fontWeight: isToday ? "900" : "600", color: isToday ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" }}>{day.label}</span>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>Each circle shows tasks completed that day</p>
            </div>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "16px" }}>
              {[
                { label: "Total XP", value: currentXp, color: "var(--accent)" },
                { label: "Tasks Done", value: totalDone, color: "var(--success)" },
                { label: "Days Active", value: activeDays, color: "var(--text-primary)" }
              ].map(stat => (
                <div key={stat.label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: "22px", fontWeight: "900", color: stat.color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>{stat.value}</div>
                  <div style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "4px" }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* XP Level card */}
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                <div>
                  <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--text-primary)" }}>{levelTitle}</span>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", marginLeft: "6px" }}>L{levelNum}</span>
                </div>
                <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{xpInLevel}/200 XP</span>
              </div>
              <div className="progress-track" style={{ height: "7px", marginBottom: "12px" }}>
                <div className="progress-bar" style={{ width: `${levelProgress}%` }} />
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--text-muted)", lineHeight: "1.55" }}>
                <strong style={{ color: "var(--text-secondary)" }}>How you earn XP:</strong> Complete a task (+20 XP) · Complete a Roadmap task (+100 XP) · Finish Morning Ritual (+80 XP). Levels reset every 200 XP — your total keeps growing.
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Sub-view: Morning Ritual */}
      {toolPanel === "ritual" && (
        <>
          <div className="mindbox-subview-header">
            <button className="mindbox-back-btn" onClick={() => setToolPanel(null)}>← Back</button>
            <h2 className="mindbox-subview-title">Morning Ritual</h2>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ritualActive ? "20px" : "16px" }}>
              <div>
                <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", margin: "0 0 3px" }}>Start your day with intention</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>6 steps · ~7 min · +80 XP</p>
              </div>
              {!ritualActive ? (
                <button className="btn" onClick={handleBeginRitual} style={{ padding: "8px 22px", fontSize: "13px", fontWeight: "700", flexShrink: 0 }}>Begin</button>
              ) : (
                <button onClick={handleAbortRitual} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: "13px", fontWeight: "700", cursor: "pointer", flexShrink: 0 }}>Stop</button>
              )}
            </div>
            {!ritualActive && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {ritualSteps.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-muted)", minWidth: "18px", paddingTop: "2px" }}>{i + 1}.</span>
                    <div>
                      <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 2px", fontWeight: "600" }}>{step.name}</p>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{formatRitualTime(step.seconds)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ritualActive && (
              <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", fontWeight: "800", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    STEP {ritualStepIndex + 1} OF {ritualSteps.length}
                  </span>
                  <div style={{ display: "flex", gap: "5px" }}>
                    {ritualSteps.map((_, i) => (
                      <div key={i} style={{ width: "7px", height: "7px", borderRadius: "50%", background: i <= ritualStepIndex ? "var(--accent)" : "var(--border)" }} />
                    ))}
                  </div>
                </div>
                <p style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)", margin: 0, lineHeight: "1.45" }}>
                  {ritualSteps[ritualStepIndex].name}
                </p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "30px", fontWeight: "900", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    {formatRitualTime(ritualSecondsLeft)}
                  </span>
                  <button className="btn" onClick={handleAdvanceRitualStep} style={{ padding: "6px 18px", fontSize: "12px" }}>Skip →</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Main grid view */}
      {!toolPanel && (
        <>
          <div style={{ padding: "0 0 20px 0" }}>
            <h2 style={{ fontSize: "20px", fontWeight: "800", color: "var(--text-primary)", fontFamily: "var(--font-display)", letterSpacing: "-0.02em", margin: "0 0 4px" }}>Mind Box</h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Tools, streaks &amp; resets.</p>
          </div>

          {/* Brain Dump — always-live capture */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <span className="mindbox-card-icon mindbox-card-icon--secondary" style={{ width: "36px", height: "36px", borderRadius: "9px" }}>
                <IconInbox />
              </span>
              <span style={{ fontSize: "14px", fontWeight: "800", color: "var(--text-primary)" }}>Brain Dump</span>
              {dumpCount > 0 && (
                <button
                  type="button"
                  data-testid="brain-dump-inbox-btn"
                  onClick={() => onOpenRoadmapInbox?.()}
                  style={{ fontSize: "11px", color: dumpCount >= 50 ? "var(--danger)" : "var(--accent)", fontWeight: "700", marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: "10px 12px", minHeight: "44px", textAlign: "right" }}
                >
                  {dumpCount} note{dumpCount === 1 ? "" : "s"} → Roadmap Inbox
                </button>
              )}
            </div>
            <form className="braindump-form" onSubmit={handleBrainDumpSubmit}>
              <textarea className="braindump-input" rows={3}
                placeholder="What's on your mind? (Shift+Enter for a new line)"
                value={brainDumpText}
                onChange={e => setBrainDumpText(e.target.value)}
                onKeyDown={submitOnEnter}
                disabled={dumpCount >= 50} />
              <button type="submit" className="braindump-submit" disabled={dumpCount >= 50}>➔</button>
            </form>
            {dumpCount > 0 && hasAnyKey && (
              <button
                type="button"
                onClick={handleOrganizeDump}
                disabled={organizeLoading}
                style={{
                  marginTop: "10px", width: "100%", padding: "9px",
                  background: "var(--accent-ring, rgba(99,102,241,0.08))", color: "var(--accent)",
                  border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)",
                  fontSize: "13px", fontWeight: "700", cursor: "pointer"
                }}
              >
                ✨ Organize into tasks with AI
              </button>
            )}
          </div>

          {/* 2×2 tool grid */}
          <div className="mindbox-grid">
            <button className="mindbox-card" onClick={() => setToolPanel("progress")}>
              <span className="mindbox-card-icon mindbox-card-icon--accent"><IconTrendingUp /></span>
              <span className="mindbox-card-body">
                <span className="mindbox-card-title">Progress</span>
                <span className="mindbox-card-sub">{config.visitStreakCount || 0}-day streak</span>
              </span>
              <span className="mindbox-card-chevron"><IconChevronRight /></span>
            </button>
            <button className="mindbox-card" onClick={() => setToolPanel("ritual")}>
              <span className="mindbox-card-icon mindbox-card-icon--warning"><IconSun /></span>
              <span className="mindbox-card-body">
                <span className="mindbox-card-title">Morning Ritual</span>
                <span className="mindbox-card-sub">7 min · +80 XP</span>
              </span>
              <span className="mindbox-card-chevron"><IconChevronRight /></span>
            </button>
            <button className="mindbox-card mindbox-card--rescue" onClick={openRescueMode}>
              <span className="mindbox-card-icon mindbox-card-icon--danger"><IconLifeBuoy /></span>
              <span className="mindbox-card-body">
                <span className="mindbox-card-title">Rescue Mode</span>
                <span className="mindbox-card-sub">Step-by-step reset</span>
              </span>
              <span className="mindbox-card-chevron"><IconChevronRight /></span>
            </button>
            <button className="mindbox-card" onClick={handleBadDayReset}>
              <span className="mindbox-card-icon mindbox-card-icon--secondary"><IconRefreshCw /></span>
              <span className="mindbox-card-body">
                <span className="mindbox-card-title">Bad Day Reset</span>
                <span className="mindbox-card-sub">Restart without shame</span>
              </span>
              <span className="mindbox-card-chevron"><IconChevronRight /></span>
            </button>
            <button className="mindbox-card" onClick={() => setToolPanel("anchors")} style={{ gridColumn: "span 2" }}>
              <span className="mindbox-card-icon mindbox-card-icon--accent" style={{ fontSize: "18px", lineHeight: 1 }}>&#128204;</span>
              <span className="mindbox-card-body">
                <span className="mindbox-card-title">Daily Anchors</span>
                <span className="mindbox-card-sub">
                  {(config.dailyAnchors || []).length === 0
                    ? "Add your daily principles"
                    : `${(config.dailyAnchors || []).length} anchor${(config.dailyAnchors || []).length === 1 ? "" : "s"}`}
                </span>
              </span>
              <span className="mindbox-card-chevron"><IconChevronRight /></span>
            </button>
            <button className="mindbox-card" onClick={handleCleanSlate} style={{ gridColumn: "span 2" }}>
              <span className="mindbox-card-icon mindbox-card-icon--success"><IconFeather /></span>
              <span className="mindbox-card-body">
                <span className="mindbox-card-title">Clean Slate</span>
                <span className="mindbox-card-sub">Move today's tasks to this week — nothing lost, fresh start</span>
              </span>
              <span className="mindbox-card-chevron"><IconChevronRight /></span>
            </button>
          </div>
        </>
      )}

      {/* ── Stuck Rescue Modal */}
      {showRescue && (
        <div className="rescue-overlay" onClick={() => setShowRescue(false)}>
          <div className="rescue-card card" onClick={e => e.stopPropagation()}>
            <span className="rescue-icon">⚠️</span>
            <h3 className="rescue-title">Rescue Mode</h3>
            <span className="rescue-step-badge">Step {rescueStepIndex + 1} of {rescueSteps.length}</span>
            <p className="rescue-step-text">{rescueSteps[rescueStepIndex]}</p>
            <button className="btn" onClick={handleNextRescueStep} style={{ width: "100%", marginTop: "10px" }}>
              {rescueStepIndex === rescueSteps.length - 1 ? "I'm ready to try again" : "Next →"}
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
          config={config}
          entryPoint="mindbox"
          includeMemory={!(isSyncingFromCache || syncWarning === "offline")}
          isSyncingFromCache={isSyncingFromCache}
          syncWarning={syncWarning}
          apiKey={getAIKeys().geminiKey}
          onDismiss={() => setRescueActive(false)}
          onSetNowFocus={() => setRescueTaskAsNowFocus()}
          onParkTask={parkRescueTask}
          onAccept={() => setRescueTaskAsNowFocus({ close: true })}
        />
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </>
  );
}
