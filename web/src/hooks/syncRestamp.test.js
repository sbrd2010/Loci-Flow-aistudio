import { describe, it, expect } from "vitest";
import { joinRoute, reflowRoute } from "./useDayRoute";
import { mergeLocalIntoServer, mergeRemotePayloadWithMeta } from "../utils/normalizePayload";

// Sync across devices (Rohan, 11 Oct): tasks merge whole, the newer
// lastUpdated wins. The route's automatic catch-up — timing the route again
// as the clock passes it, or joining tasks to it when the day turns — ran
// on any device with Today open, a laptop just woken included, and stamped
// every stop "now". The woken laptop's old copy of each task then read as
// the newest and replaced what another device had done since. Automatic
// catch-up is not an edit: it must never outrank one.
const TODAY = "2026-10-12";
const YESTERDAY = "2026-10-11";
const T0 = Date.UTC(2026, 9, 11, 17, 0); // the office laptop's last look, evening
const T1 = Date.UTC(2026, 9, 11, 21, 0); // done on the phone at night
const task = (uuid, extra = {}) => ({
  id: uuid, uuid, userId: "u", title: uuid, horizonLevel: "today", timeEstimateMinutes: 30,
  isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false, priority: "P2",
  orderIndex: 0, lastUpdated: T0, ...extra,
});
const payload = (tasks) => ({ userId: "u", tasks, config: { userId: "u", lastUpdated: T0 }, contributions: [], brainDump: [], timestamp: T0 });
const find = (p, uuid) => p.tasks.find(t => t.uuid === uuid);

describe("the route's automatic catch-up never beats a real edit from another device", () => {
  // The office laptop still holds yesterday evening's copy: a and b open on
  // yesterday's route. The phone finished a at night (T1).
  const stale = [
    task("a", { dayMapDate: YESTERDAY, dayMapOrder: 0, dayMapStartMinutes: 600 }),
    task("b", { dayMapDate: YESTERDAY, dayMapOrder: 1, dayMapStartMinutes: 640, orderIndex: 1 }),
  ];
  const server = payload([
    { ...stale[0], isCompleted: true, dateCompletedString: YESTERDAY, lastUpdated: T1 },
    stale[1],
  ]);

  it("the day turning: joining the new day's route keeps each task's own stamp", () => {
    const joined = joinRoute(stale, TODAY, { stamp: false });
    expect(joined.map(t => t.dayMapDate)).toEqual([TODAY, TODAY]);
    expect(joined.map(t => t.lastUpdated)).toEqual([T0, T0]);
    const written = mergeLocalIntoServer(server, payload(joined), null);
    expect(find(written, "a").isCompleted).toBe(true);
  });

  it("the clock passing the route: timing it again keeps each task's own stamp", () => {
    const today = stale.map(t => ({ ...t, dayMapDate: TODAY }));
    const timed = reflowRoute(today, 900, TODAY, [], { stamp: false });
    expect(timed.map(t => t.dayMapStartMinutes)).toEqual([900, 935]);
    expect(timed.map(t => t.lastUpdated)).toEqual([T0, T0]);
    const written = mergeLocalIntoServer({ ...server, tasks: server.tasks.map(t => ({ ...t, dayMapDate: TODAY })) }, payload(timed), null);
    expect(find(written, "a").isCompleted).toBe(true);
    // And arriving at the stale device, the phone's edit wins there too.
    const { merged } = mergeRemotePayloadWithMeta(server, payload(timed));
    expect(find(merged, "a").isCompleted).toBe(true);
  });

  it("a real change on this device still stamps the tasks it moved, and only those", () => {
    const today = stale.map(t => ({ ...t, dayMapDate: TODAY, dayMapDurationMinutes: 30, dayMapPeriod: "morning" }));
    const before = Date.now();
    const timed = reflowRoute([today[1], today[0]], 600, TODAY);
    expect(timed.every(t => t.lastUpdated >= before)).toBe(true);
    const unchanged = reflowRoute([{ ...today[0], dayMapStartMinutes: 600, dayMapOrder: 0, dayMapPeriod: "morning" }], 600, TODAY);
    expect(unchanged[0].lastUpdated).toBe(T0);
  });

  // Codex review of #501: fixing a stop at the start it already has moves
  // nothing, so the caller stamps its own edit; the reflow keeps that stamp.
  it("a caller's own stamp survives a reflow that moves nothing", () => {
    const today = { ...stale[0], dayMapDate: TODAY, dayMapStartMinutes: 600, dayMapOrder: 0, dayMapDurationMinutes: 30, dayMapPeriod: "morning" };
    const edited = { ...today, dayMapFixedMinutes: 600, lastUpdated: T1 };
    const [out] = reflowRoute([edited], 600, TODAY, [], { stamp: false });
    expect(out.dayMapFixedMinutes).toBe(600);
    expect(out.lastUpdated).toBe(T1);
  });
});
