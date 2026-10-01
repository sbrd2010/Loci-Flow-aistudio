import { describe, it, expect } from "vitest";
import { THOUGHTS_MAX, addThought, letGoThought, restoreThought } from "./thoughts";

describe("thoughts", () => {
  it("adds a trimmed one-line thought at the end", () => {
    const r = addThought({ brainDump: [{ id: "a", text: "x" }] }, "  Ask the gym\n about Friday ", 5);
    expect(r.payload.brainDump).toHaveLength(2);
    expect(r.item).toMatchObject({ text: "Ask the gym about Friday", createdAt: 5 });
  });
  it("adds nothing when empty or full", () => {
    expect(addThought({}, "   ")).toBe(null);
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
});
