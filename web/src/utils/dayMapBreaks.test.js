import { describe, expect, it } from "vitest";
import { addedBreaks, nextFreeSlot, routeBreaks, withAddedBreaks } from "./dayMapBreaks";
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

  it("shows even with nothing after it, and overlapping breaks show their time once", () => {
    const breaks = [
      { start: hm("13:35"), end: hm("14:15"), name: "Break" },
      { start: hm("14:00"), end: hm("14:30"), name: "Break", added: 0 },
      { start: hm("16:00"), end: hm("16:15"), name: "Break", added: 1 },
    ];
    const rows = layoutRoute([task("A", 300)], { from: hm("09:00"), breaks, durationOf });
    const shown = rows.filter(r => r.kind === "break").map(r => [r.start, r.end, r.added]);
    expect(shown).toEqual([[hm("13:35"), hm("14:15"), undefined], [hm("14:15"), hm("14:30"), 0], [hm("16:00"), hm("16:15"), 1]]);
    // The task stops for both and carries on at 14:30.
    expect(rows.filter(r => r.kind === "stop").map(r => r.start)).toEqual([hm("09:00"), hm("14:30")]);
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
