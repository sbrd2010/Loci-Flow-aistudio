import React, { useEffect, useMemo, useRef, useState } from "react";
import { COACH_PERSONAS, normalizeCoachPersona } from "../../utils/coachPersona";
import { COACH_PROFILE_NOTE_MAX_LENGTH } from "../../utils/coachProfile";
import { MEMORY_ENTRY_MAX_LENGTH, clearAllMemory, editMemoryEntry, isMemoryEnabled, removePinnedFact, removeRecentObservation } from "../../utils/coachMemory";
import { analyzeFocusWindowRows, formatTime12 } from "../../utils/focusWindowHints";
import { formatSpan } from "../../utils/dayMapPlan";
import { focusWindowRows, focusWindowsSummary, reconcileFocusWindowRows } from "../../utils/settingsSummary";
import { exportPayloadAsJson, exportTasksAsCsv } from "../../utils/exportTasks";
import { isNativeApp } from "../../utils/nativeNotifs";
import { IconPencil, IconPlus, IconX } from "../ui/icons";
import { Group, RadioList, Row, SubPage, SwitchRow, useAutosave } from "./ui";

// The sub-pages of Settings (44c–44h). Everything saves as it changes; text
// saves a moment after typing stops, and on leaving the field.

export const CHALLENGES = [
  { value: "overplanner", label: "Help me decide what to work on", sub: "Prompts to narrow down to the one thing that matters now." },
  { value: "initiation", label: "Help me just start", sub: "Tiny first steps; tasks broken down to make starting easy." },
  { value: "momentum", label: "Keep me moving forward", sub: "Wins and streaks; reminders that build on what you finished." },
  { value: "overwhelmed", label: "Help me recover and catch up", sub: "Gentle, shame-free prompts; reset tools up front." },
];

export function normalizeChallenge(key) {
  const legacy = { starting: "initiation", focusing: "momentum", execution: "overplanner", tracking: "overwhelmed" };
  return legacy[key] || key || "overplanner";
}

export function coachName(config) {
  return (config.mentorName || "").trim() || "Your coach";
}

// ── Profile ────────────────────────────────────────────────────────────────
export function ProfilePage({ config, email, saveConfigPatch, onBack }) {
  const [name, setName, flushName] = useAutosave(config.userName || "", (v) => {
    const t = v.trim();
    saveConfigPatch({ userName: t });
  });
  return (
    <SubPage title="Profile" onBack={onBack}>
      <label className="set-field">
        <span className="set-label">Your name</span>
        <input id="settings-name" className="set-input" value={name} onChange={e => setName(e.target.value)} onBlur={flushName} placeholder="Your name" />
      </label>
      {email && (
        <div className="set-field">
          <span className="set-label">Account</span>
          <span className="set-static">{email}</span>
        </div>
      )}
      <Group label="What helps you most">
        <RadioList
          label="What helps you most"
          options={CHALLENGES}
          value={normalizeChallenge(config.challengeType)}
          onChange={(v) => saveConfigPatch({ challengeType: v })}
        />
      </Group>
      <p className="set-note">The coach leans this way in how it helps you.</p>
    </SubPage>
  );
}

// ── Focus windows (44d) ────────────────────────────────────────────────────
function rowMinutes(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const d = (eh * 60 + em) - (sh * 60 + sm);
  return d > 0 ? d : d + 1440;
}

export function FocusWindowsPage({ config, saveConfigPatch, onBack, backLabel }) {
  const [rows, setRows] = useState(() => focusWindowRows(config));
  const savedRows = focusWindowRows(config);
  const savedRowsKey = JSON.stringify(savedRows);
  const previousSavedRows = useRef(savedRows);
  useEffect(() => {
    const previousKey = JSON.stringify(previousSavedRows.current);
    if (savedRowsKey === previousKey) return;
    setRows(current => reconcileFocusWindowRows(current, savedRows));
    previousSavedRows.current = savedRows;
  }, [savedRowsKey]);
  const hints = useMemo(() => analyzeFocusWindowRows(rows), [rows]);
  // From the rows alone: an older account's hours are already a row here.
  const summary = focusWindowsSummary({ focusWindows: rows });

  // The windows are the day now (brief, Phase 7: no separate day end), so the
  // first edit also retires an older account's dayStartHour/dayEndHour —
  // otherwise removing every window would quietly bring those hours back.
  const save = (next) => {
    setRows(next);
    saveConfigPatch({
      focusWindows: next.filter(w => w.start && w.end && w.start !== w.end),
      ...(Number.isFinite(config.dayStartHour) ? { dayStartHour: null } : {}),
      ...(Number.isFinite(config.dayEndHour) ? { dayEndHour: null } : {}),
    });
  };
  const change = (i, field, value) => save(rows.map((w, j) => j === i ? { ...w, [field]: value } : w));

  return (
    <SubPage
      title="Focus windows"
      onBack={onBack}
      backLabel={backLabel}
      lede="When you want to focus. The Day map plans inside these, and the last one sets when your day ends."
    >
      <div className="set-list">
        {rows.map((w, i) => {
          const hint = hints[i] || {};
          const suspect = !!hint.meridiemFix;
          return (
            <div key={i} className="set-window">
              <div className="set-window-row">
                <input type="time" className={`set-time${suspect ? " is-suspect" : ""}`} value={w.start || ""} aria-label={`Focus window ${i + 1} start time`} onChange={e => change(i, "start", e.target.value)} />
                <span className="set-window-dash" aria-hidden="true">–</span>
                <input type="time" className={`set-time${suspect ? " is-suspect" : ""}`} value={w.end || ""} aria-label={`Focus window ${i + 1} end time`} onChange={e => change(i, "end", e.target.value)} />
                <span className="set-window-len">{w.start && w.end && w.start !== w.end ? formatSpan(rowMinutes(w.start, w.end)) : ""}</span>
                <button type="button" className="set-icon-btn" aria-label={`Remove focus window ${i + 1}`} onClick={() => save(rows.filter((_, j) => j !== i))}>
                  <IconX size={18} />
                </button>
              </div>
              {suspect && (
                <p className="set-window-hint">
                  That’s unusually long. Did you mean <strong>{formatTime12(hint.meridiemFix.value)}</strong>?{" "}
                  <button type="button" className="set-link" onClick={() => change(i, hint.meridiemFix.field, hint.meridiemFix.value)}>Fix</button>
                </p>
              )}
              {!suspect && hint.overlapsWith?.length > 0 && (
                <p className="set-window-hint is-quiet">Overlaps window {hint.overlapsWith.map(n => n + 1).join(", ")}</p>
              )}
            </div>
          );
        })}
        <button type="button" className="set-row set-add" onClick={() => save([...rows, { start: "09:00", end: "17:00" }])}>
          <IconPlus size={18} /> Add a window
        </button>
      </div>

      <dl className="set-facts">
        <div><dt>Total focus time</dt><dd>{formatSpan(summary.totalMinutes)}</dd></div>
        <div><dt>Day ends</dt><dd>{summary.dayEnds === "00:00" ? "24:00" : summary.dayEnds}</dd></div>
      </dl>
      <p className="set-note">
        A window can cross midnight (e.g. 22:00–01:00). If you remove them all, Loci uses 07:00–24:00.
      </p>
    </SubPage>
  );
}

// ── Short choices: Focus timer, Reminder before, Anchors on Today ─────────
function withCurrent(list, current) {
  return list.includes(current) || !(current > 0) ? list : [...list, current].sort((a, b) => a - b);
}

export function TimerPage({ config, saveConfigPatch, onBack, backLabel }) {
  const current = Number(config.pomodoroDurationMinutes) || 25;
  const options = withCurrent([15, 20, 25, 30, 45, 50, 60, 90], current).map(m => ({ value: m, label: `${m} min` }));
  return (
    <SubPage title="Focus timer" onBack={onBack} backLabel={backLabel} lede="How long a focus session runs when a task has no estimate of its own.">
      <RadioList label="Focus timer" options={options} value={current} onChange={(m) => saveConfigPatch({ pomodoroDurationMinutes: m })} />
    </SubPage>
  );
}

export function ReminderPage({ config, saveConfigPatch, onBack, backLabel }) {
  const current = Number(config.reminderNagIntervalMinutes) || 15;
  const options = withCurrent([5, 10, 15, 20, 30, 45, 60], current).map(m => ({ value: m, label: `${m} min` }));
  return (
    <SubPage title="Reminder before" onBack={onBack} backLabel={backLabel} lede="How early a task’s reminder nudges you.">
      <RadioList label="Reminder before" options={options} value={current} onChange={(m) => saveConfigPatch({ reminderNagIntervalMinutes: m })} />
    </SubPage>
  );
}

export const ANCHOR_MODES = [
  { value: "line", label: "One line", sub: "One anchor under your goal; tap for the next." },
  { value: "off", label: "Off", sub: "Anchors stay in Mind Box, not on Today." },
];

export function AnchorsPage({ config, saveConfigPatch, onBack, backLabel }) {
  return (
    <SubPage title="Anchors on Today" onBack={onBack} backLabel={backLabel} lede="Your anchors are written and edited in Mind Box.">
      <RadioList label="Anchors on Today" options={ANCHOR_MODES} value={config.anchorsOnToday === "off" ? "off" : "line"} onChange={(v) => saveConfigPatch({ anchorsOnToday: v })} />
    </SubPage>
  );
}

// ── Key deadline (44e) ─────────────────────────────────────────────────────
function daysLeft(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const end = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((end - today) / 86400000);
}

export function KeyDeadlinePage({ config, saveConfigPatch, onBack }) {
  const [goal, setGoal, flushGoal] = useAutosave(config.deadlineLabel || "", v => saveConfigPatch({ deadlineLabel: v.trim() }));
  const [daily, setDaily, flushDaily] = useAutosave(config.deadlineAction || "", v => saveConfigPatch({ deadlineAction: v.trim() }));
  const left = daysLeft(config.deadlineDate);
  const hasGoal = !!(config.deadlineLabel || config.deadlineDate);
  return (
    <SubPage title="Key deadline" onBack={onBack} lede="One goal with a date. It shows as the gold band on Today and the week in Mind Box.">
      <label className="set-field">
        <span className="set-label">Goal</span>
        <input className="set-input" value={goal} onChange={e => setGoal(e.target.value)} onBlur={flushGoal} placeholder="e.g. Submit the thesis draft" />
      </label>
      <div className="set-field-pair">
        <label className="set-field">
          <span className="set-label">Started</span>
          <input type="date" className="set-input" value={config.deadlineStartDate || ""} onChange={e => saveConfigPatch({ deadlineStartDate: e.target.value })} />
        </label>
        <label className="set-field">
          <span className="set-label">Deadline</span>
          <input type="date" className="set-input" value={config.deadlineDate || ""} onChange={e => saveConfigPatch({ deadlineDate: e.target.value })} />
        </label>
      </div>
      <label className="set-field">
        <span className="set-label">Daily minimum</span>
        <input className="set-input" value={daily} onChange={e => setDaily(e.target.value)} onBlur={flushDaily} placeholder="e.g. One section, 45 minutes" />
      </label>
      <div className="set-preview" aria-label="Preview of the goal band">
        <span className="set-preview-kicker">PREVIEW</span>
        <span className="set-preview-figures">
          {left == null ? "Set a deadline" : left >= 0 ? `${left} ${left === 1 ? "day" : "days"} left` : `${-left} ${left === -1 ? "day" : "days"} past`}
        </span>
      </div>
      {hasGoal && (
        <button
          type="button"
          className="set-danger-link"
          onClick={() => saveConfigPatch({ deadlineLabel: "", deadlineDate: "", deadlineStartDate: "", deadlineAction: "", deadlineCardStyle: "compact" })}
        >
          Clear goal
        </button>
      )}
    </SubPage>
  );
}

// ── The coach (44c, 44j) ───────────────────────────────────────────────────
export function CoachPage({ config, saveConfigPatch, onBack, children }) {
  const [name, setName, flushName] = useAutosave(config.mentorName || "", v => saveConfigPatch({ mentorName: v.trim() }));
  const [style, setStyle, flushStyle] = useAutosave(config.coachPersonaNote || "", v => saveConfigPatch({ coachPersonaNote: v.trim().slice(0, 300) }));
  const [about, setAbout, flushAbout] = useAutosave(config.coachProfileNote || "", v => saveConfigPatch({ coachProfileNote: v.trim().slice(0, COACH_PROFILE_NOTE_MAX_LENGTH) }));
  const persona = normalizeCoachPersona(config.coachPersona);
  const shown = name.trim() || "your coach";
  return (
    <SubPage title={name.trim() || "Coach"} onBack={onBack}>
      <label className="set-field">
        <span className="set-label">Coach name</span>
        <input id="settings-mentor" className="set-input" value={name} onChange={e => setName(e.target.value)} onBlur={flushName} placeholder="Any name" />
      </label>
      <div className="set-field" role="group" aria-labelledby="set-tone">
        <span id="set-tone" className="set-label">Tone</span>
        <div className="set-chips">
          {COACH_PERSONAS.map(p => (
            <button key={p.key} type="button" className={`set-chip${persona === p.key ? " is-on" : ""}`} aria-pressed={persona === p.key} onClick={() => saveConfigPatch({ coachPersona: p.key })}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="set-hint">{COACH_PERSONAS.find(p => p.key === persona)?.desc}</span>
      </div>
      <label className="set-field">
        <span className="set-label">Style notes</span>
        <input id="settings-persona-note" className="set-input" value={style} maxLength={300} onChange={e => setStyle(e.target.value)} onBlur={flushStyle} placeholder="e.g. Keep it short, skip the cheerleading" />
      </label>
      <label className="set-field">
        <span className="set-label">What {shown} should know about you</span>
        <textarea id="settings-coach-profile" className="set-input set-textarea" rows={3} value={about} maxLength={COACH_PROFILE_NOTE_MAX_LENGTH} onChange={e => setAbout(e.target.value)} onBlur={flushAbout} placeholder="e.g. PhD student, thesis due in March; I work best in the mornings." />
      </label>
      <p className="set-note">Changes save as you type. Facts go here; how {shown} talks goes in Style notes.</p>
      {children}
    </SubPage>
  );
}

// ── Coach memory (44f) ─────────────────────────────────────────────────────
function shortDate(ts, dayStr) {
  const d = dayStr ? new Date(`${dayStr}T12:00:00`) : ts ? new Date(ts) : null;
  if (!d || isNaN(d)) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}

export function CoachMemoryPage({ config, saveConfigPatch, onBack, backLabel, onConfirm }) {
  const on = isMemoryEnabled(config);
  const facts = config.coachMemory?.pinnedFacts || [];
  const notes = config.coachMemory?.recentObservations || [];
  const entries = [
    ...facts.map((e, index) => ({ ...e, kind: "fact", index })),
    ...notes.map((e, index) => ({ ...e, kind: "note", index })),
  ];
  const [editing, setEditing] = useState(null); // { kind, createdAt, originalText, text }
  const [refused, setRefused] = useState("");
  const who = coachName(config);

  const saveEdit = () => {
    const { kind, index, text, createdAt, originalText } = editing;
    const expected = { createdAt, text: originalText };
    // Validate the visible draft, then resolve the same entry again against
    // the latest config when the patch runs. A shifted index must never edit
    // another memory.
    const checked = editMemoryEntry(config.coachMemory, kind, index, text, expected);
    if (!checked.ok) {
      setRefused(checked.reason === "stale" ? "This memory changed elsewhere. Reopen it to edit." : checked.reason === "too-long" ? "Keep this memory to 200 characters." : "That can’t be stored (it looks like a secret, an amount or a medical label).");
      return;
    }
    saveConfigPatch((latest) => {
      const res = editMemoryEntry(latest.coachMemory, kind, index, text, expected);
      return res.ok ? { coachMemory: res.coachMemory } : {};
    });
    setRefused("");
    setEditing(null);
  };
  const forget = (entry) => saveConfigPatch((latest) => {
    const list = entry.kind === "fact" ? latest.coachMemory?.pinnedFacts : latest.coachMemory?.recentObservations;
    const index = (list || []).findIndex(item => item.createdAt === entry.createdAt && item.text === entry.text);
    if (index < 0) return {};
    return { coachMemory: entry.kind === "fact" ? removePinnedFact(latest.coachMemory, index) : removeRecentObservation(latest.coachMemory, index) };
  });

  return (
    <SubPage title="Coach memory" onBack={onBack} backLabel={backLabel}>
      <div className="set-list">
        <SwitchRow
          title="Remember across chats"
          sub="Off keeps existing notes out of chat until you delete them"
          checked={on}
          onChange={() => saveConfigPatch((latest) => ({ coachMemoryEnabled: !isMemoryEnabled(latest) }))}
        />
      </div>

      <Group label={`What ${who} remembers · ${entries.length}`}>
        {entries.length === 0 && (
          <p className="set-row-empty">Nothing yet. As you chat, facts worth keeping show up here.</p>
        )}
        {entries.map((e) => {
          const isEditing = editing && editing.kind === e.kind && editing.createdAt === e.createdAt && editing.originalText === e.text;
          return (
            <div key={`${e.kind}-${e.index}`} className="set-memory">
              {isEditing ? (
                <div className="set-memory-edit">
                  <textarea
                    className="set-input set-textarea"
                    rows={2}
                    maxLength={MEMORY_ENTRY_MAX_LENGTH}
                    value={editing.text}
                    aria-label="Edit what the coach remembers"
                    onChange={ev => setEditing({ ...editing, text: ev.target.value })}
                  />
                  <span className="set-hint">Up to {MEMORY_ENTRY_MAX_LENGTH} characters.</span>
                  {refused && <p className="set-window-hint" role="alert">{refused}</p>}
                  <div className="set-memory-actions">
                    <button type="button" className="set-btn is-filled" onClick={saveEdit}>Save</button>
                    <button type="button" className="set-btn" onClick={() => { setEditing(null); setRefused(""); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="set-memory-text">
                    <span>{e.text}</span>
                    {shortDate(e.createdAt, e.lociDayStr) && <span className="set-memory-date">{shortDate(e.createdAt, e.lociDayStr)}</span>}
                  </div>
                  <button type="button" className="set-icon-btn" aria-label={`Edit: ${e.text}`} onClick={() => { setEditing({ kind: e.kind, index: e.index, createdAt: e.createdAt, originalText: e.text, text: e.text }); setRefused(""); }}>
                    <IconPencil size={18} />
                  </button>
                  <button type="button" className="set-icon-btn" aria-label={`Forget: ${e.text}`} onClick={() => forget(e)}>
                    <IconX size={18} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </Group>
      {entries.length > 0 && <p className="set-note">Wrong or out of date? Edit it or forget it.</p>}
      {entries.length > 0 && (
        <button
          type="button"
          className="set-danger-link"
          onClick={() => onConfirm({
            message: `Forget everything ${who} remembers?\n\nThis removes every saved fact and note. It can't be undone.`,
            confirmLabel: "Forget everything",
            onConfirm: () => saveConfigPatch((latest) => ({ coachMemory: clearAllMemory(latest.coachMemory) })),
          })}
        >
          Forget everything
        </button>
      )}
    </SubPage>
  );
}

// ── AI provider (44g) ──────────────────────────────────────────────────────
export const PROVIDERS = [
  { key: "cerebras", name: "Cerebras", storage: "loci_cerebras_key", builtin: import.meta.env.VITE_CEREBRAS_KEY, getKey: "https://cloud.cerebras.ai", placeholder: "csk-…" },
  { key: "groq", name: "Groq", storage: "loci_groq_key", builtin: import.meta.env.VITE_GROQ_KEY, getKey: "https://console.groq.com", placeholder: "gsk_…" },
  { key: "gemini", name: "Gemini", storage: "loci_gemini_key", builtin: import.meta.env.VITE_GEMINI_KEY, getKey: "https://aistudio.google.com", placeholder: "AIza…" },
  { key: "zai", name: "Z.ai", storage: "loci_zai_key", builtin: import.meta.env.VITE_ZAI_KEY, getKey: "https://z.ai", placeholder: "API key" },
];

export const PREF_CHAINS = {
  auto: ["cerebras", "groq", "zai", "gemini"],
  groq: ["groq", "cerebras", "zai", "gemini"],
  cerebras: ["cerebras", "groq", "zai", "gemini"],
  gemini: ["gemini", "groq", "cerebras", "zai"],
  zai: ["zai", "groq", "cerebras", "gemini"],
};

function readStore(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export function readProviderPref() {
  const p = readStore("loci_provider_pref");
  return PREF_CHAINS[p] ? p : "auto";
}

// Which provider answers now: the first in the chosen chain with a key.
export function activeProvider(pref = readProviderPref()) {
  const key = PREF_CHAINS[pref].find(k => {
    const p = PROVIDERS.find(x => x.key === k);
    return readStore(p.storage) || p.builtin;
  });
  return PROVIDERS.find(p => p.key === key) || null;
}

export function providerLine() {
  const pref = readProviderPref();
  const active = activeProvider(pref);
  const label = pref === "auto" ? "Auto" : PROVIDERS.find(p => p.key === pref)?.name;
  return active ? `${label} · ${active.name} active` : `${label} · no key yet`;
}

export function AiProviderPage({ onBack, backLabel }) {
  const [pref, setPref] = useState(readProviderPref);
  const [, bump] = useState(0);
  const [sheet, setSheet] = useState(null);
  const active = activeProvider(pref);

  const choose = (p) => {
    setPref(p);
    try { localStorage.setItem("loci_provider_pref", p); } catch { /* storage blocked */ }
  };
  const uses = [
    { value: "auto", label: "Auto (recommended)", sub: "Cerebras → Groq → Z.ai → Gemini" },
    { value: "groq", label: "Groq" },
    { value: "cerebras", label: "Cerebras" },
    { value: "gemini", label: "Gemini" },
    { value: "zai", label: "Z.ai", sub: "Free fallback, slow when busy" },
  ];

  return (
    <SubPage title="AI provider" onBack={onBack} backLabel={backLabel}>
      <Group label="Use">
        <RadioList label="AI provider" options={uses} value={pref} onChange={choose} />
      </Group>
      <Group label="Your keys" note="Keys are stored only on this device. Tap a row to add or change a key.">
        {PROVIDERS.map(p => {
          const own = readStore(p.storage);
          const isActive = active?.key === p.key;
          const sub = own
            ? `Saved · ••••${own.slice(-4)}${isActive ? " · active" : ""}`
            : p.builtin ? `Built in${isActive ? " · active" : ""}` : null;
          return (
            <Row key={p.key} title={p.name} sub={sub} value={own ? "Edit" : p.builtin ? "Add own" : "Add key"} onClick={() => setSheet(p)} />
          );
        })}
      </Group>
      {sheet && <KeySheet provider={sheet} onClose={() => { setSheet(null); bump(n => n + 1); }} />}
    </SubPage>
  );
}

function KeySheet({ provider, onClose }) {
  const [value, setValue] = useState(() => readStore(provider.storage));
  const had = !!readStore(provider.storage);
  const cardRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    cardRef.current?.querySelector("input")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const onDialogKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [...cardRef.current.querySelectorAll("button:not([disabled]), input:not([disabled]), a[href]")];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const write = (v) => {
    try { v ? localStorage.setItem(provider.storage, v) : localStorage.removeItem(provider.storage); } catch { /* storage blocked */ }
    onClose();
  };
  return (
    <div className="add-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="add-card set-key-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-key-title"
        onClick={e => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="add-head">
          <h2 id="set-key-title" className="add-heading">{provider.name} key</h2>
          <button type="button" className="add-close" onClick={onClose} aria-label="Close"><IconX size={20} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); write(value.trim()); }}>
          <label className="set-field">
            <span className="set-label">Key</span>
            <input type="password" className="set-input" value={value} autoComplete="off" onChange={e => setValue(e.target.value)} placeholder={provider.placeholder} />
          </label>
          <a className="set-link" href={provider.getKey} target="_blank" rel="noreferrer">Get a key ↗</a>
          <div className="set-memory-actions">
            <button type="submit" className="set-btn is-filled" disabled={!value.trim()}>Save key</button>
            {had && <button type="button" className="set-btn is-danger" onClick={() => write("")}>Remove key</button>}
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Notifications ──────────────────────────────────────────────────────────
export function NotificationsPage({ permission, onRequest, onBack }) {
  return (
    <SubPage title="Notifications" onBack={onBack}>
      <div className="set-list">
        <div className="set-row is-static">
          <span className="set-row-text">
            <span className="set-row-title">
              {permission === "granted" ? "Allowed" : permission === "denied" ? "Blocked" : "Not allowed yet"}
            </span>
            <span className="set-row-sub">
              {permission === "denied"
                ? isNativeApp()
                  ? "Android Settings → Apps → Loci Focus → Notifications → allow."
                  : "Browser settings → Site settings → Notifications → allow for this site."
                : "Reminders are set per task, when you add or edit it."}
            </span>
          </span>
          {permission !== "granted" && permission !== "denied" && (
            <button type="button" className="set-btn is-filled" onClick={onRequest}>Allow</button>
          )}
        </div>
      </div>
    </SubPage>
  );
}

// ── Data (44h) ─────────────────────────────────────────────────────────────
export function DataPage({ payload, email, lastSyncLabel, onSyncNow, onResetTracking, onBack }) {
  const [exportError, setExportError] = useState("");
  const active = (payload.tasks || []).filter(t => !t.isDeleted && !t.isCompleted).length;
  const run = (fn) => { setExportError(""); try { fn(); } catch { setExportError("Export failed. Your tasks were not changed."); } };
  return (
    <SubPage title="Data" onBack={onBack}>
      <Group label="Sync">
        <div className="set-row is-static"><span className="set-row-title">Account</span><span className="set-row-value is-truncate">{email || "This device"}</span></div>
        <div className="set-row is-static"><span className="set-row-title">Last sync</span><span className="set-row-value">{lastSyncLabel}</span></div>
        <div className="set-row is-static"><span className="set-row-title">Tasks</span><span className="set-row-value">{active} active</span></div>
        <Row title="Sync now" onClick={() => onSyncNow?.()} />
      </Group>
      <Group label="Backup" note="A backup only saves a file. It never changes your tasks.">
        <Row title="Download JSON" sub="Every field, for restoring" onClick={() => run(() => exportPayloadAsJson(payload))} />
        <Row title="Download CSV" sub="Opens in Excel or Sheets" onClick={() => run(() => exportTasksAsCsv(payload.tasks || []))} />
      </Group>
      {exportError && <p className="set-window-hint" role="alert">{exportError}</p>}
      <Group label="Reset">
        <div className="set-row is-static">
          <span className="set-row-text">
            <span className="set-row-title">Reset 7-day tracking</span>
            <span className="set-row-sub">Clears the week chart and streak. Tasks stay.</span>
          </span>
          <button type="button" className="set-text-danger" onClick={onResetTracking}>Reset</button>
        </div>
      </Group>
    </SubPage>
  );
}
