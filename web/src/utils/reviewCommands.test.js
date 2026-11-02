import { describe, expect, it } from "vitest";
import { decideReviewCommand, doneCommand, reviewLanded, reviewOutcome, undoCommand } from "./reviewCommands";
import { pendingReviews } from "./horizonReview";

// #643: review commands decided against the server's copy.
const MON = "2026-11-02", SUN = "2026-11-01", NEXT_MON = "2026-11-09";
const task = (uuid, extra = {}) => ({ uuid, title: `Sample ${uuid}`, horizonLevel: "week", isCompleted: false, isDeleted: false, isParked: false, lastUpdated: 10, ...extra });
const server = (extra = {}) => ({
  timestamp: 5,
  config: { lastUpdated: 5, horizonReviews: { week: { through: "2026-10-25" } } },
  tasks: [task("a"), task("b")],
  ...extra,
});
const write = (s, cmd) => {
  const d = decideReviewCommand(s, cmd);
  expect(d.action).toBe("write");
  return d.next;
};
const detected = () => write(server(), { kind: "detect", day: MON, now: 50 });
const review = (s) => pendingReviews(s.config, s.tasks, MON).find(r => r.id === "week");
const done = (s, choices = {}, op = "op-1") => doneCommand(review(s), choices, MON, 100, op);

describe("detect", () => {
  it("opens the ended period, stamped newer than the server", () => {
    const s = detected();
    expect(s.config.horizonReviews.week.pending).toMatchObject({ end: SUN, uuids: ["a", "b"] });
    expect(s.timestamp).toBe(50);
    expect(s.config.lastUpdated).toBe(50);
  });
  it("is a no-op when the server already has it, finished or not", () => {
    const s = detected();
    expect(decideReviewCommand(s, { kind: "detect", day: MON, now: 60 })).toEqual({ action: "noop" });
    const finished = write(s, done(s));
    expect(decideReviewCommand(finished, { kind: "detect", day: MON, now: 300 })).toEqual({ action: "noop" });
  });
  it("never moves the server's timestamp backwards", () => {
    expect(write(server({ timestamp: 900 }), { kind: "detect", day: MON, now: 50 }).timestamp).toBe(900);
  });
});

describe("done", () => {
  it("applies the choices and records the op", () => {
    const s = detected();
    const next = write(s, done(s, { a: "today", b: "drop" }));
    expect(next.config.horizonReviews.week.pending).toBe(null);
    expect(next.config.horizonReviews.week.last).toMatchObject({ end: SUN, today: 1, dropped: 1, kept: 0, op: "op-1" });
    expect(next.tasks.find(t => t.uuid === "a").horizonLevel).toBe("today");
    expect(next.tasks.find(t => t.uuid === "b").isDeleted).toBe(true);
  });
  it("the first Done wins; the second is already-reviewed", () => {
    const s = detected();
    const first = write(s, done(s, { a: "today" }));
    expect(decideReviewCommand(first, done(s, { a: "drop", b: "drop" }, "op-2"))).toEqual({ action: "conflict", reason: "already-reviewed" });
  });
  it("a Done for an older period can't close a newer one", () => {
    const s = detected();
    const newer = write(s, { kind: "detect", day: NEXT_MON, now: 200 });
    expect(decideReviewCommand(newer, done(s))).toEqual({ action: "conflict", reason: "stale-period" });
  });
  it("conflicts when a shown task changed, left, or a new one became eligible", () => {
    const s = detected();
    const cmd = done(s);
    const edit = (fn) => ({ ...s, tasks: fn(s.tasks) });
    expect(decideReviewCommand(edit(ts => ts.map(t => (t.uuid === "a" ? { ...t, lastUpdated: 99 } : t))), cmd).reason).toBe("tasks-changed");
    expect(decideReviewCommand(edit(ts => ts.map(t => (t.uuid === "a" ? { ...t, isCompleted: true } : t))), cmd).reason).toBe("tasks-changed");
    // c joins the pending list on the server (a newer detect took it in).
    const joined = { ...s, tasks: [...s.tasks, task("c")], config: { ...s.config, horizonReviews: { week: { ...s.config.horizonReviews.week, pending: { ...s.config.horizonReviews.week.pending, uuids: ["a", "b", "c"] } } } } };
    expect(decideReviewCommand(joined, cmd).reason).toBe("tasks-changed");
  });
  it("tasks without lastUpdated (older data) still compare", () => {
    const s = write(server({ tasks: [task("a", { lastUpdated: undefined })] }), { kind: "detect", day: MON, now: 50 });
    expect(decideReviewCommand(s, done(s)).action).toBe("write");
  });
});

describe("undo", () => {
  const setup = (choices) => {
    const before = detected();
    const cmd = done(before, choices);
    const after = write(before, cmd);
    return { before, after, undo: { ...undoCommand(cmd, before, after), now: 500 } };
  };
  it("restores the review and only the tasks the Done changed", () => {
    const { after, undo } = setup({ a: "today" });
    expect(undo.beforeTasks.map(t => t.uuid)).toEqual(["a"]);
    const back = write(after, undo);
    expect(back.config.horizonReviews.week.pending).toMatchObject({ end: SUN, uuids: ["a", "b"] });
    expect(back.tasks.find(t => t.uuid === "a")).toMatchObject({ horizonLevel: "week", lastUpdated: 500 });
    expect(back.tasks.find(t => t.uuid === "a").reviewFrom).toBeUndefined();
  });
  it("is all or nothing: a moved task changed since → conflict, nothing written", () => {
    const { after, undo } = setup({ a: "today", b: "drop" });
    const changed = { ...after, tasks: after.tasks.map(t => (t.uuid === "a" ? { ...t, lastUpdated: 777 } : t)) };
    expect(decideReviewCommand(changed, undo)).toEqual({ action: "conflict", reason: "changed-since" });
  });
  it("conflicts when another Done or a newer period came after", () => {
    const { after, undo } = setup({ a: "today" });
    const newer = write(after, { kind: "detect", day: NEXT_MON, now: 600 });
    expect(decideReviewCommand(newer, undo).reason).toBe("changed-since");
    expect(decideReviewCommand(after, { ...undo, op: "someone-else" }).reason).toBe("changed-since");
  });
  it("a keep-all Done undoes too: the review only", () => {
    const { after, undo } = setup({});
    expect(undo.after).toEqual({});
    const back = write(after, undo);
    expect(back.config.horizonReviews.week.pending.end).toBe(SUN);
    expect(back.tasks).toEqual(after.tasks);
  });
  it("restored tasks are stamped newer than the Done's copy even if the clock is behind", () => {
    const { after, undo } = setup({ a: "today" });
    const back = write(after, { ...undo, now: 1 });
    expect(back.tasks.find(t => t.uuid === "a").lastUpdated).toBe(after.tasks.find(t => t.uuid === "a").lastUpdated + 1);
  });
});

describe("reviewOutcome: from the transaction's real result", () => {
  const decide = (d) => () => d;
  it("accepted only when committed", () => {
    expect(reviewOutcome(true, {}, decide({ action: "conflict", reason: "x" }))).toEqual({ outcome: "accepted" });
    expect(reviewOutcome(false, {}, decide({ action: "noop" }))).toEqual({ outcome: "noop" });
    expect(reviewOutcome(false, {}, decide({ action: "conflict", reason: "tasks-changed" }))).toEqual({ outcome: "conflict", reason: "tasks-changed" });
  });
  it("not committed but would still write, or no data: failed, never success", () => {
    expect(reviewOutcome(false, {}, decide({ action: "write" })).outcome).toBe("failed");
    expect(reviewOutcome(false, null, decide({ action: "write" }))).toEqual({ outcome: "failed", reason: "no-data" });
  });
});

describe("reviewLanded: after a dropped connection, the server's record says whether it applied", () => {
  const rec = (s) => s.config.horizonReviews.week;
  it("Done: its op is the review's last; Undo: its op is marked undone", () => {
    const before = detected();
    const cmd = done(before, { a: "today" });
    const after = write(before, cmd);
    expect(reviewLanded(rec(before), cmd)).toBe(false);
    expect(reviewLanded(rec(after), cmd)).toBe(true);
    expect(reviewLanded(rec(after), { ...cmd, op: "other" })).toBe(false);
    expect(reviewLanded(null, cmd)).toBe(false);
    const undo = { ...undoCommand(cmd, before, after), now: 500 };
    expect(reviewLanded(rec(after), undo)).toBe(false);
    expect(reviewLanded(rec(write(after, undo)), undo)).toBe(true);
  });
});
