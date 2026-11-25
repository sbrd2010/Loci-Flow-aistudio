import { describe, it, expect } from "vitest";
import { planTaskChip } from "./taskChip";

// #680 Phase 1b: a Coach task chip, decided at confirm against the live
// payload. Pure: it returns the next payload and what changed, or null.
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const TODAY = "2026-11-25";
const NOW = 5000;
const task = (uuid, extra = {}) => ({ uuid, title: `Sample ${uuid}`, horizonLevel: "today", isCompleted: false, isDeleted: false, isParked: false, isNowFocus: false, orderIndex: 0, lastUpdated: 1, ...extra });
const live = (tasks, extra = {}) => deepFreeze({ userId: "u", timestamp: 1, config: { userName: "Changed elsewhere" }, contributions: [{ dateString: TODAY, count: 1 }], brainDump: [{ id: "b1", text: "Sample thought" }], chatHistory: [{ text: "Sample", isUser: true }], tasks, ...extra });
const plan = (p, action, uuid = "t") => planTaskChip(p, action, uuid, { now: NOW, todayStr: TODAY });
const keepsRest = (p, r) => { for (const k of ["config", "contributions", "brainDump", "chatHistory", "userId"]) expect(r.next[k]).toBe(p[k]); };

describe("planTaskChip: what each chip does, from the live payload (#680)", () => {
  it("focus: pins the target, unpins the other, keeps everything else", () => {
    const p = live([task("t"), task("o", { isNowFocus: true })]);
    const r = plan(p, "focus");
    expect(r.next.tasks.find(t => t.uuid === "t")).toMatchObject({ isNowFocus: true, lastUpdated: NOW });
    expect(r.next.tasks.find(t => t.uuid === "o")).toMatchObject({ isNowFocus: false });
    expect(r.transition).toMatchObject({ unpinnedUuid: "o", wasParked: false });
    keepsRest(p, r);
  });
  it("focus+today: moves to Today at the end, undefers, unparks, pins", () => {
    const p = live([task("a", { orderIndex: 4 }), task("t", { horizonLevel: "week", deferredUntil: "2026-12-01", isParked: true })]);
    const r = plan(p, "focus+today");
    expect(r.next.tasks.find(t => t.uuid === "t")).toMatchObject({ horizonLevel: "today", deferredUntil: null, isParked: false, isNowFocus: true, orderIndex: 5, lastUpdated: NOW });
    expect(r.transition).toMatchObject({ fromHorizon: "week", wasOnToday: false, wasParked: true, unpinnedUuid: null });
    // On Today but parked: unparked and pinned, and it was already on Today (no move to log).
    expect(plan(live([task("t", { isParked: true })]), "focus+today").transition).toMatchObject({ wasOnToday: true, wasParked: true });
    keepsRest(p, r);
  });
  it("today: moves to Today without pinning, and unpins the target if it was the now task", () => {
    const p = live([task("t", { horizonLevel: "week", isNowFocus: true })]);
    const r = plan(p, "today");
    expect(r.next.tasks[0]).toMatchObject({ horizonLevel: "today", isNowFocus: false, isParked: false, deferredUntil: null, lastUpdated: NOW });
    expect(r.transition).toMatchObject({ unpinnedUuid: "t", fromHorizon: "week" });
  });
  it("park: parks and unpins the target", () => {
    const p = live([task("t", { isNowFocus: true })]);
    const r = plan(p, "park");
    expect(r.next.tasks[0]).toMatchObject({ isParked: true, parkedAt: NOW, isNowFocus: false });
    expect(r.transition).toMatchObject({ unpinnedUuid: "t" });
    keepsRest(p, r);
  });
});

describe("planTaskChip: nothing to do (null) when the target changed meanwhile (#680)", () => {
  for (const action of ["focus", "focus+today", "today", "park"]) {
    it(`${action}: target deleted, missing or completed`, () => {
      expect(plan(live([task("t", { isDeleted: true })]), action)).toBeNull();
      expect(plan(live([task("other")]), action)).toBeNull();
      expect(plan(live([task("t", { isCompleted: true })]), action)).toBeNull();
    });
  }
  it("focus and focus+today: never for a task at a set time (Q36.3); today and park still allowed for one", () => {
    const event = { horizonLevel: "today", fixedKind: "event", dayMapFixedMinutes: 600, dayMapDate: TODAY };
    expect(plan(live([task("t", event)]), "focus")).toBeNull();
    expect(plan(live([task("t", { ...event, horizonLevel: "week" })]), "focus+today")).toBeNull();
    expect(plan(live([task("t", { ...event, horizonLevel: "week" })]), "today")).not.toBeNull();
    expect(plan(live([task("t", event)]), "park")).not.toBeNull();
  });
  it("already in the chip's state: nothing is rewritten or restamped", () => {
    expect(plan(live([task("t", { isNowFocus: true })]), "focus")).toBeNull();
    expect(plan(live([task("t", { isNowFocus: true })]), "focus+today")).toBeNull();
    expect(plan(live([task("t")]), "today")).toBeNull();
    expect(plan(live([task("t", { isParked: true })]), "park")).toBeNull();
  });
  it("focus is not widened into a move: a target that left Today (or was deferred) meanwhile", () => {
    expect(plan(live([task("t", { horizonLevel: "week" })]), "focus")).toBeNull();
    expect(plan(live([task("t", { deferredUntil: "2026-12-01" })]), "focus")).toBeNull();
  });
  it("today still applies to a task deferred to a later day (it is not on Today)", () => {
    const r = plan(live([task("t", { deferredUntil: "2026-12-01" })]), "today");
    expect(r.next.tasks[0]).toMatchObject({ deferredUntil: null, horizonLevel: "today" });
  });
});
