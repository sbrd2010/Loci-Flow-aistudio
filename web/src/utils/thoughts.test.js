import { describe, it, expect } from "vitest";
import { THOUGHTS_MAX, THOUGHT_FORMAT, addPlainThought, addThought, letGoThought, newestThoughtsFirst, restoreThought, thoughtText } from "./thoughts";
import { parseThought, plainThought } from "./thoughtFormat";
import { mergeLocalIntoServer, mergeRemotePayloadWithMeta, normalizePayload } from "./normalizePayload";

describe("thoughts", () => {
  it("adds a trimmed thought at the end, keeping its lines", () => {
    const r = addThought({ brainDump: [{ id: "a", text: "x" }] }, "  Ask the  gym\r\n about Friday \n\n\n\nand Monday ", 5);
    expect(r.payload.brainDump).toHaveLength(2);
    expect(r.item).toMatchObject({ text: "Ask the gym\nabout Friday\n\nand Monday", createdAt: 5 });
  });
  it("adds nothing when empty or full", () => {
    expect(addThought({}, "   ")).toBe(null);
    expect(addThought({}, "** **")).toBe(null);
    expect(addThought({}, "x".repeat(600)).item.text).toHaveLength(500);
    const full = { brainDump: Array.from({ length: THOUGHTS_MAX }, (_, i) => ({ id: String(i), text: "t" })) };
    expect(addThought(full, "one more")).toBe(null);
  });
  it("lets a thought go and Undo puts it back in its place", () => {
    const p = { brainDump: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const gone = letGoThought(p, "b");
    expect(gone.payload.brainDump.map(d => d.id)).toEqual(["a", "c"]);
    expect(restoreThought(gone.payload, gone.item, gone.at).brainDump.map(d => d.id)).toEqual(["a", "b", "c"]);
    expect(letGoThought(p, "zz")).toBe(null);
    expect(restoreThought(p, { id: "a" }, 0)).toBe(p);
  });
  it("won't restore a let-go thought into a list that filled up again", () => {
    const full = { brainDump: Array.from({ length: THOUGHTS_MAX }, (_, i) => ({ id: `t${i}`, text: "x" })) };
    expect(restoreThought(full, { id: "gone", text: "y" }, 3)).toBe(null);
  });
  it("orders newest first by createdAt, not by stored order", () => {
    const list = [{ id: "a", createdAt: 10 }, { id: "b", createdAt: 30 }, { id: "c", createdAt: 20 }, { id: "d" }];
    expect(newestThoughtsFirst(list).map(t => t.id)).toEqual(["b", "c", "a", "d"]);
  });

  // Review of #511, 1.1: a thought saved before the format (or by an older
  // app on the same database) has no fmt and is plain text.
  it("reads an unmarked thought as typed: no bold, no underline, nothing lost", () => {
    for (const text of ["fix __init__ bug", "2**3 = 8 and 3**2 = 9", "C:\\_tmp", "a\\b"]) {
      const item = { id: "old", text, createdAt: 1 };
      expect(plainThought(thoughtText(item))).toBe(text);
      expect(parseThought(thoughtText(item)).every(r => !r.b && !r.u)).toBe(true);
    }
    expect(thoughtText({ id: "x" })).toBe("");
    expect(thoughtText(null)).toBe("");
  });
  it("marks a new thought, so its bold and underline still read", () => {
    const { item } = addThought({}, "**Call** the __bank__", 5);
    expect(item.fmt).toBe(THOUGHT_FORMAT);
    expect(plainThought(thoughtText(item))).toBe("Call the bank");
    const runs = parseThought(thoughtText(item));
    expect(runs.find(r => r.text === "Call").b).toBe(true);
    expect(runs.find(r => r.text === "bank").u).toBe(true);
  });
  it("keeps plain typed text as typed (Park a thought, Rescue)", () => {
    const { item } = addPlainThought({}, "rename __init__.py and fix a**b", 5);
    expect(item.fmt).toBe(THOUGHT_FORMAT);
    expect(plainThought(thoughtText(item))).toBe("rename __init__.py and fix a**b");
  });
  it("keeps the mark through normalize and both sync merges", () => {
    const item = { id: "n", text: "**x**", createdAt: 1, fmt: THOUGHT_FORMAT };
    const old = { id: "o", text: "__y__", createdAt: 2 };
    const p = { userId: "u", tasks: [], config: {}, brainDump: [item, old], brainDumpUpdatedAt: 1 };
    expect(normalizePayload(p).brainDump).toEqual([item, old]);
    const { merged } = mergeRemotePayloadWithMeta(p, p, {}, [], [item, old]);
    expect(merged.brainDump).toEqual([item, old]);
    expect(mergeLocalIntoServer(p, p, p).brainDump).toEqual([item, old]);
  });
});
