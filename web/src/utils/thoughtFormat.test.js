import { describe, it, expect } from "vitest";
import { escapeThought, parseThought, plainThought, serializeRuns } from "./thoughtFormat";

describe("thought format", () => {
  it("reads bold and underline, nested too", () => {
    expect(parseThought("a **b __c__** d")).toEqual([
      { text: "a ", b: false, u: false },
      { text: "b ", b: true, u: false },
      { text: "c", b: true, u: true },
      { text: " d", b: false, u: false },
    ]);
  });
  it("leaves a stray marker as text", () => {
    expect(plainThought("snake__case")).toBe("snake__case");
    expect(plainThought("**open")).toBe("**open");
    expect(plainThought("**a** b**")).toBe("a b**");
  });
  it("writes runs back, joining neighbours with the same style", () => {
    const runs = [{ text: "a", b: false, u: false }, { text: "b", b: true }, { text: "c", b: true }, { text: "d", b: true, u: true }];
    expect(serializeRuns(runs)).toBe("a**bc****__d__**");
    expect(parseThought(serializeRuns(runs)).map(r => r.text).join("")).toBe("abcd");
  });
  it("round-trips", () => {
    const s = "Call **Ana**\n__before__ Friday";
    expect(serializeRuns(parseThought(s))).toBe(s);
  });
  it("keeps typed ** and __ as text (Codex review of #518)", () => {
    const stored = serializeRuns([{ text: "rename foo__bar__baz", b: false, u: false }, { text: "2**3", b: true, u: false }]);
    expect(parseThought(stored)).toEqual([
      { text: "rename foo__bar__baz", b: false, u: false },
      { text: "2**3", b: true, u: false },
    ]);
    expect(plainThought(escapeThought("a_b **c** C:\\temp"))).toBe("a_b **c** C:\\temp");
    expect(plainThought("C:\\temp")).toBe("C:\\temp");
  });
  it("gives a plain one-line version", () => {
    expect(plainThought("Call **Ana**\n__before__  Friday")).toBe("Call Ana before Friday");
  });
});
