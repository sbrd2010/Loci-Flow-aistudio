// Proactive Coach Nudge — Phase 3 "the coach speaks first."
//
// Surfaces buildExecutionCoachSignal's daily signal as a dismissible banner
// on the Today tab, once per Loci day. Respects the same off-ramps the user
// already has for other auto-show prompts (Settings toggle, Low Energy Mode,
// Evening Guard) so an unprompted nudge never piles on during a day the user
// has already signaled is hard.

import { buildExecutionCoachSignal } from "./coachSignals";
import { getLocalDateString } from "./lociAIContext";

// Returns the signal to show as a proactive nudge, or null if none should be
// shown right now. The lowest "quiet" tier (e.g. "One clean start" on an
// ordinary day) is excluded — too generic to justify an unprompted interruption.
export function getCoachNudge(payload = {}, now = new Date()) {
  const config = payload.config || {};
  if (config.coachNudgesEnabled === false) return null;
  if (config.isLowEnergyMode) return null;
  if (config.eveningGuardWindowActive && now.getHours() >= 20) return null;
  if (config.coachNudgeShownDate === getLocalDateString(now)) return null;

  const signal = buildExecutionCoachSignal(payload, now);
  if (!signal.shouldShow || signal.level === "quiet") return null;
  return signal;
}

// Config patch marking the nudge as shown for today — prevents it from
// reappearing until tomorrow, however the user dismissed it.
export function buildCoachNudgeShownConfig(now = new Date()) {
  return { coachNudgeShownDate: getLocalDateString(now) };
}

// Handoff payload for CoachTab to pick up on next open and deliver as an
// unprompted chat message.
export function buildPendingCoachNudge(signal) {
  return {
    reason: signal.reason,
    title: signal.title,
    body: signal.body,
    primaryTaskUuid: signal.primaryTaskUuid || null,
  };
}
