import { describe, it, expect } from "vitest";
import { parseThought, plainThought, serializeRuns } from "./thoughtFormat";

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
  it("gives a plain one-line version", () => {
    expect(plainThought("Call **Ana**\n__before__  Friday")).toBe("Call Ana before Friday");
  });
});
