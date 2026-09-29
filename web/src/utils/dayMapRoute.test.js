import { describe, expect, it } from "vitest";
import { breaksFromWindows, layoutRoute, layoutStarts, shouldReflowPastRoute } from "./dayMapRoute";

describe("shouldReflowPastRoute", () => {
  it("returns true when the first scheduled task starts before the current anchor", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 720 }], 930)).toBe(true);
  });

  it("returns false when the route already starts at the anchor", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 930 }], 930)).toBe(false);
  });

  it("returns false when the route starts after the anchor", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 960 }], 930)).toBe(false);
  });

  it("returns false for empty or malformed routes", () => {
    expect(shouldReflowPastRoute([], 930)).toBe(false);
    expect(shouldReflowPastRoute(null, 930)).toBe(false);
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: "not-time" }], 930)).toBe(false);
  });
});


const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const task = (title, minutes, fixedAt) => ({ title, minutes, ...(fixedAt ? { dayMapFixedMinutes: hm(fixedAt) } : {}) });
const durationOf = (t) => t.minutes;
// "13:35 Lunch", "14:30 Call 🔒", "14:05 free 25m" — the rows as the rail reads them.
const read = (rows) => rows.map(r => r.kind === "break" ? `${clock(r.start)} ${r.name}`
  : r.kind === "free" ? `${clock(r.start)} free ${r.end - r.start}m`
  : `${clock(r.start)} ${r.task.title}${r.fixed ? " 🔒" : ""}${r.pulledForward ? " (pulled forward)" : ""}${r.continued ? " (continued)" : ""}`);

// The sample day: windows 08:00–13:35 and 14:15–17:30, the gap named Lunch.
const lunch = breaksFromWindows([{ startMin: hm("08:00"), endMin: hm("13:35") }, { startMin: hm("14:15"), endMin: hm("17:30") }], "Lunch");

describe("breaksFromWindows", () => {
  it("makes each gap between focus windows a break", () => {
    expect(lunch).toEqual([{ start: hm("13:35"), end: hm("14:15"), name: "Lunch" }]);
  });
  it("has none with one window, or windows that touch", () => {
    expect(breaksFromWindows([{ startMin: 420, endMin: 0, overnight: true }])).toEqual([]);
    expect(breaksFromWindows([{ startMin: 540, endMin: 720 }, { startMin: 720, endMin: 900 }])).toEqual([]);
  });
});

describe("layoutRoute", () => {
  it("lays flexible stops end to end with a 5-minute buffer", () => {
    const rows = layoutRoute([task("A", 25), task("B", 60)], { from: hm("09:00"), durationOf });
    expect(read(rows)).toEqual(["09:00 A", "09:30 B"]);
  });

  // 56a: no buffer before Lunch or after it; Pharmacy → the call is absorbed;
  // after the call there's a buffer, so 15:05. The day's last stop ends 18:10.
  it("reproduces the 56a rail", () => {
    const stops = [task("CV", 120), task("Pharmacy", 15), task("Call", 30, "14:30"), task("Hale", 25),
      task("Dad", 25), task("PRINCE2", 60), task("Grove", 45), task("Dentist", 10)];
    const rows = layoutRoute(stops, { from: hm("11:35"), breaks: lunch, durationOf });
    expect(read(rows)).toEqual(["11:35 CV", "13:35 Lunch", "14:15 Pharmacy", "14:30 Call 🔒", "15:05 Hale",
      "15:35 Dad", "16:05 PRINCE2", "17:10 Grove", "18:00 Dentist"]);
    expect(rows[rows.length - 1].end).toBe(hm("18:10"));
  });

  // 58e: fixing the call at 14:30 moves Hale 14:35 → 15:05, Dad and PRINCE2
  // after it; Pharmacy (14:15–14:30) still fits before it.
  it("moves a stop that would overlap a fixed one after it, in order (58e)", () => {
    const stops = [task("Pharmacy", 15), task("Hale", 25), task("Dad", 25), task("PRINCE2", 60)];
    const before = layoutRoute(stops, { from: hm("14:15"), durationOf });
    expect(read(before)).toEqual(["14:15 Pharmacy", "14:35 Hale", "15:05 Dad", "15:35 PRINCE2"]);
    const after = layoutRoute([...stops, task("Call", 30, "14:30")], { from: hm("14:15"), durationOf });
    expect(read(after)).toEqual(["14:15 Pharmacy", "14:30 Call 🔒", "15:05 Hale", "15:35 Dad", "16:05 PRINCE2"]);
  });

  // 58f: the 40-minute gap before the call takes the earliest later stop
  // that fits whole (the dentist, 10m); PRINCE2 (1h) doesn't fit in the 25
  // minutes left, so that time is free.
  it("fills the gap before a fixed stop with the earliest later stop that fits, the rest free (58f)", () => {
    const stops = [task("Brightlab", 45), task("PRINCE2", 60), task("Dentist", 10), task("Call", 30, "14:30")];
    const rows = layoutRoute(stops, { from: hm("13:00"), durationOf });
    expect(read(rows)).toEqual(["13:00 Brightlab", "13:50 Dentist (pulled forward)", "14:05 free 25m", "14:30 Call 🔒", "15:05 PRINCE2"]);
  });

  it("splits a task that runs into a break: it stops for it and continues after", () => {
    const rows = layoutRoute([task("CV", 180), task("Next", 25)], { from: hm("11:35"), breaks: lunch, durationOf });
    expect(read(rows)).toEqual(["11:35 CV", "13:35 Lunch", "14:15 CV (continued)", "15:20 Next"]);
    expect(rows[0]).toMatchObject({ end: hm("13:35"), continues: true });
    expect(rows[2].end).toBe(hm("15:15"));
  });

  it("splits a task over two breaks into three parts, each with its own start", () => {
    const twoBreaks = [...lunch, { start: hm("15:00"), end: hm("15:15"), name: "Tea" }];
    const rows = layoutRoute([task("Long", 240)], { from: hm("12:35"), breaks: twoBreaks, durationOf });
    expect(read(rows)).toEqual(["12:35 Long", "13:35 Lunch", "14:15 Long (continued)", "15:00 Tea", "15:15 Long (continued)"]);
    expect(rows[rows.length - 1].end).toBe(hm("17:30"));
  });

  it("a fixed stop inside a break takes that time; the break shows around it", () => {
    const rows = layoutRoute([task("Call", 30, "13:45"), task("After", 25)], { from: hm("13:00"), breaks: lunch, durationOf });
    const breaks = rows.filter(r => r.kind === "break").map(r => [clock(r.start), clock(r.end)]);
    expect(breaks).toEqual([["13:35", "13:45"]]);
    expect(read(rows)).toEqual(["13:00 After", "13:30 free 5m", "13:35 Lunch", "13:45 Call 🔒"]);
  });

  it("starts after a break when the route's start falls inside it", () => {
    const rows = layoutRoute([task("A", 25)], { from: hm("13:50"), breaks: lunch, durationOf });
    expect(read(rows)).toEqual(["13:35 Lunch", "14:15 A"]);
  });

  it("shows a break only when a stop comes after it", () => {
    const rows = layoutRoute([task("A", 25)], { from: hm("11:00"), breaks: lunch, durationOf });
    expect(read(rows)).toEqual(["11:00 A"]);
  });

  it("keeps a fixed stop the day has passed where it is, marked late, and pushes nothing", () => {
    const stops = [task("A", 25), task("Call", 30, "10:00")];
    const rows = layoutRoute(stops, { from: hm("11:00"), now: hm("11:00"), durationOf });
    expect(read(rows)).toEqual(["10:00 Call 🔒", "11:00 A"]);
    expect(rows[0].late).toBe(true);
  });

  it("puts the route after a fixed stop that is running at its start", () => {
    const stops = [task("A", 25), task("Call", 30, "10:50")];
    const rows = layoutRoute(stops, { from: hm("11:00"), now: hm("11:00"), durationOf });
    expect(read(rows)).toEqual(["10:50 Call 🔒", "11:25 A"]);
  });

  it("shows the time before a fixed stop as free when nothing is left to fill it", () => {
    const rows = layoutRoute([task("A", 25), task("Call", 30, "10:00")], { from: hm("09:00"), durationOf });
    expect(read(rows)).toEqual(["09:00 A", "09:30 free 30m", "10:00 Call 🔒"]);
    expect(rows[1].end).toBe(hm("10:00"));
  });

  it("leaves no free row for a gap under 5 minutes, and none over a break", () => {
    const tight = layoutRoute([task("A", 22), task("Call", 30, "09:30")], { from: hm("09:00"), durationOf });
    expect(read(tight)).toEqual(["09:00 A", "09:30 Call 🔒"]);
    const overLunch = layoutRoute([task("Call", 30, "14:45")], { from: hm("13:00"), breaks: lunch, durationOf });
    expect(read(overLunch)).toEqual(["13:00 free 35m", "13:35 Lunch", "14:15 free 30m", "14:45 Call 🔒"]);
  });

  it("gives each task its first part's start", () => {
    const stops = [task("CV", 180), task("Next", 25)];
    const starts = layoutStarts(layoutRoute(stops, { from: hm("11:35"), breaks: lunch, durationOf }));
    expect(starts.get(stops[0])).toBe(hm("11:35"));
    expect(starts.get(stops[1])).toBe(hm("15:20"));
  });
});

describe("shouldReflowPastRoute with fixed stops", () => {
  it("asks only about the first stop that flows, not a fixed one the day has passed", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 600, dayMapFixedMinutes: 600 }, { dayMapStartMinutes: 930 }], 930)).toBe(false);
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 600, dayMapFixedMinutes: 600 }, { dayMapStartMinutes: 900 }], 930)).toBe(true);
  });
  it("asks about the earliest stop, which a pulled-forward one can be", () => {
    expect(shouldReflowPastRoute([{ dayMapStartMinutes: 965 }, { dayMapStartMinutes: 890 }], 930)).toBe(true);
  });
});
