import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #646: Coach's task changes must go through the merging save. The repo has
// no harness that renders CoachTab, so this guards the wiring in the source:
// it fails if a task write goes back to the blind sub-path writer, if a
// task-saving path stops using saveCoachChanges, or if saveCoachChanges goes
// back to the render-time payload (an Undo minutes later would put back a
// stale Mind Box — loopcheck of #646). The behaviour itself is covered by
// emulator-tests/coach-sync.emulator.test.js.
const src = readFileSync(new URL("./CoachTab.jsx", import.meta.url), "utf8");
const code = src.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
const callArgs = (name) => [...code.matchAll(new RegExp(`\\b${name}\\(`, "g"))].map(m => {
  let depth = 0; let i = m.index + m[0].length - 1;
  for (let j = i; j < code.length; j++) {
    if (code[j] === "(") depth++;
    if (code[j] === ")" && --depth === 0) return code.slice(i + 1, j);
  }
  return "";
});

describe("CoachTab's saves (#646)", () => {
  it("the blind sub-path writer carries chat state only, never tasks or contributions", () => {
    const writes = callArgs("saveSubPathsAsync");
    expect(writes.length).toBeGreaterThan(0);
    for (const args of writes) {
      expect(args).toMatch(/^\s*\{\s*chatHistory:/);
      expect(args).not.toMatch(/\btasks\b|\bcontributions\b|\bpatch\b/);
    }
  });
  it("all seven task-saving paths use the merging save", () => {
    expect(callArgs("saveCoachChanges")).toHaveLength(7);
    expect(code).not.toMatch(/\bsaveSubPaths\(\s*\{[^}]*\btasks\b/);
  });
  it("the merging save starts from the latest payload, not the render-time one", () => {
    const body = code.slice(code.indexOf("const saveCoachChanges"), code.indexOf("}, options);", code.indexOf("const saveCoachChanges")));
    expect(body).toMatch(/\.\.\.payloadRef\.current/);
    expect(body).not.toMatch(/\.\.\.payload,/);
  });
});
