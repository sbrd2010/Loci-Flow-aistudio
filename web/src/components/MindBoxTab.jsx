import React, { useState, useEffect, useRef } from "react";
import GrowTextarea from "./ui/GrowTextarea";
import { safeUUID } from "../utils/uuid";
import { getAIKeys, callAI, extractJsonArray, hasAIKey } from "../utils/aiCall";
import { normalizeAiOrganizeSuggestions, buildClearedBrainDump, buildOrganizedTaskSubSteps, CATEGORY_ICONS } from "../utils/taskOps";
import { computeRitualSecondsLeft, nextRitualStep } from "../utils/ritualTimer";
import { getFocusWindows } from "../utils/focusWindows";
import { buildTaskMutationEvent, eventsPatch } from "../utils/activityLog";
import { THOUGHTS_MAX, addThought, letGoThought, restoreThought } from "../utils/thoughts";
import ThoughtsList from "./ThoughtsList";
import { RESCUE_STATES } from "./RescueMode";
import "../styles/mindBox.css";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import "../styles/thoughts.css";

export default function MindBoxTab({ payload, savePayload, savePayloadAsync, saveConfigPatch, userProfile, initialPanel, onMakeThoughtTask, onOpenRescue, isSyncingFromCache = false, syncWarning = null, uid, writeActivityEvents, focusTimer = {} }) {
  const { config = {} } = payload;
  const windows = getFocusWindows(config);

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
  const [brainDumpText, setBrainDumpText] = useState("");
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
      saveConfigPatch?.({ morningRitualDoneAt: Date.now() });
      setRitualDone(false);
      setRitualSuccess(true);
      setTimeout(() => setRitualSuccess(false), 3500);
    }
  }, [ritualDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI keys ────────────────────────────────────────────────────────────────
  const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const hasAnyKey = hasAIKey();

  // ── Helper data ────────────────────────────────────────────────────────────
  const dumpCount = (payload.brainDump || []).length;

  // ── Handlers ───────────────────────────────────────────────────────────────
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
        groqKey, geminiKey, cerebrasKey, zaiKey,
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
    const events = newTasks.map((t) => buildTaskMutationEvent("task_created", t, { windows, source: "coach_action" }));
    savePayloadAsync({ ...payload, tasks: [...(payload.tasks || []), ...newTasks], brainDump: clearedDump })
      .then(() => writeActivityEvents(eventsPatch(uid, events)))
      .catch(() => {});
    setToolPanel(null);
    setOrganizeResults([]);
    setOrganizeDroppedSourceIds(new Set());
    setOrganizeInvalidCount(0);
    setOrganizeSelected(new Set());
  };

  const handleBrainDumpSubmit = (e) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;
    const added = addThought(payload, brainDumpText);
    if (!added) return;
    savePayload(added.payload);
    setBrainDumpText("");
  };

  // Let go (Q56.2): the thought goes at once, with Undo.
  const [letGoUndo, setLetGoUndo] = useState(null);
  const handleLetGo = (thought) => {
    const gone = letGoThought(payload, thought.id);
    if (!gone) return;
    // An Undo that found Mind Box full comes back into the freed place.
    const waiting = letGoUndo?.full ? restoreThought(gone.payload, letGoUndo.item, letGoUndo.at) : null;
    savePayload(waiting || gone.payload);
    setLetGoUndo({ item: gone.item, at: gone.at, key: Date.now() });
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

  // Morning ritual (55.1): first while not done and before noon; after that
  // it sits below Anchors, saying when it was done.
  const ritualDoneToday = Number.isFinite(config.morningRitualDoneAt)
    && new Date(config.morningRitualDoneAt).toDateString() === new Date().toDateString();
  const ritualFirst = !ritualDoneToday && new Date().getHours() < 12;
  const ritualStatus = ritualDoneToday
    ? `Done today ${new Date(config.morningRitualDoneAt).toTimeString().slice(0, 5)}`
    : ritualFirst ? "Not done today · 7 min" : "Tomorrow morning · 7 min";
  const ritualRow = (
    <div className={`mbx-ritual${ritualFirst ? " is-first" : ""}`}>
      <div className="mbx-ritual-text">
        <h3 className="mbx-h-small">Morning ritual</h3>
        <span className="mbx-quiet-line">{ritualStatus}</span>
      </div>
      <button type="button" className="mbx-begin" onClick={() => setToolPanel("ritual")}>{ritualDoneToday ? "Again" : "Begin"}</button>
    </div>
  );
  const anchorList = (config.dailyAnchors || []).filter(a => a && typeof a.text === "string" && a.text.trim());

  // ── Render ─────────────────────────────────────────────────────────────────
  const handleAddAnchor = () => {
    if (!newAnchorText.trim()) return;
    const next = [...editedAnchors, { id: safeUUID(), text: newAnchorText.trim() }];
    setEditedAnchors(next);
    setNewAnchorText("");
    saveConfigPatch({ dailyAnchors: next });
  };

  const handleDeleteAnchor = (id) => {
    const next = editedAnchors.filter(a => a.id !== id);
    setEditedAnchors(next);
    saveConfigPatch({ dailyAnchors: next });
  };

  const handleEditAnchorSave = (id) => {
    if (!editAnchorText.trim()) { setEditingAnchorId(null); return; }
    const next = editedAnchors.map(a => a.id === id ? { ...a, text: editAnchorText.trim() } : a);
    setEditedAnchors(next);
    setEditingAnchorId(null);
    saveConfigPatch({ dailyAnchors: next });
  };

  return (
    <>
      {ritualSuccess && (
        <div style={{ position: "fixed", top: "80px", left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "12px 24px", borderRadius: "20px", fontWeight: "700", fontSize: "14px", zIndex: 300, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          Morning Ritual complete!
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
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>6 steps · ~7 min</p>
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

      {/* ── The page (Q55.1a, frames 65a–f): Rescue, then Empty your head,
          then the quiet column (Morning ritual, Anchors). One focal point. */}
      {!toolPanel && (
        <div className="mbx">
          <div className="mbx-title">
            <h2 className="mbx-name">Mind Box</h2>
            <span className="mbx-sub">For your head, not your tasks.</span>
          </div>
          <div className="mbx-grid">
            <section className="mbx-rescue" aria-labelledby="mbx-rescue-title">
              <span className="mbx-kicker">RESCUE · 3 MIN</span>
              <h3 className="mbx-rescue-title" id="mbx-rescue-title">Head not ready to work?</h3>
              <p className="mbx-rescue-line">Pick what’s closest.</p>
              <div className="mbx-states">
                {RESCUE_STATES.map(st => (
                  <button key={st.id} type="button" className="mbx-state" onClick={() => onOpenRescue?.(st.id)}>
                    <span className="mbx-state-title">{st.title}</span>
                    <span className="mbx-state-sub">{st.sub}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="mbx-link" onClick={() => onOpenRescue?.("unsure")}>Not sure. Just help me settle →</button>
            </section>

            <section className="mbx-dump" aria-labelledby="mbx-dump-title">
              <div className="mbx-dump-head">
                <h3 className="mbx-h" id="mbx-dump-title">Empty your head</h3>
                <p className="mbx-dump-line">Get it out now. Sort it later.</p>
              </div>
              <form className="mbx-field" onSubmit={handleBrainDumpSubmit}>
                <GrowTextarea
                  className="mbx-input"
                  aria-label="Thought"
                  placeholder="What’s on your mind?"
                  value={brainDumpText}
                  maxRows={5}
                  onEnter={e => e.currentTarget.form?.requestSubmit()}
                  onChange={e => setBrainDumpText(e.target.value)}
                  disabled={dumpCount >= THOUGHTS_MAX}
                />
                <span className="mbx-hint" aria-hidden="true">T · ENTER</span>
                <button type="submit" className="mbx-sr" disabled={dumpCount >= THOUGHTS_MAX}>Save thought</button>
              </form>
              <ThoughtsList thoughts={payload.brainDump || []} onMakeTask={t => onMakeThoughtTask?.(t)} onLetGo={handleLetGo} />
              {dumpCount > 0 && hasAnyKey && (
                <button type="button" className="mbx-link" onClick={handleOrganizeDump} disabled={organizeLoading}>
                  {organizeLoading ? "Organizing…" : "Organize into tasks with AI"}
                </button>
              )}
            </section>

            <aside className="mbx-quiet" aria-label="Morning ritual and anchors">
              {ritualFirst && ritualRow}
              <div className="mbx-anchors">
                <div className="mbx-row-head">
                  <h3 className="mbx-h-small">Anchors</h3>
                  <button type="button" className="mbx-link" onClick={() => setToolPanel("anchors")}>Edit</button>
                </div>
                {anchorList.length ? (
                  <ul className="mbx-anchor-list">
                    {anchorList.map(a => <li key={a.id || a.text} className="mbx-anchor">{a.text}</li>)}
                  </ul>
                ) : (
                  <p className="mbx-quiet-line">Small daily reminders. Add a few.</p>
                )}
              </div>
              {!ritualFirst && ritualRow}
            </aside>
          </div>
        </div>
      )}

      <UndoAnnouncer message={letGoUndo ? (letGoUndo.full ? "Mind Box is full. Let one go to bring this back" : `Let go: ${letGoUndo.item.text}`) : ""} />
      {letGoUndo && (
        <UndoToast
          key={letGoUndo.key}
          message={letGoUndo.full ? `Mind Box is full. Let one go to bring this back.` : `Let go: ${letGoUndo.item.text}`}
          onUndo={() => {
            const back = restoreThought(payload, letGoUndo.item, letGoUndo.at);
            if (!back) { setLetGoUndo(u => ({ ...u, full: true, key: Date.now() })); return; }
            savePayload(back);
            setLetGoUndo(null);
          }}
          onClose={() => setLetGoUndo(null)}
        />
      )}
    </>
  );
}
