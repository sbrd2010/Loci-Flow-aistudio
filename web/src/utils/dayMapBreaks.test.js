import { describe, expect, it } from "vitest";
import { addedBreaks, busyFromRows, defaultBreak, fitBreak, nextFreeSlot, routeBreaks, withAddedBreaks } from "./dayMapBreaks";
import { layoutRoute } from "./dayMapRoute";

const DAY = "2026-09-29";
const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const windows = [{ startMin: hm("09:00"), endMin: hm("13:35") }, { startMin: hm("14:15"), endMin: hm("17:30") }];
const durationOf = (t) => t.minutes;
const task = (title, minutes, fixedAt) => ({ title, minutes, ...(fixedAt ? { dayMapFixedMinutes: hm(fixedAt) } : {}) });

describe("breaks you add (Q31)", () => {
  it("are stored for today as { kind, start, lengthMin } and reset the next day", () => {
    const config = withAddedBreaks({}, DAY, [{ start: hm("10:30"), lengthMin: 15 }], 1);
    expect(config.dayMapBreaks).toEqual({ date: DAY, items: [{ kind: "break", start: hm("10:30"), lengthMin: 15 }] });
    expect(addedBreaks(config, DAY)).toHaveLength(1);
    expect(addedBreaks(config, "2026-09-30")).toEqual([]);
  });

  it("join the gaps between focus windows as breaks the route stops for", () => {
    const config = { breakName: "Tea", ...withAddedBreaks({}, DAY, [{ start: hm("10:30"), lengthMin: 15 }]) };
    expect(routeBreaks(windows, config, DAY)).toEqual([
      { start: hm("13:35"), end: hm("14:15"), name: "Tea" },
      { start: hm("10:30"), end: hm("10:45"), name: "Tea", added: 0 },
    ]);
  });

  it("the next task starts right when the break ends: no buffer, no rounding (Q35a)", () => {
    const breaks = [{ start: hm("10:02"), end: hm("10:17"), name: "Break", added: 0 }];
    const rows = layoutRoute([task("A", 60), task("B", 30)], { from: hm("09:02"), breaks, durationOf });
    expect(rows.map(r => [r.kind, r.start])).toEqual([["stop", hm("09:02")], ["break", hm("10:02")], ["stop", hm("10:17")]]);
  });

  it("is a wall: a task goes after it whole, and a later one that fits takes the time before it (Q36.2)", () => {
    const breaks = [{ start: hm("10:00"), end: hm("10:15"), name: "Break", added: 0 }];
    const rows = layoutRoute([task("A", 30), task("B", 60), task("C", 20)], { from: hm("09:00"), breaks, durationOf });
    expect(rows.map(r => [r.kind, r.task?.title ?? r.name, r.start, !!r.pulledForward])).toEqual([
      ["stop", "A", hm("09:00"), false],
      ["stop", "C", hm("09:35"), true],
      ["break", "Break", hm("10:00"), false],
      ["stop", "B", hm("10:15"), false],
    ]);
  });

  it("splits only the one thing already underway, which continues after it", () => {
    const breaks = [{ start: hm("11:35"), end: hm("11:50"), name: "Break", added: 0 }];
    const one = { ...task("One", 25), isNowFocus: true };
    const rows = layoutRoute([one, task("B", 25)], { from: hm("11:35"), breaks, durationOf });
    expect(rows.map(r => [r.kind, r.start])).toEqual([["break", hm("11:35")], ["stop", hm("11:50")], ["stop", hm("12:20")]]);
  });

  it("shows even with nothing after it, and keeps its row when it overlaps another break", () => {
    const breaks = [
      { start: hm("13:35"), end: hm("14:15"), name: "Break" },
      { start: hm("14:00"), end: hm("14:30"), name: "Break", added: 0 },
      { start: hm("16:00"), end: hm("16:15"), name: "Break", added: 1 },
    ];
    const rows = layoutRoute([task("A", 60)], { from: hm("13:00"), breaks, durationOf });
    const shown = rows.filter(r => r.kind === "break").map(r => [r.start, r.end, r.added]);
    // One you added keeps its own row, to open (loopcheck of #430).
    expect(shown).toEqual([[hm("13:35"), hm("14:15"), undefined], [hm("14:00"), hm("14:30"), 0], [hm("16:00"), hm("16:15"), 1]]);
    // A doesn't fit before the breaks: it goes after them, whole.
    expect(rows.filter(r => r.kind === "stop").map(r => [r.start, r.end])).toEqual([[hm("14:30"), hm("15:30")]]);
  });
});

describe("fitting a break around fixed stops (Q36.2, Q36a)", () => {
  const busy = [{ start: hm("12:40"), end: hm("13:10"), title: "Call" }];

  it("ends when a fixed stop starts", () => {
    expect(fitBreak(hm("12:30"), 15, busy)).toEqual({ start: hm("12:30"), lengthMin: 10, after: null, cut: "Call" });
  });

  it("starting inside one, starts when it ends", () => {
    expect(fitBreak(hm("12:50"), 15, busy)).toEqual({ start: hm("13:10"), lengthMin: 15, after: "Call", cut: null });
  });

  it("with under 5 minutes before one, goes after it", () => {
    expect(fitBreak(hm("12:37"), 15, busy)).toEqual({ start: hm("13:10"), lengthMin: 15, after: "Call", cut: null });
  });

  it("by default starts now, shortened to fit; with under 5 minutes, it takes the next free slot", () => {
    const route = (fixedAt) => layoutRoute([task("A", 60), task("Call", 30, fixedAt)], { from: hm("11:35"), durationOf });
    expect(defaultBreak(route("11:42"), hm("11:35"))).toEqual({ start: hm("11:35"), lengthMin: 7, after: null, cut: "Call" });
    expect(defaultBreak(route("11:38"), hm("11:35"))).toEqual({ start: hm("12:08"), lengthMin: 15, after: null, cut: null });
  });

  it("counts every break, shown or not, and leaves out the one being changed", () => {
    // Lunch after the last stop has no row, but a new break still can't overlap it.
    const breaks = [{ start: hm("13:35"), end: hm("14:15"), name: "Lunch" }, { start: hm("10:00"), end: hm("10:15"), name: "Break", added: 0 }];
    expect(busyFromRows([], breaks, 0)).toEqual([{ start: hm("13:35"), end: hm("14:15"), title: "Lunch" }]);
    expect(fitBreak(hm("13:30"), 15, busyFromRows([], breaks))).toEqual({ start: hm("13:30"), lengthMin: 5, after: null, cut: "Lunch" });
  });
});

describe("nextFreeSlot", () => {
  const rowsOf = (stops, breaks = []) => layoutRoute(stops, { from: hm("09:00"), breaks, durationOf });

  it("is now with nothing on the route", () => {
    expect(nextFreeSlot([], hm("09:02"))).toBe(hm("09:05"));
  });

  it("is the end of what you're doing now", () => {
    expect(nextFreeSlot(rowsOf([task("A", 60), task("B", 30)]), hm("09:10"))).toBe(hm("10:00"));
  });

  it("skips a slot that would run into a fixed stop", () => {
    // A ends 10:00, the call is at 10:10: 15 minutes don't fit; after the call they do.
    const rows = rowsOf([task("A", 60), task("Call", 30, "10:10")]);
    expect(nextFreeSlot(rows, hm("09:10"))).toBe(hm("10:40"));
  });
});
