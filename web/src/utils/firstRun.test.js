import { describe, it, expect } from "vitest";
import { startGuide, guideReducer, reconcileGuide, guideCard, loadGuide, saveGuide, exampleForNeed, boxReducer, saveFirstTask, isTrustedLoad, stepsLabel, LAST_STOP } from "./firstRun";

const run = (state, ...actions) => actions.reduce((s, a) => guideReducer(s, typeof a === "string" ? { type: a } : a), state);
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

describe("first-run guide", () => {
  it("goes task → pin → ready → tour → back to Ready with Start focus, never starting focus itself", () => {
    let s = run(startGuide(), { type: "taskAdded", uuid: "t1" }, { type: "pinned", uuid: "t1" });
    expect(s.step).toBe("ready");
    s = run(s, "startTour");
    expect(s).toMatchObject({ step: "tour", stop: 0, tourStarted: true });
    for (let i = 0; i < LAST_STOP; i++) s = run(s, "next");
    expect(s.stop).toBe(LAST_STOP);
    s = run(s, "next");
    expect(s).toMatchObject({ step: "ready", afterTour: true, focused: false });
    expect(guideCard(s).targets).toContain("start");
    s = run(s, "focusStarted", "focusEnded");
    expect(s).toMatchObject({ step: "done", note: "done" });
  });

  it("an early focus pauses the tour and offers it once afterwards", () => {
    let s = run(startGuide(), { type: "taskAdded", uuid: "t1" }, { type: "pinned", uuid: "t1" });
    s = run(s, "focusStarted", "focusEnded");
    expect(s.resume).toBe(true);
    expect(guideCard(s)).toMatchObject({ title: "Nice start", primary: { action: "resumeTour" } });
    // Partway through, it resumes at the same stop.
    s = run(s, "resumeTour", "next", "next", "focusStarted", "focusEnded");
    expect(guideCard(s).title).toBe("3 tour stops left");
    s = run(s, "resumeTour");
    expect(s).toMatchObject({ step: "tour", stop: 2, resume: false });
    // Finishing after a focus ends the guide instead of returning to Ready.
    s = run(s, "next", "next", "next");
    expect(s).toMatchObject({ step: "done", note: "done" });
  });

  it("Later and Skip end the guide; nothing after them brings it back", () => {
    const pinned = run(startGuide(), { type: "taskAdded", uuid: "t1" }, { type: "pinned", uuid: "t1" });
    expect(run(pinned, "focusStarted", "focusEnded", "later")).toMatchObject({ step: "done", note: "later" });
    const skipped = run(pinned, "skip");
    expect(skipped).toMatchObject({ step: "done", note: "skipped" });
    expect(run(skipped, "focusStarted", "focusEnded").resume).toBe(false);
  });

  it("replay is always the tour, never a new-task step, and ends without Start focus when nothing is in Now", () => {
    expect(guideReducer(null, { type: "replay", pinnedUuid: "p" })).toMatchObject({ step: "tour", stop: 0, taskUuid: "p" });
    const empty = guideReducer(null, { type: "replay" });
    expect(empty).toMatchObject({ step: "tour", stop: 0, taskUuid: null });
    expect(guideCard(empty).text).toContain("shows here once you");
    expect(guideCard(empty).targets).not.toContain("now");
    let s = empty;
    for (let i = 0; i <= LAST_STOP; i++) s = run(s, "next");
    expect(s).toMatchObject({ step: "done", note: "done" });
  });

  it("follows the saved tasks: a pin made anywhere moves it on; their own task gone keeps it on Do this now", () => {
    const s = run(startGuide(), { type: "taskAdded", uuid: "t1" });
    expect(reconcileGuide(s, [{ uuid: "t1" }])).toBeNull();
    expect(reconcileGuide(s, [{ uuid: "t1", isNowFocus: true }])).toEqual({ type: "pinned", uuid: "t1" });
    // Pinning a different open task still counts as doing the step.
    expect(reconcileGuide(s, [{ uuid: "t1" }, { uuid: "t2", isNowFocus: true }])).toEqual({ type: "pinned", uuid: "t2" });
    expect(reconcileGuide(s, [{ uuid: "t1", isDeleted: true }])).toEqual({ type: "ownGone" });
    expect(reconcileGuide(run(s, { type: "pinned", uuid: "t1" }), [])).toEqual({ type: "unpinned", keep: false });
    expect(reconcileGuide(run(s, "skip"), [])).toBeNull();
  });

  it("keeps progress per account and ignores anything malformed", () => {
    const store = memory();
    saveGuide("a", { ...startGuide(), step: "pin", taskUuid: "t1" }, store);
    expect(loadGuide("a", store)).toMatchObject({ step: "pin", taskUuid: "t1" });
    expect(loadGuide("b", store)).toBeNull();
    store.setItem("loci_first_run_v1:c", JSON.stringify({ step: "tour", stop: 99 }));
    expect(loadGuide("c", store)).toBeNull();
    store.setItem("loci_first_run_v1:d", "{not json");
    expect(loadGuide("d", store)).toBeNull();
    saveGuide("a", null, store);
    expect(loadGuide("a", store)).toBeNull();
  });

  it("opens the Coach example that fits the answer", () => {
    expect(exampleForNeed("overwhelmed")).toBe(1);
    expect(exampleForNeed(undefined)).toBe(2);
  });

  it("never saves the closing note, so a reload does not show it again", () => {
    const store = memory();
    const skipped = run(startGuide(), { type: "taskAdded", uuid: "t1" }, "skip");
    expect(skipped.note).toBe("skipped");
    saveGuide("a", skipped, store);
    expect(loadGuide("a", store)).toMatchObject({ step: "done", note: null });
  });

  it("an action for one account never lands on another account's guide (A → B → A)", () => {
    const a = { uid: "A", state: run(startGuide(), { type: "taskAdded", uuid: "a1" }) };
    const b = { uid: "B", state: run(startGuide(), { type: "taskAdded", uuid: "b1" }) };
    // A's tasks are gone from view while B loads: computed against A, sent while B is current.
    const stale = reconcileGuide(a.state, []);
    expect(stale).toEqual({ type: "ownGone" });
    expect(boxReducer(b, "A", stale)).toBe(b);
    expect(boxReducer(b, "B", { type: "pinned", uuid: "b1" }).state.step).toBe("ready");
    // Back on A, its own guide is intact.
    expect(boxReducer(a, "A", { type: "pinned", uuid: "a1" })).toMatchObject({ uid: "A", state: { step: "ready", taskUuid: "a1" } });
  });

  it("rings only the person's own task at the pin step, never the starter tasks", () => {
    const s = run(startGuide(), { type: "taskAdded", uuid: "t1" });
    expect(guideCard(s, { taskTitle: "Reply to the landlord" })).toMatchObject({ targets: ["own", "donow", "nav-today"] });
    // With no task of their own (e.g. it was dropped), Up next is ringed, never a starter task.
    expect(guideCard(guideReducer(s, { type: "ownGone" })).targets).toEqual(["upnext", "donow", "nav-today"]);
  });

  it("tells a refused first-task save apart from one still on its way", async () => {
    expect((await saveFirstTask(() => Promise.reject(new Error("write blocked by drop-guard")), {})).result).toBe("blocked");
    expect((await saveFirstTask(() => Promise.resolve(), {})).result).toBe("saved");
    expect((await saveFirstTask(() => new Promise(() => {}), {})).result).toBe("pending");
  });

  it("cached data the server hasn't confirmed never rewinds the guide, but a pin in it still counts", () => {
    const pin = run(startGuide(), { type: "taskAdded", uuid: "t1" });
    expect(reconcileGuide(pin, [], { trusted: false })).toBeNull();
    expect(reconcileGuide(pin, [], { trusted: true })).toEqual({ type: "ownGone" });
    expect(reconcileGuide(pin, [{ uuid: "t1", isNowFocus: true }], { trusted: false })).toEqual({ type: "pinned", uuid: "t1" });
    const ready = run(pin, { type: "pinned", uuid: "t1" });
    expect(reconcileGuide(ready, [], { trusted: false })).toBeNull();
  });

  it("a guided task that leaves Now ends the tour quietly, or goes back to Do this now; it never pins another", () => {
    const ready = run(startGuide(), { type: "taskAdded", uuid: "t1" }, { type: "pinned", uuid: "t1" });
    // Before the tour: done elsewhere, parked or unpinned → back to Do this now on a task.
    // Still open, only unpinned: keep pointing at it.
    expect(reconcileGuide(ready, [{ uuid: "t1" }])).toEqual({ type: "unpinned", keep: true });
    expect(guideReducer(ready, { type: "unpinned", keep: true })).toMatchObject({ step: "pin", taskUuid: "t1" });
    // Done, parked or deleted: drop it and ask for any open task, never a new one.
    for (const tasks of [[{ uuid: "t1", isCompleted: true, isNowFocus: true }], [{ uuid: "t1", isParked: true, isNowFocus: true }], []]) {
      const action = reconcileGuide(ready, tasks);
      expect(action).toEqual({ type: "unpinned", keep: false });
      const pin = guideReducer(ready, action);
      expect(pin).toMatchObject({ step: "pin", taskUuid: null });
      expect(guideCard(pin).text).toContain("Open any task in Up next");
      // With no guided task, nothing more can send it to the new-task sheet.
      expect(reconcileGuide(pin, [])).toBeNull();
    }
    // After the tour: no Start focus for a task that is gone; the guide just ends.
    const after = run(ready, "startTour", "next", "next", "next", "next", "next");
    expect(after).toMatchObject({ step: "ready", afterTour: true });
    expect(reconcileGuide(after, [{ uuid: "t1", isCompleted: true }])).toEqual({ type: "targetGone" });
    expect(run(after, "targetGone")).toMatchObject({ step: "done", note: "done" });
    // Still in Now: nothing changes. The resume card is left alone.
    expect(reconcileGuide(after, [{ uuid: "t1", isNowFocus: true }])).toBeNull();
    expect(reconcileGuide(run(ready, "focusStarted", "focusEnded"), [])).toBeNull();
  });

  it("the Up next stop offers an optional Open Day map", () => {
    const s = run(startGuide(), { type: "taskAdded", uuid: "t1" }, { type: "pinned", uuid: "t1" }, "startTour", "next");
    expect(guideCard(s)).toMatchObject({ stopId: "upnext", extra: { action: "openDayMap" } });
  });

  it("offline after the 15 s timeout (no server reply yet) still never rewinds the guide", () => {
    const trustedFor = isTrustedLoad;
    expect(isTrustedLoad({ isSyncingFromCache: true })).toBe(false);
    expect(isTrustedLoad({ demoMode: true, isSyncingFromCache: true })).toBe(true);
    const ready = run(startGuide(), { type: "taskAdded", uuid: "t1" }, { type: "pinned", uuid: "t1" });
    expect(reconcileGuide(ready, [], { trusted: trustedFor({ isSyncingFromCache: false, syncWarning: "offline" }) })).toBeNull();
    // The real data arrives later with the task still in Now: nothing to do.
    expect(reconcileGuide(ready, [{ uuid: "t1", isNowFocus: true }], { trusted: trustedFor({ isSyncingFromCache: false, syncWarning: null }) })).toBeNull();
  });

  it("at Do this now, their own task done, parked or deleted drops it and stays on that step; never a new-task sheet", () => {
    const pin = run(startGuide(), { type: "taskAdded", uuid: "t1" });
    for (const tasks of [[{ uuid: "t1", isCompleted: true }], [{ uuid: "t1", isParked: true }], [{ uuid: "t1", isDeleted: true }]]) {
      const action = reconcileGuide(pin, tasks);
      expect(action).toEqual({ type: "ownGone" });
      const next = guideReducer(pin, action);
      expect(next).toMatchObject({ step: "pin", taskUuid: null });
      expect(guideCard(next).text).toContain("Open any task in Up next");
      expect(reconcileGuide(next, tasks)).toBeNull();
    }
  });

  it("a first-task save that lands after Skip does not bring the guide back", () => {
    const skipped = run(startGuide(), "skip");
    expect(guideReducer(skipped, { type: "taskAdded", uuid: "t1" })).toBe(skipped);
    expect(run(startGuide(), { type: "taskAdded", uuid: "t1" })).toMatchObject({ step: "pin", taskUuid: "t1" });
  });

  it("calls the steps GETTING STARTED when reopened from Today, YOUR FIRST TASK on a first run", () => {
    const first = guideReducer(null, { type: "start" });
    const howTo = guideReducer(null, { type: "start", howTo: true });
    expect(stepsLabel(first)).toBe("YOUR FIRST TASK");
    expect(stepsLabel(howTo)).toBe("GETTING STARTED");
    expect(guideCard(run(howTo, { type: "taskAdded", uuid: "t1" })).kicker).toBe("GETTING STARTED · 3 OF 3");
    expect(guideCard(run(first, { type: "taskAdded", uuid: "t1" })).kicker).toBe("YOUR FIRST TASK · 3 OF 3");
  });
});
