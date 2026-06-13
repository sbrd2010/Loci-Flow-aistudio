// Proactive Coach Nudge — Phase 3 "the coach speaks first."
//
// Surfaces buildExecutionCoachSignal's daily signal as a dismissible banner
// on the Today tab, once per Loci day. Respects the same off-ramps the user
// already has for other auto-show prompts (Settings toggle, Low Energy Mode,
// Evening Guard) so an unprompted nudge never piles on during a day the user
// has already signaled is hard.

import { buildExecutionCoachSignal } from "./coachSignals";
import { getFocusWindows, getLociDayStr } from "./focusWindows";

function lociDay(payload, now) {
  return getLociDayStr(now, getFocusWindows(payload.config || {}));
}

// Returns the signal to show as a proactive nudge, or null if none should be
// shown right now. The lowest "quiet" tier (e.g. "One clean start" on an
// ordinary day) is excluded — too generic to justify an unprompted interruption.
// "Once per Loci day" caps how often a NEW nudge can appear, not how long an
// unacknowledged one lingers — the banner stays visible across reloads until
// the user dismisses it or talks to the coach (buildCoachNudgeClearedConfig).
export function getCoachNudge(payload = {}, now = new Date()) {
  const config = payload.config || {};
  if (config.coachNudgesEnabled === false) return null;
  if (config.isLowEnergyMode) return null;
  if (config.eveningGuardWindowActive && now.getHours() >= 20) return null;
  if (config.coachNudgeClearedDate === lociDay(payload, now)) return null;

  const signal = buildExecutionCoachSignal(payload, now);
  if (!signal.shouldShow || signal.level === "quiet") return null;
  return signal;
}

// Config patch marking the nudge as cleared for this Loci day — set when the
// user dismisses the banner OR taps "Talk to coach". Either action is an
// acknowledgment, so the banner won't reappear until the next Loci day.
export function buildCoachNudgeClearedConfig(payload = {}, now = new Date()) {
  return { coachNudgeClearedDate: lociDay(payload, now) };
}

// Handoff payload for CoachTab to pick up on next open and deliver as an
// unprompted chat message. Stamped with the Loci day it was built on so
// CoachTab can discard it if it's gone stale (see isPendingCoachNudgeStale).
export function buildPendingCoachNudge(signal, payload = {}, now = new Date()) {
  return {
    reason: signal.reason,
    title: signal.title,
    body: signal.body,
    primaryTaskUuid: signal.primaryTaskUuid || null,
    lociDayStr: lociDay(payload, now),
  };
}

// True if a handed-off nudge is from a previous Loci day and should be
// discarded without delivering — e.g. the user tapped "Talk to coach" but
// didn't open the chat until the next day.
export function isPendingCoachNudgeStale(nudge, payload = {}, now = new Date()) {
  if (!nudge) return true;
  return nudge.lociDayStr !== lociDay(payload, now);
}

// Guards CoachTab's delivery effect against React StrictMode's double-invoke
// (and any other re-run before pendingCoachNudge is cleared from config) so
// the same handed-off nudge is never delivered into chat twice.
export function shouldDeliverPendingCoachNudge(nudge, deliveredNudge) {
  return !!nudge && nudge !== deliveredNudge;
}
