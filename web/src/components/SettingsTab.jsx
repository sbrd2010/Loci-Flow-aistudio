import React, { useEffect, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import PrivacyPolicy from "./PrivacyPolicy";
import { db, auth } from "../firebase";
import { ref, push } from "firebase/database";
import { isMemoryEnabled } from "../utils/coachMemory";
import { focusWindowsLine } from "../utils/settingsSummary";
import { isNativeApp, notifPermissionState, requestNotifPermission as nativeRequestPermission, refreshNativePermission } from "../utils/nativeNotifs";
import { IconX } from "./ui/icons";
import { Group, Row, SubPage, SwitchRow } from "./settings/ui";
import {
  ANCHOR_MODES, AiProviderPage, AnchorsPage, CoachMemoryPage, CoachPage, DataPage, FocusWindowsPage,
  KeyDeadlinePage, NotificationsPage, ProfilePage, ReminderPage, TimerPage, coachName, providerLine,
} from "./settings/pages";
import "../styles/settings.css";

// Settings (44a–k). Phones: one list of groups; each row opens a page with
// "< Settings" back. From 840px: a list of sections on the left, the chosen
// section on the right (44k tablet, 44j laptop). Everything saves as it
// changes — there is no Save button.

const SECTIONS = [
  ["profile", "Profile"], ["day", "The day"], ["goal", "Your goal"], ["coach", "Coach"],
  ["memory", "Coach memory"], ["ai", "AI provider"], ["appearance", "Appearance"],
  ["notifications", "Notifications"], ["data", "Data"], ["support", "Support"],
];
// Pages that live inside "The day" on a wide screen.
const DAY_PAGES = ["focusWindows", "timer", "reminder", "anchors"];
const WIDE_ONLY_PAGES = ["day", "appearance", "support"];

const THEMES = [["light", "Light"], ["dark", "Dark"], ["auto", "Auto"]];

function useWide() {
  const query = "(min-width: 840px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return wide;
}

function relativeTime(ts) {
  if (!ts) return "never";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function shortDeadline(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function SettingsTab({ payload, saveSubPath, saveConfigPatch, lastSyncedAt, onSignOut, theme, onThemeChange, email, flushNow }) {
  const config = payload.config || {};
  const wide = useWide();
  // Phones: null is the root list. Wide: a section id, or a day page.
  const [page, setPage] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showBug, setShowBug] = useState(false);
  const [permission, setPermission] = useState(() => notifPermissionState());
  useEffect(() => {
    if (!wide && WIDE_ONLY_PAGES.includes(page)) setPage(null);
  }, [wide, page]);

  useEffect(() => {
    if (!isNativeApp()) return;
    refreshNativePermission().then(p => { if (p) setPermission(p); });
  }, []);
  // A new page starts at its top.
  useEffect(() => {
    document.querySelector(".screen-content")?.scrollTo?.({ top: 0 });
  }, [page]);

  const syncLabel = relativeTime(lastSyncedAt);
  const activeCount = (payload.tasks || []).filter(t => !t.isDeleted && !t.isCompleted).length;
  const memoryCount = (config.coachMemory?.pinnedFacts || []).length + (config.coachMemory?.recentObservations || []).length;
  const who = coachName(config);
  const askConfirm = ({ message, confirmLabel, onConfirm }) => setConfirm({
    message, confirmLabel, cancelLabel: "Cancel",
    onConfirm: () => { setConfirm(null); onConfirm(); },
    onCancel: () => setConfirm(null),
  });
  const signOut = () => askConfirm({ message: "Sign out? Your data stays saved.", confirmLabel: "Sign out", onConfirm: () => onSignOut?.() });
  const resetTracking = () => askConfirm({
    message: "Reset 7-day tracking?\n\nThis clears the week chart and the streak in Mind Box. Tasks stay. It can't be undone.",
    confirmLabel: "Reset",
    onConfirm: () => { saveSubPath("contributions", []); saveConfigPatch({ visitStreakCount: 0 }); },
  });
  const requestPermission = async () => setPermission(await nativeRequestPermission());

  // Where "back" goes: on a phone, the root; on a wide screen, a day page goes
  // back to "The day".
  const back = wide ? (DAY_PAGES.includes(page) ? () => setPage("day") : undefined) : () => setPage(null);
  const backLabel = wide ? "The day" : "Settings";
  const open = (id) => setPage(id);

  // ── the groups, shared by the phone root and the wide sections ──
  const dayGroup = (
    <Group label="The day">
      <Row title="Focus windows" sub={focusWindowsLine(config)} onClick={() => open("focusWindows")} />
      <Row title="Focus timer" value={`${Number(config.pomodoroDurationMinutes) || 25} min`} onClick={() => open("timer")} />
      <Row title="Reminder before" value={`${Number(config.reminderNagIntervalMinutes) || 15} min`} onClick={() => open("reminder")} />
      <SwitchRow title="Low energy" sub="Small starts drop to 5 min; nudges pause" checked={!!config.isLowEnergyMode} onChange={v => saveConfigPatch({ isLowEnergyMode: v })} />
      <SwitchRow title="Evening guard" sub="No new tasks after 20:00" checked={!!config.eveningGuardWindowActive} onChange={v => saveConfigPatch({ eveningGuardWindowActive: v })} />
      <Row title="Anchors on Today" value={ANCHOR_MODES.find(m => m.value === (config.anchorsOnToday === "off" ? "off" : "line")).label} onClick={() => open("anchors")} />
    </Group>
  );
  const coachRows = (
    <>
      <Row title="Coach memory" sub={isMemoryEnabled(config) ? `${memoryCount} ${memoryCount === 1 ? "note" : "notes"}` : "Off"} onClick={() => open("memory")} />
      <SwitchRow title="Proactive nudges" sub="Once a day, in Coach only" checked={config.coachNudgesEnabled !== false} onChange={v => saveConfigPatch({ coachNudgesEnabled: v })} />
      <SwitchRow title="Evening check-in" sub="A short reflection card at the end of the day" checked={config.dailyCheckinsEnabled !== false} onChange={v => saveConfigPatch({ dailyCheckinsEnabled: v })} />
      <Row title="AI provider" sub={providerLine()} onClick={() => open("ai")} />
    </>
  );
  const appearanceGroup = (
    <Group label="Appearance">
      <div className="set-row is-static is-stacked">
        <span className="set-row-title">Theme</span>
        <div className="set-segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? "is-on" : ""} onClick={() => onThemeChange?.(id)}>{name}</button>
          ))}
        </div>
        <span className="set-row-sub">Auto follows your device’s dark mode.</span>
      </div>
      <SwitchRow title="Show momentum" sub="Five bars under Today" checked={config.momentumEnabled !== false} onChange={v => saveConfigPatch({ momentumEnabled: v })} />
      <SwitchRow title="Drag anywhere" sub="Reorder a task by dragging anywhere on its row" checked={config.taskRowInteractionStyle === "dragAnywhere"} onChange={v => saveConfigPatch({ taskRowInteractionStyle: v ? "dragAnywhere" : "classic" })} />
    </Group>
  );
  const notificationsRow = (
    <Row
      title="Notifications"
      sub={permission === "granted" ? "Allowed · reminders are set per task" : permission === "denied" ? "Blocked in your settings" : "Not allowed yet"}
      value={permission === "granted" ? "On" : "Off"}
      onClick={() => open("notifications")}
    />
  );
  const supportRows = (
    <>
      <Row title="Report a bug" external onClick={() => setShowBug(true)} />
      <Row title="Privacy policy" external onClick={() => setShowPrivacy(true)} />
    </>
  );

  const pages = {
    profile: () => <ProfilePage config={config} email={email} saveConfigPatch={saveConfigPatch} onBack={back} />,
    focusWindows: () => <FocusWindowsPage config={config} saveConfigPatch={saveConfigPatch} onBack={back} backLabel={backLabel} />,
    timer: () => <TimerPage config={config} saveConfigPatch={saveConfigPatch} onBack={back} backLabel={backLabel} />,
    reminder: () => <ReminderPage config={config} saveConfigPatch={saveConfigPatch} onBack={back} backLabel={backLabel} />,
    anchors: () => <AnchorsPage config={config} saveConfigPatch={saveConfigPatch} onBack={back} backLabel={backLabel} />,
    goal: () => <KeyDeadlinePage config={config} saveConfigPatch={saveConfigPatch} onBack={back} />,
    coach: () => (
      <CoachPage config={config} saveConfigPatch={saveConfigPatch} onBack={back}>
        {wide && <Group label="Coach">{coachRows}</Group>}
      </CoachPage>
    ),
    memory: () => <CoachMemoryPage config={config} saveConfigPatch={saveConfigPatch} onBack={back} onConfirm={askConfirm} />,
    ai: () => <AiProviderPage onBack={back} />,
    notifications: () => <NotificationsPage permission={permission} onRequest={requestPermission} onBack={back} />,
    data: () => (
      <DataPage payload={payload} email={email} lastSyncLabel={syncLabel} onSyncNow={flushNow} onResetTracking={resetTracking} onBack={back} />
    ),
    // Wide-only sections: the groups themselves, as a page.
    day: () => <SubPage title="The day">{dayGroup}</SubPage>,
    appearance: () => <SubPage title="Appearance">{appearanceGroup}</SubPage>,
    support: () => <SubPage title="Support"><div className="set-list">{supportRows}</div></SubPage>,
  };

  const modals = (
    <>
      {confirm && <ConfirmDialog {...confirm} />}
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      {showBug && <BugReport onClose={() => setShowBug(false)} />}
    </>
  );

  if (wide) {
    const current = page || "profile";
    const section = DAY_PAGES.includes(current) ? "day" : current;
    return (
      <div className="set-wide">
        <nav className="set-nav" aria-label="Settings sections">
          <h2 className="set-nav-title">Settings</h2>
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className={`set-nav-item${section === id ? " is-on" : ""}`} aria-current={section === id ? "page" : undefined} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
          <button type="button" className="set-nav-signout" onClick={signOut}>Sign out</button>
        </nav>
        <div className="set-pane" key={current}>{pages[current]()}</div>
        {modals}
      </div>
    );
  }

  const phonePage = WIDE_ONLY_PAGES.includes(page) ? null : page;
  if (phonePage && pages[phonePage]) {
    return <div className="set-phone" key={phonePage}>{pages[phonePage]()}{modals}</div>;
  }

  const name = (config.userName || "").trim();
  return (
    <div className="set-phone">
      <h2 className="set-title">Settings</h2>
      <button type="button" className="set-profile" onClick={() => open("profile")}>
        <span className="set-avatar" aria-hidden="true">{(name || "?").slice(0, 1).toUpperCase()}</span>
        <span className="set-row-text">
          <span className="set-profile-name">{name || "Your profile"}</span>
          <span className="set-row-sub">{[email, `synced ${syncLabel}`].filter(Boolean).join(" · ")}</span>
        </span>
      </button>

      {dayGroup}
      <Group label="Your goal">
        <Row
          title="Key deadline"
          sub={config.deadlineLabel || config.deadlineDate ? [config.deadlineLabel, shortDeadline(config.deadlineDate)].filter(Boolean).join(" · ") : "Not set"}
          onClick={() => open("goal")}
        />
      </Group>
      <Group label="Coach">
        <Row title={who} sub="Tone and profile" onClick={() => open("coach")} />
        {coachRows}
      </Group>
      {appearanceGroup}
      <Group label="Notifications">{notificationsRow}</Group>
      <Group label="Data">
        <Row title="Sync" sub={`Synced ${syncLabel} · ${activeCount} ${activeCount === 1 ? "task" : "tasks"}`} onClick={() => open("data")} />
        <Row title="Backup" sub="Download JSON or CSV" onClick={() => open("data")} />
      </Group>
      <Group label="Support">{supportRows}</Group>
      <button type="button" className="set-signout" onClick={signOut}>Sign out of Loci</button>
      {modals}
    </div>
  );
}

// Report a bug: a dialog, as Add task is. Writes to /bugReports; not in demo.
function BugReport({ onClose }) {
  const [what, setWhat] = useState("");
  const [steps, setSteps] = useState("");
  const [device, setDevice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.querySelector("#bug-what")?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    if (done) dialogRef.current?.querySelector(".add-close")?.focus();
  }, [done]);
  const onDialogKeyDown = (e) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]")];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!what.trim()) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { setError("Couldn't send — sign in and try again."); return; }
    setBusy(true); setError("");
    try {
      await push(ref(db, "bugReports"), {
        what: what.trim(), steps: steps.trim(), device: device.trim(),
        userId: uid, userEmail: auth.currentUser?.email || null,
        appVersion: import.meta.env.VITE_APP_VERSION || "dev", submittedAt: Date.now(),
      });
      setDone(true);
      setTimeout(onClose, 2000);
    } catch {
      setError("Couldn't send — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-overlay" onClick={() => !busy && onClose()}>
      <div ref={dialogRef} className="add-card set-key-card" role="dialog" aria-modal="true" aria-labelledby="bug-title" onClick={e => e.stopPropagation()} onKeyDown={onDialogKeyDown}>
        <div className="add-head">
          <h2 id="bug-title" className="add-heading">Report a bug</h2>
          {!busy && <button type="button" className="add-close" onClick={onClose} aria-label="Close"><IconX size={20} /></button>}
        </div>
        {done ? (
          <p className="set-lede" role="status">Sent. Thank you — we'll look into it.</p>
        ) : (
          <form onSubmit={submit}>
            <label className="set-field">
              <span className="set-label">What happened?</span>
              <textarea id="bug-what" className="set-input set-textarea" rows={3} value={what} onChange={e => setWhat(e.target.value)} placeholder="What did you expect, and what happened instead?" required />
            </label>
            <label className="set-field">
              <span className="set-label">Steps to reproduce (optional)</span>
              <textarea id="bug-steps" className="set-input set-textarea" rows={2} value={steps} onChange={e => setSteps(e.target.value)} placeholder="1. Go to… 2. Tap… 3. See…" />
            </label>
            <label className="set-field">
              <span className="set-label">Device / browser (optional)</span>
              <input id="bug-device" className="set-input" value={device} onChange={e => setDevice(e.target.value)} placeholder="e.g. Pixel 8, Chrome" />
            </label>
            {error && <p className="set-window-hint" role="alert">{error}</p>}
            <button type="submit" className="add-submit" disabled={busy || !what.trim()}>{busy ? "Sending…" : "Send report"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
