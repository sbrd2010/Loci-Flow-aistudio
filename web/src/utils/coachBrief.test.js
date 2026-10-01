import { describe, it, expect } from "vitest";
import { briefTaskRefs, buildBriefInput, parseBrief, moveTaskToHorizon, undoMoveTask } from "./coachBrief";
import { getFocusWindows } from "./focusWindows";

const windows = getFocusWindows({ focusWindows: [{ start: "07:00", end: "23:00" }] });
const now = new Date(2026, 9, 1, 9, 41);
const tasks = [
  { uuid: "a", title: "Pay the water tax", horizonLevel: "today", orderIndex: 1, timeEstimateMinutes: 15 },
  { uuid: "b", title: "Order medicine", horizonLevel: "today", orderIndex: 0, concreteStep: "Open the app" },
  { uuid: "c", title: "Complete PhD paper 02", horizonLevel: "month", timeEstimateMinutes: 360 },
  { uuid: "d", title: "Buy domain name", horizonLevel: "week", timeEstimateMinutes: 25 },
  { uuid: "e", title: "Old done", horizonLevel: "today", isCompleted: true },
];

describe("briefTaskRefs", () => {
  it("labels Today's open tasks first, then the biggest elsewhere", () => {
    expect(briefTaskRefs(tasks, { now, windows }).map(r => [r.id, r.task.uuid])).toEqual([["T1", "b"], ["T2", "a"], ["T3", "c"], ["T4", "d"]]);
  });
});

describe("buildBriefInput", () => {
  it("sends numbers for the three periods and the tasks by id, focus unknown when unread", () => {
    const { data } = buildBriefInput({ tasks, contributions: [{ dateString: "2026-10-01", count: 2 }], focusRaw: null, now, windows });
    expect(data.today.completed).toBe(2);
    expect(data.last7.focusedMinutes).toBeNull();
    expect(data.previous7.focusedMinutes).toBeNull();
    expect(data.tasks[0]).toMatchObject({ id: "T1", title: "Order medicine", horizon: "today", firstStep: "Open the app" });
    expect(data.tasks.length).toBeLessThanOrEqual(10);
  });
});

describe("parseBrief", () => {
  const refs = briefTaskRefs(tasks, { now, windows });
  it("keeps only groups that check out, by task id", () => {
    const reply = "```json\n" + JSON.stringify({
      howItWent: ["1h27m this week, against 4h10m the week before.", ""],
      patterns: [],
      tooMuch: { line: "21h10m on Today, 9h30m left.", items: [{ task: "T4", to: "week" }, { task: "T9", to: "week" }, { task: "T2", to: "today" }] },
      estimates: [{ task: "T3", fact: "6h as one task", action: "split" }, { task: "T1", fact: "x", action: "explode" }],
      next: { task: "T1", line: "First step: **Open the app**." },
    }) + "\n```";
    const brief = parseBrief(reply, refs, 123);
    expect(brief.at).toBe(123);
    expect(brief.howItWent).toEqual(["1h27m this week, against 4h10m the week before."]);
    expect(brief.patterns).toEqual([]);
    expect(brief.tooMuch.items).toEqual([{ uuid: "d", title: "Buy domain name", to: "week" }]);
    expect(brief.estimates).toEqual([{ uuid: "c", title: "Complete PhD paper 02", fact: "6h as one task", action: "split" }]);
    expect(brief.next).toEqual({ uuid: "b", title: "Order medicine", line: "First step: Open the app." });
  });
  it("returns null for a reply with nothing usable", () => {
    expect(parseBrief("Sorry, I can't.", refs)).toBeNull();
    expect(parseBrief(JSON.stringify({ howItWent: [], next: { task: "T99" } }), refs)).toBeNull();
  });
});

describe("moveTaskToHorizon / undoMoveTask", () => {
  it("moves to the bottom of the horizon and Undo puts it back", () => {
    const pinned = tasks.map(t => (t.uuid === "a" ? { ...t, isNowFocus: true } : t));
    const moved = moveTaskToHorizon(pinned, "a", "week", 50);
    const a = moved.tasks.find(t => t.uuid === "a");
    expect(a).toMatchObject({ horizonLevel: "week", orderIndex: 1, isNowFocus: false, lastUpdated: 50 });
    const back = undoMoveTask(moved.tasks, "a", moved, 60).find(t => t.uuid === "a");
    expect(back).toMatchObject({ horizonLevel: "today", orderIndex: 1, isNowFocus: true });
  });
  it("Undo does nothing once the task changed again", () => {
    const moved = moveTaskToHorizon(tasks, "a", "week", 50);
    const edited = moved.tasks.map(t => (t.uuid === "a" ? { ...t, lastUpdated: 70 } : t));
    expect(undoMoveTask(edited, "a", moved)).toBeNull();
  });
  it("refuses a target that isn't a horizon, or the one it's on", () => {
    expect(moveTaskToHorizon(tasks, "a", "today")).toBeNull();
    expect(moveTaskToHorizon(tasks, "d", "week")).toBeNull();
  });
});
