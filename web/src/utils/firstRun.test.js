import { describe, it, expect } from "vitest";
import { startGuide, guideReducer, reconcileGuide, guideCard, loadGuide, saveGuide, exampleForNeed, boxReducer, saveFirstTask, LAST_STOP } from "./firstRun";

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

  it("replay never makes a task: tours from a pinned task, else asks for Do this now, else offers the sheet", () => {
    expect(guideReducer(null, { type: "replay", pinnedUuid: "p" })).toMatchObject({ step: "tour", stop: 0, taskUuid: "p" });
    expect(guideReducer(null, { type: "replay", hasTask: true })).toMatchObject({ step: "pin", taskUuid: null });
    expect(guideReducer(null, { type: "replay" })).toMatchObject({ step: "task" });
  });

  it("follows the saved tasks: a pin made anywhere moves it on, a deleted task sends it back", () => {
    const s = run(startGuide(), { type: "taskAdded", uuid: "t1" });
    expect(reconcileGuide(s, [{ uuid: "t1" }])).toBeNull();
    expect(reconcileGuide(s, [{ uuid: "t1", isNowFocus: true }])).toEqual({ type: "pinned", uuid: "t1" });
    // Pinning a different open task still counts as doing the step.
    expect(reconcileGuide(s, [{ uuid: "t1" }, { uuid: "t2", isNowFocus: true }])).toEqual({ type: "pinned", uuid: "t2" });
    expect(reconcileGuide(s, [{ uuid: "t1", isDeleted: true }])).toEqual({ type: "taskGone" });
    expect(reconcileGuide(run(s, { type: "pinned", uuid: "t1" }), [])).toEqual({ type: "taskGone" });
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
    expect(stale).toEqual({ type: "taskGone" });
    expect(boxReducer(b, "A", stale)).toBe(b);
    expect(boxReducer(b, "B", { type: "pinned", uuid: "b1" }).state.step).toBe("ready");
    // Back on A, its own guide is intact.
    expect(boxReducer(a, "A", { type: "pinned", uuid: "a1" })).toMatchObject({ uid: "A", state: { step: "ready", taskUuid: "a1" } });
  });

  it("rings only the person's own task at the pin step, never the starter tasks", () => {
    const s = run(startGuide(), { type: "taskAdded", uuid: "t1" });
    expect(guideCard(s, { taskTitle: "Reply to the landlord" })).toMatchObject({ targets: ["own", "donow", "nav-today"] });
    expect(guideCard(guideReducer(null, { type: "replay", hasTask: true })).targets).toContain("upnext");
  });

  it("tells a refused first-task save apart from one still on its way", async () => {
    expect((await saveFirstTask(() => Promise.reject(new Error("write blocked by drop-guard")), {})).result).toBe("blocked");
    expect((await saveFirstTask(() => Promise.resolve(), {})).result).toBe("saved");
    expect((await saveFirstTask(() => new Promise(() => {}), {})).result).toBe("pending");
  });
});
