import React, { useEffect, useState, useRef } from "react";
import { callAI, getAIKeys, buildProviderOrder } from "../utils/aiCall";
import { buildLocalSafetyReply, buildOfflineRescueReply, buildRescuePrompt, filterApplicableRescueActions, parseRescueActionTags } from "../utils/rescueCoachPrompt";
import { buildRescueHandoffSummary } from "../utils/rescueHandoff";
import { CLEAR_DESTINATIONS, clearMyDayPlan } from "../utils/clearMyDay";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import "../styles/rescue.css";

// Rescue (Q55.3, frames 64g–p): full screen in the current theme, nav hidden.
// 1 What's happening → 2 one minute of box breathing → 3 three things to try
// → 4 Where to now? (Back to it, or a 10-minute break). Clear my day (Q52)
// opens inside step 3. The chat is the old Rescue chat, safety reply and all.

export const RESCUE_STATES = [
  { id: "overwhelmed", title: "Too much going on", sub: "Everything at once, nothing moving" },
  { id: "tired", title: "Low energy, foggy", sub: "Tired, slow, can’t think" },
  { id: "anxious", title: "Anxious, can’t start", sub: "Dread, avoiding the task" },
  { id: "distracted", title: "Got distracted", sub: "Lost the thread, drifting" },
];

const OPTIONS = {
  overwhelmed: [
    { id: "clear", title: "Clear my day", min: "1 MIN", sub: "Move what’s left so only one thing stays. Undo for 5 seconds." },
    { id: "focus25", title: "One thing, 25 minutes", min: "25 MIN", sub: "Pick the task that matters most. Everything else waits." },
    { id: "empty", title: "Empty your head", min: "2 MIN", sub: "Two minutes of writing every loose thought down. It all goes to Mind Box." },
  ],
  tired: [
    { id: "break", title: "10-minute break", min: "10 MIN", sub: "Water, stand up, look away from the screen." },
    { id: "focus5", title: "Make the step 5 minutes", min: "5 MIN", sub: "Five minutes on the one thing. Stop after if you need to." },
    { id: "easiest", title: "Pick the easiest task", min: "1 MIN", sub: "The smallest open task becomes the one thing. A quick win first." },
  ],
  anxious: [
    { id: "worry", title: "Write the worry down", min: "2 MIN", sub: "Put it in words. It goes to Mind Box, out of your head." },
    { id: "tiny", title: "Make the first step tiny", min: "1 MIN", sub: "A first step so small it can’t fail." },
    { id: "chat", title: "Talk it through with Coach", min: "5 MIN", sub: "Say what’s in the way. Coach knows your task." },
  ],
  distracted: [
    { id: "park", title: "Park the thought", min: "1 MIN", sub: "Whatever pulled you away goes to Mind Box for later." },
    { id: "focus10", title: "10-minute restart", min: "10 MIN", sub: "Ten minutes on the one thing, then decide." },
    { id: "checklist", title: "Close everything but the task", min: "1 MIN", sub: "Other tabs, your phone, notifications." },
  ],
};

const WRITE = {
  empty: { kicker: "EMPTY YOUR HEAD · 2 MIN", title: "Empty your head.", line: "One loose thought per line. Enter saves it to Mind Box.", seconds: 120 },
  worry: { kicker: "WRITE IT DOWN", title: "Write the worry down.", line: "Put it in words. Enter saves it to Mind Box." },
  park: { kicker: "PARK IT", title: "Park the thought.", line: "Whatever pulled you away. Enter saves it to Mind Box for later." },
};

const CHECKLIST = ["Close other tabs", "Phone face down", "Notifications off"];

// Box breathing 4-4-4-4, four rounds (~64 s).
const PHASES = ["In", "Hold", "Out", "Hold"];
const PHASE_S = 4;
const ROUNDS = 4;

const BREAK_S = 10 * 60;

function fmt(secs) {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

function useCountdown(seconds, running, onEnd) {
  const [left, setLeft] = useState(seconds);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => {
    if (!running || left <= 0) return undefined;
    const t = setTimeout(() => {
      setLeft(s => {
        if (s <= 1) { endRef.current?.(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [running, left]);
  return left;
}

function Breathing({ onDone }) {
  const total = PHASES.length * PHASE_S * ROUNDS;
  const left = useCountdown(total, true, onDone);
  const elapsed = total - left;
  const phaseIndex = Math.floor(elapsed / PHASE_S) % PHASES.length;
  const inPhase = elapsed % PHASE_S;
  const round = Math.min(ROUNDS, Math.floor(elapsed / (PHASE_S * PHASES.length)) + 1);
  const r = 88;
  const c = 2 * Math.PI * r;
  const fill = (inPhase + 1) / PHASE_S;
  return (
    <div className="rescue-breath" role="timer" aria-label={`${PHASES[phaseIndex]}, ${PHASE_S - inPhase} seconds. Round ${round} of ${ROUNDS}`}>
      <svg className="rescue-ring" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={r} className="rescue-ring-track" />
        <circle cx="100" cy="100" r={r} className="rescue-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - fill)} transform="rotate(-90 100 100)" />
      </svg>
      <div className="rescue-breath-text">
        <span className="rescue-breath-phase">{PHASES[phaseIndex]}</span>
        <span className="rescue-breath-count">{PHASE_S - inPhase}</span>
        <span className="rescue-kicker">ROUND {round} OF {ROUNDS}</span>
      </div>
    </div>
  );
}

export default function RescueMode({
  task, onDismiss, onAccept, onSetNowFocus, onParkTask, onHandoffSummary, apiKey, firstName, allTasks, config = {},
  entryPoint = "today", includeMemory = true, isSyncingFromCache = false, syncWarning = null,
  initialState = null, todayStr,
  onStartFocus, onClearDay, onRememberDest, onSaveThought, onSetFirstStep, onPickEasiest,
}) {
  // Mirrors CoachTab's cloudSyncUnconfirmed gate: cached/pre-sync payload data
  // can't be trusted to mutate tasks against yet — see applyRescueActions.
  const cloudSyncUnconfirmed = isSyncingFromCache || syncWarning === "offline";
  // A state picked on Mind Box (or "Not sure") enters at the breathing.
  const [step, setStep] = useState(initialState ? "breathe" : "state");
  const [reason, setReason] = useState(initialState && initialState !== "unsure" ? initialState : null);
  const [ownWords, setOwnWords] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [timerSecs, setTimerSecs] = useState(null);
  const [doneLine, setDoneLine] = useState("");
  const [whereLine, setWhereLine] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearDest, setClearDest] = useState(() => (CLEAR_DESTINATIONS.some(d => d.id === config.clearMyDayDest) ? config.clearMyDayDest : "week"));
  const [keepOne, setKeepOne] = useState(true);
  const [clearToast, setClearToast] = useState(null);
  const [writeKind, setWriteKind] = useState(null);
  const [written, setWritten] = useState([]);
  const [draft, setDraft] = useState("");
  const [checked, setChecked] = useState([]);
  const [breakSecs, setBreakSecs] = useState(BREAK_S);
  const [moreAsked, setMoreAsked] = useState(false);
  const [elseOpen, setElseOpen] = useState(false);
  const endRef      = useRef(null);
  const inputRef    = useRef(null);
  const headingRef  = useRef(null);
  const chatStarted = useRef(false);
  const sendingRef  = useRef(false);
  const userChattedRef = useRef(false);
  const handoffSavedRef = useRef(false);
  // A reply can resolve after the user has already exited Rescue (unmounting
  // this component) — without this guard, a late RESCUE_PARK_TASK/
  // RESCUE_SET_NOW_FOCUS tag would still reach onParkTask/onSetNowFocus and
  // mutate the parent's task list for a flow the user already canceled.
  const mountedRef  = useRef(true);
  // Sets true on every effect run (not just the initial useRef default) —
  // React 18 StrictMode's dev-only mount->cleanup->mount double-invocation
  // would otherwise leave this stuck false forever after the extra cleanup,
  // even though the component is genuinely still mounted.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    if (step === "chat") setTimeout(() => inputRef.current?.focus(), 100);
    else headingRef.current?.focus();
  }, [step]);

  // Countdown for a timer the chat started (RESCUE_START_TIMER).
  useEffect(() => {
    if (timerSecs === null || timerSecs <= 0) return;
    const t = setTimeout(() => setTimerSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timerSecs]);

  const saveHandoff = (outcome = "dismissed") => {
    if (handoffSavedRef.current) return;
    // Writing config while cloud sync hasn't confirmed the first RTDB
    // snapshot yet would stamp a stale cached config as the "winner" once
    // that snapshot arrives, silently overwriting newer remote config from
    // another device — matching the same guard used for Coach's memory writes.
    if (cloudSyncUnconfirmed) return;
    const summary = buildRescueHandoffSummary({
      reason,
      task,
      entryPoint,
      outcome,
      chatted: userChattedRef.current || messages.some(m => m.role === "user"),
      config,
    });
    if (!summary) return;
    handoffSavedRef.current = true;
    onHandoffSummary?.(summary);
  };

  const dismissRescue = (outcome = "dismissed") => {
    saveHandoff(outcome);
    onDismiss?.();
  };

  const acceptRescue = () => {
    onAccept?.();
    saveHandoff("accepted");
  };

  // Leave (Esc) from anywhere; the chat input's own Escape too.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); dismissRescue("dismissed"); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const { groqKey, geminiKey, cerebrasKey, zaiKey } = getAIKeys();
  const effectiveGeminiKey = geminiKey || (apiKey || "").trim();
  const pref = localStorage.getItem("loci_provider_pref") || "auto";
  const hasKey = buildProviderOrder(pref, groqKey, effectiveGeminiKey, cerebrasKey, zaiKey).length > 0;

  // Applies whichever actions filterApplicableRescueActions (rescueCoachPrompt.js)
  // let through, and reports whether a mutation was withheld specifically
  // because cloud sync hasn't confirmed yet, so the caller can tell the user
  // rather than let the model's narration imply it happened.
  const applyRescueActions = (actions = [], lastUserText = "") => {
    const { applicable, suppressedForSync } = filterApplicableRescueActions(actions, { lastUserText, cloudSyncUnconfirmed });
    applicable.forEach(action => {
      if (action.type === "RESCUE_SET_NOW_FOCUS") {
        (onSetNowFocus || onAccept)?.();
        saveHandoff("accepted");
      } else if (action.type === "RESCUE_PARK_TASK") {
        onParkTask?.();
        saveHandoff("parked");
      } else if (action.type === "RESCUE_START_TIMER") {
        setTimerSecs(action.minutes * 60);
        setStep("timer");
        saveHandoff("timer_started");
      }
    });
    return suppressedForSync;
  };

  const aiCall = async (r, history) => {
    setLoading(true);
    try {
      // history is [{role: "user"|"ai", text}] — convert to OpenAI format
      const messages = history.map(m => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text || m.parts?.[0]?.text || ""
      })).filter(m => m.content);

      const lastUserText = [...messages].reverse().find(m => m.role === "user")?.content || "";
      const localSafetyReply = buildLocalSafetyReply(lastUserText, firstName);
      if (localSafetyReply) {
        setMessages(prev => [...prev, { role: "ai", text: localSafetyReply }]);
        return;
      }

      const reply = await callAI({
        groqKey,
        cerebrasKey,
        zaiKey,
        geminiKey: effectiveGeminiKey,
        systemPrompt: buildRescuePrompt({ reason: r, firstName, task, allTasks, config, entryPoint, includeMemory }),
        messages: messages.length > 0 ? messages : [{ role: "user", content: "I'm stuck and need help." }],
        maxTokens: 200
      });
      if (!mountedRef.current) return;
      const { cleanText, actions } = parseRescueActionTags(reply);
      // The model's narration above (e.g. "Setting this as your focus...") describes
      // a mutation that was NOT applied below when sync is unconfirmed — replace it
      // entirely so the user doesn't believe it happened (mirrors CoachTab.jsx).
      const suppressedForSync = applyRescueActions(actions, lastUserText);
      const displayText = suppressedForSync
        ? "Hold on — still syncing your latest data. Mind asking that again in a moment?"
        : (cleanText || "Done.");
      setMessages(prev => [...prev, { role: "ai", text: displayText }]);
    } catch (err) {
      if (!mountedRef.current) return;
      const hint = err.message === "429" ? " (rate limit — wait a moment)" : err.message === "503" ? " (server busy)" : "";
      const lastUserText = history.map(m => (m.role === "user" ? (m.text || m.parts?.[0]?.text || "") : "")).filter(Boolean).at(-1) || "";
      setMessages(prev => [...prev, { role: "ai", text: `AI unavailable${hint}. ${buildOfflineRescueReply(r, firstName, lastUserText)}` }]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        sendingRef.current = false;
      }
    }
  };

  // `opener` is the user's own words from step 1, sent as the first turn.
  const openChat = (r, opener = null) => {
    // Always navigate to the chat screen — chatStarted only guards the
    // opener message below. Without this split, a user who reaches "chat"
    // via an AI-started timer (RESCUE_START_TIMER sets step to "timer" while
    // chatStarted is already true) and then taps "Skip timer" -> "Talk it
    // through" would have this bail out on the guard and never return to chat.
    setStep("chat");
    if (chatStarted.current) return;
    chatStarted.current = true;
    // The synthetic opener below ("I'm stuck and need help.") is sent as a
    // real Rescue Coach turn but is never added to `messages` with role
    // "user", so without this the handoff summary would be skipped for
    // anyone who opens chat and reads the reply/acts on it without typing
    // their own follow-up message.
    userChattedRef.current = true;
    if (opener) {
      const first = [{ role: "user", text: opener }];
      setMessages(first);
      if (!hasKey) {
        setMessages([...first, { role: "ai", text: buildOfflineRescueReply(r, firstName, opener) }]);
        return;
      }
      sendingRef.current = true;
      aiCall(r, first);
      return;
    }
    if (!hasKey) {
      setMessages([{ role: "ai", text: buildOfflineRescueReply(r, firstName) }]);
      return;
    }
    sendingRef.current = true;
    aiCall(r, [{ role: "user", text: "I'm stuck and need help." }]);
  };

  const handleSend = async () => {
    if (!input.trim() || sendingRef.current) return;
    sendingRef.current = true;
    const msg = input.trim();
    userChattedRef.current = true;
    setInput("");
    const updated = [...messages, { role: "user", text: msg }];
    setMessages(updated);
    if (!hasKey) {
      setMessages(prev => [...prev, { role: "ai", text: buildOfflineRescueReply(reason, firstName, msg) }]);
      sendingRef.current = false;
      return;
    }
    await aiCall(reason, updated);
  };

  // ── Step 3 actions ─────────────────────────────────────────────────────────
  const toWhere = (line) => { setDoneLine(line); setWhereLine(""); setStep("where"); };
  const startFocus = (minutes) => {
    saveHandoff("accepted");
    onStartFocus?.(minutes);
  };
  const handleOption = (id) => {
    if (id === "clear") { setClearOpen(o => !o); return; }
    if (id === "focus25") { startFocus(25); return; }
    if (id === "focus5") { startFocus(5); return; }
    if (id === "focus10") { startFocus(10); return; }
    if (id === "break") { setBreakSecs(BREAK_S); setStep("break"); return; }
    if (id === "chat") { openChat(reason); return; }
    if (id === "checklist") { setChecked([]); setStep("checklist"); return; }
    if (id === "tiny") { setDraft(""); setStep("tiny"); return; }
    if (id === "easiest") {
      const picked = onPickEasiest?.();
      toWhere(picked ? `DONE · ${picked.title.toUpperCase()} IS THE ONE THING` : "NOTHING EASIER WAITING");
      return;
    }
    if (WRITE[id]) { setWriteKind(id); setWritten([]); setDraft(""); setStep("write"); }
  };

  const plan = clearMyDayPlan(allTasks || [], { todayStr, keepUuid: keepOne && task?.isNowFocus ? task.uuid : null });
  const destLabel = CLEAR_DESTINATIONS.find(d => d.id === clearDest)?.label || "This week";
  const runClear = () => {
    const result = onClearDay?.(clearDest, keepOne && task?.isNowFocus ? task.uuid : null);
    if (!result) return;
    onRememberDest?.(clearDest);
    setClearOpen(false);
    setClearToast({ ...result, label: destLabel, key: Date.now() });
    const fixed = plan.fixedCount;
    toWhere(`DONE · CLEARED ${result.count} TO ${destLabel.toUpperCase()}`);
    setWhereLine(task?.isNowFocus && keepOne
      ? `Your day now holds one thing${fixed ? ` and ${fixed} fixed ${fixed === 1 ? "time" : "times"}` : ""}. That’s enough.`
      : "Today is clear. Pick one thing when you’re ready.");
  };

  const saveDraft = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (onSaveThought?.(draft)) { setWritten(w => [...w, draft.trim()]); setDraft(""); }
  };

  // ── Shell ──────────────────────────────────────────────────────────────────
  const shell = (body, { wide = false } = {}) => (
    <div className="rescue" role="dialog" aria-modal="true" aria-label="Rescue">
      <header className="rescue-head">
        <span className="rescue-head-title">Rescue</span>
        <button type="button" className="rescue-leave" onClick={() => dismissRescue("dismissed")}>
          Leave<span className="rescue-leave-key"> (Esc)</span>
        </button>
      </header>
      <div className="rescue-body">
        <div className={`rescue-col${wide ? " is-wide" : ""}`}>{body}</div>
      </div>
      <UndoAnnouncer message={clearToast ? `${clearToast.count} moved to ${clearToast.label}` : ""} />
      {clearToast && (
        <UndoToast
          key={clearToast.key}
          message={`${clearToast.count} moved to ${clearToast.label}`}
          onUndo={() => { clearToast.undo(); setClearToast(null); setDoneLine(""); setWhereLine(""); }}
          onClose={() => setClearToast(null)}
        />
      )}
    </div>
  );
  const stateName = RESCUE_STATES.find(s => s.id === reason)?.title.toUpperCase();
  const kicker = (n) => <span className="rescue-kicker">STEP {n} OF 3{stateName ? ` · ${stateName}` : ""}</span>;
  const heading = (text) => <h2 className="rescue-title" tabIndex={-1} ref={headingRef}>{text}</h2>;

  // ─── 1: What's happening ───────────────────────────────────────────────────
  if (step === "state") return shell(<>
    <span className="rescue-kicker">STEP 1 OF 3</span>
    {heading("What's happening right now?")}
    <p className="rescue-line">Pick the closest. Nothing here is a test.</p>
    <div className="rescue-rows">
      {RESCUE_STATES.map(s => (
        <button key={s.id} type="button" className={`rescue-row${reason === s.id ? " is-on" : ""}`}
          onClick={() => { setReason(s.id); setStep("breathe"); }}>
          <span className="rescue-row-title">{s.title}</span>
          <span className="rescue-row-sub">{s.sub}</span>
        </button>
      ))}
    </div>
    <form className="rescue-own" onSubmit={e => { e.preventDefault(); if (ownWords.trim()) openChat(reason, ownWords.trim()); }}>
      <label className="rescue-kicker" htmlFor="rescue-own-words">OR SAY IT IN YOUR OWN WORDS</label>
      <input id="rescue-own-words" className="rescue-input" value={ownWords} onChange={e => setOwnWords(e.target.value)} placeholder="I can’t start because…" />
    </form>
  </>);

  // ─── 2: Breathing ──────────────────────────────────────────────────────────
  if (step === "breathe") return shell(<>
    {kicker(2)}
    {heading("First, one minute of breathing.")}
    <p className="rescue-line">In for 4, hold for 4, out for 4, hold for 4. Follow the ring.</p>
    <Breathing onDone={() => setStep(reason ? "options" : "state")} />
    <button type="button" className="rescue-text-btn rescue-skip" onClick={() => setStep(reason ? "options" : "state")}>Skip</button>
  </>);

  // ─── 3: Try one of these ───────────────────────────────────────────────────
  if (step === "options") {
    const opts = OPTIONS[reason] || [];
    const clearPanel = (
      <div className="rescue-clear">
        <p className="rescue-clear-line"><span className="rescue-figs">{plan.openCount}</span> open tasks in Today. Move them to:</p>
        <div className="rescue-seg" role="radiogroup" aria-label="Move them to">
          {CLEAR_DESTINATIONS.map(d => (
            <button key={d.id} type="button" role="radio" aria-checked={clearDest === d.id}
              className={`rescue-seg-btn${clearDest === d.id ? " is-on" : ""}`} onClick={() => setClearDest(d.id)}>{d.label}</button>
          ))}
        </div>
        {task?.isNowFocus && (
          <label className="rescue-keep">
            <input type="checkbox" checked={keepOne} onChange={e => setKeepOne(e.target.checked)} />
            <span>Keep <strong>{task.title}</strong> as the one thing</span>
          </label>
        )}
        <p className="rescue-note">Fixed times{plan.fixedCount ? ` (${plan.fixedCount} today)` : ""} and done tasks stay. Nothing is deleted.</p>
        <div className="rescue-clear-actions">
          <button type="button" className="rescue-btn-filled" onClick={runClear} disabled={!plan.movable.length}>
            {plan.movable.length ? `Move ${plan.movable.length} to ${destLabel}` : "Nothing to move"}
          </button>
          <button type="button" className="rescue-text-btn" onClick={() => setClearOpen(false)}>Back</button>
        </div>
      </div>
    );
    const optionRow = (o) => (
      <div key={o.id} className="rescue-option">
        <button type="button" className={`rescue-row is-option${o.id === "clear" && clearOpen ? " is-on" : ""}`} aria-expanded={o.id === "clear" ? clearOpen : undefined} onClick={() => handleOption(o.id)}>
          <span className="rescue-row-head"><span className="rescue-row-title">{o.title}</span><span className="rescue-min">{o.min}</span></span>
          <span className="rescue-row-sub">{o.sub}</span>
        </button>
        {o.id === "clear" && clearOpen && clearPanel}
      </div>
    );
    return shell(<>
      {kicker(3)}
      {heading("Try one of these.")}
      <div className="rescue-rows">{opts.map(optionRow)}</div>
      {elseOpen && reason !== "overwhelmed" && (
        <div className="rescue-rows">{optionRow(OPTIONS.overwhelmed[0])}</div>
      )}
      <div className="rescue-links">
        {reason === "overwhelmed" || elseOpen
          ? <button type="button" className="rescue-text-btn" onClick={() => { setElseOpen(false); setClearOpen(false); setStep("state"); }}>Something else is going on</button>
          : <button type="button" className="rescue-text-btn" onClick={() => setElseOpen(true)}>Something else is going on</button>}
        {!opts.some(o => o.id === "chat") && (
          <button type="button" className="rescue-text-btn" onClick={() => openChat(reason)}>Talk it through with Coach</button>
        )}
      </div>
    </>);
  }

  // ─── 4: Where to now? ──────────────────────────────────────────────────────
  if (step === "where") return shell(<>
    {doneLine && <span className="rescue-kicker">{doneLine}</span>}
    {heading("Where to now?")}
    {whereLine && <p className="rescue-line">{whereLine}</p>}
    <div className="rescue-where">
      {task && !task.isCompleted ? (
        <button type="button" className="rescue-btn-filled is-big" onClick={() => startFocus(10)}>
          <span>Back to it · {task.title}</span>
          <span className="rescue-btn-sub">STARTS A 10-MIN FOCUS BLOCK</span>
        </button>
      ) : (
        <button type="button" className="rescue-btn-filled is-big" onClick={() => dismissRescue("accepted")}>Back to Today</button>
      )}
      <button type="button" className="rescue-btn-outline" onClick={() => { setBreakSecs(BREAK_S); setStep("break"); }}>Take a 10-minute break</button>
    </div>
    <div className="rescue-links">
      <button type="button" className="rescue-text-btn" onClick={() => setStep(reason ? "options" : "state")}>Try something else</button>
      <button type="button" className="rescue-text-btn" onClick={() => openChat(reason)}>Talk to Coach</button>
    </div>
  </>);

  // ─── Write (Empty your head / the worry / park the thought) ────────────────
  if (step === "write" && WRITE[writeKind]) {
    const w = WRITE[writeKind];
    return shell(<>
      <span className="rescue-kicker">{w.kicker}</span>
      {heading(w.title)}
      <p className="rescue-line">{w.line}</p>
      {w.seconds && <WriteClock seconds={w.seconds} />}
      <form className="rescue-own" onSubmit={saveDraft}>
        <input className="rescue-input" aria-label="Thought" value={draft} onChange={e => setDraft(e.target.value)} placeholder="What’s on your mind?" autoFocus />
      </form>
      {written.length > 0 && (
        <ul className="rescue-written">{written.map((t, i) => <li key={i}>{t}</li>)}</ul>
      )}
      <div className="rescue-where">
        <button type="button" className="rescue-btn-filled" onClick={() => toWhere(written.length ? `DONE · ${written.length} SAVED TO MIND BOX` : "")}>Done</button>
      </div>
    </>);
  }

  // ─── Make the first step tiny ──────────────────────────────────────────────
  if (step === "tiny") return shell(<>
    <span className="rescue-kicker">FIRST STEP</span>
    {heading("Make the first step tiny.")}
    <p className="rescue-line">{task ? `For ${task.title}: so small it can’t fail. Open the file. Write one line.` : "So small it can’t fail. Open the file. Write one line."}</p>
    <form className="rescue-own" onSubmit={e => {
      e.preventDefault();
      if (!draft.trim() || !task) return;
      onSetFirstStep?.(draft.trim());
      toWhere("DONE · FIRST STEP SET");
    }}>
      <input className="rescue-input" aria-label="First step" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Open the document" autoFocus />
    </form>
    <div className="rescue-links">
      <button type="button" className="rescue-text-btn" onClick={() => setStep("options")}>Back</button>
    </div>
  </>);

  // ─── Close everything but the task ─────────────────────────────────────────
  if (step === "checklist") return shell(<>
    <span className="rescue-kicker">CLEAR THE DESK</span>
    {heading("Close everything but the task.")}
    <div className="rescue-rows">
      {CHECKLIST.map(item => (
        <label key={item} className="rescue-check">
          <input type="checkbox" checked={checked.includes(item)} onChange={e => setChecked(c => (e.target.checked ? [...c, item] : c.filter(x => x !== item)))} />
          <span>{item}</span>
        </label>
      ))}
    </div>
    <div className="rescue-where">
      <button type="button" className="rescue-btn-filled" onClick={() => toWhere("")}>Ready</button>
    </div>
  </>);

  // ─── A 10-minute break, then 64k ───────────────────────────────────────────
  if (step === "break") return shell(
    <BreakTimer seconds={breakSecs} onEnd={() => setStep("breakOver")} onStop={() => setStep("breakOver")} headingRef={headingRef} />
  );
  if (step === "breakOver") return shell(<>
    <span className="rescue-kicker">BREAK · 0:00</span>
    {heading("Break’s over. Ready?")}
    <p className="rescue-line">{task ? `${task.title} is still the one thing. Ten minutes, then decide.` : "Ten minutes, then decide."}</p>
    <div className="rescue-where">
      {task && <button type="button" className="rescue-btn-filled is-big" onClick={() => startFocus(10)}>Start 10 minutes</button>}
      {!moreAsked && (
        <button type="button" className="rescue-btn-outline" onClick={() => { setMoreAsked(true); setBreakSecs(5 * 60); setStep("break"); }}>5 more minutes</button>
      )}
    </div>
    <div className="rescue-links">
      <button type="button" className="rescue-text-btn" onClick={() => setStep(reason ? "options" : "state")}>Back to Rescue</button>
    </div>
  </>);

  // ─── Chat ──────────────────────────────────────────────────────────────────
  if (step === "chat") {
    const r = RESCUE_STATES.find(x => x.id === reason);
    return shell(<>
      <span className="rescue-kicker">TALK IT THROUGH{r ? ` · ${r.title.toUpperCase()}` : ""}</span>
      <div className="rescue-chat" aria-live="polite">
        {loading && messages.length === 0 && <p className="rescue-line">Your coach is here…</p>}
        {messages.map((m, i) => (
          <div key={i} className={`rescue-msg ${m.role === "user" ? "is-you" : "is-coach"}`}>{m.text}</div>
        ))}
        {loading && messages.length > 0 && <p className="rescue-typing" aria-label="Coach is typing">···</p>}
        <div ref={endRef} />
      </div>
      <form className="rescue-composer" onSubmit={e => { e.preventDefault(); handleSend(); }}>
        <input ref={inputRef} className="rescue-input" value={input} onChange={e => setInput(e.target.value)}
          placeholder="Tell me what's going on…" aria-label="Message" />
        <button type="submit" className="rescue-btn-filled" disabled={loading || !input.trim()}>Send</button>
      </form>
      <div className="rescue-links">
        <button type="button" className="rescue-text-btn" onClick={() => setStep(reason ? "options" : "state")}>Back</button>
        <button type="button" className="rescue-text-btn" onClick={() => toWhere("")}>Where to now?</button>
      </div>
    </>, { wide: true });
  }

  // ─── A timer the chat started ──────────────────────────────────────────────
  if (step === "timer") {
    const done = timerSecs === 0;
    return shell(<>
      <span className="rescue-kicker">RESET</span>
      <div className="rescue-clock" role="timer">{done ? "0:00" : fmt(timerSecs)}</div>
      <p className="rescue-line">{done ? "Time’s up. Ready to start?" : "Relax. You'll start when this ends."}</p>
      <div className="rescue-where">
        {done
          ? <button type="button" className="rescue-btn-filled is-big" onClick={acceptRescue}>Start the task now</button>
          : <button type="button" className="rescue-btn-outline" onClick={() => setStep("options")}>Skip timer</button>}
      </div>
    </>);
  }

  return null;
}

function WriteClock({ seconds }) {
  const left = useCountdown(seconds, true, null);
  return <span className="rescue-kicker" role="timer">{fmt(left)} LEFT</span>;
}

function BreakTimer({ seconds, onEnd, onStop, headingRef }) {
  const left = useCountdown(seconds, true, onEnd);
  return (
    <>
      <span className="rescue-kicker">BREAK · {fmt(left)}</span>
      <h2 className="rescue-title" tabIndex={-1} ref={headingRef}>Take a break.</h2>
      <p className="rescue-line">Water, stand up, look away from the screen. Loci will ask once when it ends.</p>
      <div className="rescue-clock" role="timer" aria-label={`${fmt(left)} left`}>{fmt(left)}</div>
      <div className="rescue-where">
        <button type="button" className="rescue-btn-outline" onClick={onStop}>End the break now</button>
      </div>
    </>
  );
}
