import { describe, it, expect } from "vitest";
import { buildFocusTerminalEvent, eventPatch } from "./activityLog";
import { dailyTotals, flattenFocusEvents, minutesForTaskOn } from "./focusLedger";
import { extendMinutesForSession, MAX_EXTEND_MINUTES } from "./focusSession";
import { getFocusWindows } from "./focusWindows";

// K4's 00:00 hold writes a ledger entry at the bell while the session stays
// OPEN, then amends that same entry when the session actually ends. The whole
// design rests on one invariant: the amend must land on the entry the hold
// wrote, never beside it. Nothing downstream dedupes by focusSessionId —
// dailyTotals and minutesForTaskOn sum every terminal event they are given —
// so a second entry is silently double-counted minutes in the user's own
// time log, and a double-counted "move" in Momentum on top.

const dt = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);
// dayEndHour 26 — the Loci day runs to 02:00, the demo default.
const windows = getFocusWindows({ dayStartHour: 7, dayEndHour: 26 });
const task = { uuid: "task-1", category: "Career", priority: "P1", horizonLevel: "today" };

// Replay a sequence of RTDB update() patches the way the database would:
// later writes to the SAME path replace, different paths accumulate. Then
// reshape into the { [date]: { [eventId]: event } } that reads see.
const replay = (...patches) => {
  const db = {};
  for (const patch of patches) Object.assign(db, patch);
  const raw = {};
  for (const [path, event] of Object.entries(db)) {
    const [, , , dateString, eventId] = path.split("/"); // activityLogs/uid/events/DATE/ID
    (raw[dateString] ||= {})[eventId] = event;
  }
  return { raw, paths: Object.keys(db) };
};

// What the hold banks at the bell, and what the eventual stop writes. The
// second build pins the first's identity exactly as endFocusSession hands it
// back through `...session`.
const holdThenStop = ({ heldAt, stoppedAt, elapsedAtStop, type = "focus_abandoned", pin = true }) => {
  const held = buildFocusTerminalEvent("focus_abandoned", task, "session-1", {
    focusStartedAt: dt(2026, 7, 10, 23, 35).getTime(),
    focusInitialPlannedSeconds: 1500,
    focusFinalPlannedSeconds: 1500,
    focusElapsedSeconds: 1500,
    focusEndReason: "timer_elapsed",
    now: heldAt,
    windows,
  });
  const stopped = buildFocusTerminalEvent(type, task, "session-1", {
    focusStartedAt: held.focusStartedAt,
    focusInitialPlannedSeconds: 1500,
    focusFinalPlannedSeconds: 2700,
    focusElapsedSeconds: elapsedAtStop,
    focusEndReason: "user_abandoned",
    now: stoppedAt,
    windows,
    ...(pin ? { eventId: held.eventId, lociDateString: held.lociDateString } : {}),
  });
  return { held, stopped, ...replay(eventPatch("uid1", held), eventPatch("uid1", stopped)) };
};

describe("K4 — the 00:00 hold amends its entry instead of writing a second one", () => {
  it("a held session that is later stopped leaves exactly ONE ledger entry", () => {
    const { paths, raw } = holdThenStop({
      heldAt: dt(2026, 7, 11, 0, 0),
      stoppedAt: dt(2026, 7, 11, 0, 20),
      elapsedAtStop: 2700,
    });
    expect(paths).toHaveLength(1);
    expect(flattenFocusEvents(raw)).toHaveLength(1);
  });

  it("counts the minutes once, and the day's move once", () => {
    const { raw } = holdThenStop({
      heldAt: dt(2026, 7, 11, 0, 0),
      stoppedAt: dt(2026, 7, 11, 0, 20),
      elapsedAtStop: 2700, // 25m held, extended to 45m by the time they stopped
    });
    const totals = dailyTotals(flattenFocusEvents(raw));
    const day = Object.keys(totals)[0];
    expect(totals[day].minutes).toBe(45); // not 25 + 45
    expect(totals[day].moves).toBe(1);    // Momentum counts one day moved, not two
  });

  it("the amend carries the FINAL figures, not the ones frozen at the bell", () => {
    const { raw } = holdThenStop({
      heldAt: dt(2026, 7, 11, 0, 0),
      stoppedAt: dt(2026, 7, 11, 0, 20),
      elapsedAtStop: 2700,
    });
    expect(minutesForTaskOn(raw, "task-1", Object.keys(raw)[0])).toBe(45);
  });

  it("finishing the task at the hold upgrades the held entry's type in place", () => {
    const { raw, paths } = holdThenStop({
      heldAt: dt(2026, 7, 11, 0, 0),
      stoppedAt: dt(2026, 7, 11, 0, 5),
      elapsedAtStop: 1500,
      type: "focus_completed",
    });
    expect(paths).toHaveLength(1);
    const events = flattenFocusEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("focus_completed");
  });

  it("pins the DAY too: a session extended across dayEndHour stays on one day", () => {
    // Bell at 01:50 (still 2026-07-10's Loci day, which runs to 02:00), the
    // user takes +20m, stops at 02:10 — past the boundary. Deriving the day
    // afresh would file the amend under 2026-07-11 and book the minutes twice.
    const { paths, held, stopped } = holdThenStop({
      heldAt: dt(2026, 7, 11, 1, 50),
      stoppedAt: dt(2026, 7, 11, 2, 10),
      elapsedAtStop: 2700,
    });
    expect(stopped.lociDateString).toBe(held.lociDateString);
    expect(paths).toHaveLength(1);
  });

  it("but the amend still records the REAL end time — only identity is pinned", () => {
    const { held, stopped } = holdThenStop({
      heldAt: dt(2026, 7, 11, 0, 0),
      stoppedAt: dt(2026, 7, 11, 0, 20),
      elapsedAtStop: 2700,
    });
    expect(stopped.focusEndedAt).toBeGreaterThan(held.focusEndedAt);
    expect(stopped.utcTimestamp).toBeGreaterThan(held.utcTimestamp);
  });

  it("WITHOUT the pin the same sequence double-counts — what this guards against", () => {
    const { paths, raw } = holdThenStop({
      heldAt: dt(2026, 7, 11, 0, 0),
      stoppedAt: dt(2026, 7, 11, 0, 20),
      elapsedAtStop: 2700,
      pin: false,
    });
    expect(paths).toHaveLength(2);
    const totals = dailyTotals(flattenFocusEvents(raw));
    expect(totals[Object.keys(totals)[0]].minutes).toBe(70); // 25 + 45
  });

  it("a second bell after '+Nm' re-banks the SAME entry with the fuller figures", () => {
    // Ring at 25m, take +20m, ring again at 45m, then the app is killed.
    // The ledger must show 45 minutes in one entry — not 25 (the first
    // bell frozen in place) and not 70 (two entries summed).
    const first = buildFocusTerminalEvent("focus_abandoned", task, "session-1", {
      focusStartedAt: dt(2026, 7, 10, 23, 35).getTime(),
      focusInitialPlannedSeconds: 1500,
      focusFinalPlannedSeconds: 1500,
      focusElapsedSeconds: 1500,
      focusEndReason: "timer_elapsed",
      now: dt(2026, 7, 11, 0, 0),
      windows,
    });
    const second = buildFocusTerminalEvent("focus_abandoned", task, "session-1", {
      focusStartedAt: first.focusStartedAt,
      focusInitialPlannedSeconds: 1500,
      focusFinalPlannedSeconds: 2700,
      focusElapsedSeconds: 2700,
      focusEndReason: "timer_elapsed",
      now: dt(2026, 7, 11, 0, 20),
      windows,
      eventId: first.eventId,
      lociDateString: first.lociDateString,
    });
    const { raw, paths } = replay(eventPatch("uid1", first), eventPatch("uid1", second));
    expect(paths).toHaveLength(1);
    const totals = dailyTotals(flattenFocusEvents(raw));
    expect(totals[Object.keys(totals)[0]].minutes).toBe(45);
  });

  it("an ordinary session that never rang mints its own identity as before", () => {
    const a = buildFocusTerminalEvent("focus_abandoned", task, "session-1", {
      focusElapsedSeconds: 600, now: dt(2026, 7, 10, 10), windows,
    });
    const b = buildFocusTerminalEvent("focus_abandoned", task, "session-2", {
      focusElapsedSeconds: 600, now: dt(2026, 7, 10, 11), windows,
    });
    expect(a.eventId).toBeTruthy();
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.lociDateString).toBe("2026-07-10");
  });
});

describe("K4 — the extension scales to the session", () => {
  it.each([
    [5 * 60, 5],
    [10 * 60, 10],
    [25 * 60, 20],
    [50 * 60, 20],
  ])("a %ss block offers +%sm", (seconds, expected) => {
    expect(extendMinutesForSession(seconds)).toBe(expected);
  });

  it("never offers more than the cap", () => {
    expect(extendMinutesForSession(9 * 3600)).toBe(MAX_EXTEND_MINUTES);
  });

  it("a sub-minute block is not answered with the cap", () => {
    // The five-minute case in reverse: offering +20m here is the same
    // argument with the user, just from the other end.
    expect(extendMinutesForSession(20)).toBe(1);
  });

  it("falls back to the cap only when there is no figure to scale to", () => {
    expect(extendMinutesForSession(undefined)).toBe(MAX_EXTEND_MINUTES);
  });
});
