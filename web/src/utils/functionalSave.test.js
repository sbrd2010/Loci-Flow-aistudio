import { describe, it, expect, vi } from "vitest";
import { resolveFunctionalSave } from "./functionalSave";

// #680: a functional save is decided against the live payload, at apply time,
// and only for the session that created it.
const live = () => Object.freeze({
  userId: "sample@example.test",
  timestamp: 100,
  tasks: Object.freeze([Object.freeze({ uuid: "a", title: "Sample A" })]),
  config: Object.freeze({ userName: "Sample" }),
  contributions: Object.freeze([]),
  brainDump: Object.freeze([]),
});
const owner = (over = {}) => ({ uid: "u1", currentUid: "u1", payloadUid: "u1", session: 3, currentSession: 3, ...over });
const add = (p) => ({ ...p, tasks: [...p.tasks, { uuid: "b", title: "Sample B" }] });

describe("resolveFunctionalSave: owner and session first (#680)", () => {
  for (const [name, over, current] of [
    ["no uid", { uid: null }, live()],
    ["another account is current", { currentUid: "u2" }, live()],
    ["the live payload belongs to another account", { payloadUid: "u2" }, live()],
    ["no live payload yet", {}, null],
    ["a stale session (signed out and back in)", { session: 2 }, live()],
  ]) {
    it(`refuses, without calling the updater: ${name}`, () => {
      const update = vi.fn(add);
      expect(resolveFunctionalSave({ update, live: current, owner: owner(over) })).toEqual({ outcome: "refused:owner" });
      expect(update).not.toHaveBeenCalled();
    });
  }
});

describe("resolveFunctionalSave: the updater's result (#680)", () => {
  it("applies a complete payload, calling the updater once with the live copy", () => {
    const update = vi.fn(add);
    const current = live();
    const r = resolveFunctionalSave({ update, live: current, owner: owner() });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(current);
    expect(r.outcome).toBe("applied");
    expect(r.next.tasks.map(t => t.uuid)).toEqual(["a", "b"]);
  });
  it("null is a deliberate no-op", () => {
    expect(resolveFunctionalSave({ update: () => null, live: live(), owner: owner() })).toEqual({ outcome: "noop" });
  });
  it("a throw is refused, with the error kept", () => {
    const r = resolveFunctionalSave({ update: () => { throw new Error("boom"); }, live: live(), owner: owner() });
    expect(r.outcome).toBe("refused:threw");
    expect(r.error.message).toBe("boom");
  });
  for (const [name, result] of [
    ["undefined (forgot to return)", undefined],
    ["an array", []],
    ["a string", "tasks"],
    ["a thenable", Promise.resolve({})],
    ["{} (would empty everything through normalisation)", {}],
    ["a partial object", { config: { userName: "Sample" } }],
    ["tasks that aren't an array", { ...live(), tasks: {} }],
    ["config that isn't an object", { ...live(), config: [] }],
  ]) {
    it(`refuses an incomplete or malformed result: ${name}`, () => {
      expect(resolveFunctionalSave({ update: () => result, live: live(), owner: owner() }).outcome).toBe("refused:invalid");
    });
  }
  // Review of #681: a known collection replaced by the wrong type, or a live
  // field set to undefined, would be turned into an empty list by
  // normalisation and read by the merges as a deletion.
  for (const [name, result] of [
    ["brainDump set to null", p => ({ ...p, brainDump: null })],
    ["contributions as an object", p => ({ ...p, contributions: {} })],
    ["chatHistory as a string", p => ({ ...p, chatHistory: "x" })],
    ["a live field set to undefined", p => ({ ...p, userId: undefined })],
    ["a plain object with a then method", p => ({ ...p, then() {} })],
  ]) {
    it(`refuses a malformed replacement: ${name}`, () => {
      const current = { ...live(), chatHistory: [{ text: "Sample", isUser: true }] };
      expect(resolveFunctionalSave({ update: result, live: current, owner: owner() }).outcome).toBe("refused:invalid");
    });
  }
  it("accepts legitimate shapes: emptied lists, a field the live payload lacks, a new field", () => {
    const emptied = resolveFunctionalSave({ update: p => ({ ...p, brainDump: [], contributions: [] }), live: live(), owner: owner() });
    expect(emptied.outcome).toBe("applied");
    // live() has no chatHistory: the result may leave it out or add one.
    expect(resolveFunctionalSave({ update: p => ({ ...p }), live: live(), owner: owner() }).outcome).toBe("applied");
    expect(resolveFunctionalSave({ update: p => ({ ...p, chatHistory: [] }), live: live(), owner: owner() }).outcome).toBe("applied");
    // Loopcheck of #681: a live value that is already not a list (e.g. RTDB
    // returning a sparse list as an object) passes through unchanged.
    const odd = { ...live(), chatHistory: { 0: { text: "Sample", isUser: true } } };
    expect(resolveFunctionalSave({ update: p => ({ ...p, tasks: [...p.tasks] }), live: odd, owner: owner() }).outcome).toBe("applied");
    expect(resolveFunctionalSave({ update: p => ({ ...p, chatHistory: { other: true } }), live: odd, owner: owner() }).outcome).toBe("refused:invalid");
    // A conversation cleared to null (CoachTab clearConversation) stays saveable.
    expect(resolveFunctionalSave({ update: p => ({ ...p }), live: { ...live(), chatHistory: null }, owner: owner() }).outcome).toBe("applied");
  });
  it("refuses a result that drops a top-level key the live payload has", () => {
    const { brainDump: _dropped, ...rest } = live();
    expect(resolveFunctionalSave({ update: () => rest, live: live(), owner: owner() }).outcome).toBe("refused:invalid");
  });
  it("does not change the live payload (frozen inputs)", () => {
    const current = live();
    expect(() => resolveFunctionalSave({ update: add, live: current, owner: owner() })).not.toThrow();
    expect(current.tasks.map(t => t.uuid)).toEqual(["a"]);
  });
  it("two functions in a row compose: the second sees the first's result", () => {
    const first = resolveFunctionalSave({ update: add, live: live(), owner: owner() });
    const second = resolveFunctionalSave({ update: p => ({ ...p, tasks: [...p.tasks, { uuid: "c" }] }), live: first.next, owner: owner() });
    expect(second.next.tasks.map(t => t.uuid)).toEqual(["a", "b", "c"]);
  });
});
