import { describe, expect, it } from "vitest";
import { buildSupportModeInstruction } from "./coachSupportMode";

describe("buildSupportModeInstruction", () => {
  it("states the core rule and forbids defaulting to task mode", () => {
    const instruction = buildSupportModeInstruction("Alex");
    expect(instruction).toContain("Human first, task second, safety above both");
    expect(instruction).toContain("Do not default to task mode");
  });

  it("interpolates firstName", () => {
    const instruction = buildSupportModeInstruction("Alex");
    expect(instruction).toContain("Alex");
  });

  it("instructs comfort, venting, and shame modes not to push a task uninvited", () => {
    const instruction = buildSupportModeInstruction("Alex");
    const comfortLine = instruction.split("\n").find(l => l.startsWith("- Comfort ("));
    const ventingLine = instruction.split("\n").find(l => l.startsWith("- Venting/frustration ("));
    const shameLine = instruction.split("\n").find(l => l.startsWith("- Shame reset ("));
    expect(comfortLine).toContain("Do not push a task uninvited");
    expect(ventingLine).toContain("Do not push a task uninvited");
    expect(shameLine).toContain("Do not push a task uninvited");
  });

  it("stops task/productivity coaching in the self-harm/crisis safety mode", () => {
    const instruction = buildSupportModeInstruction("Alex");
    const crisisLine = instruction.split("\n").find(l => l.includes("Self-harm/suicide/crisis"));
    expect(crisisLine).toContain("stop all task and productivity coaching immediately");
  });

  it("includes safety-mode keywords", () => {
    const instruction = buildSupportModeInstruction("Alex");
    expect(instruction).toContain("self-harm");
    expect(instruction).toContain("emergency services");
    expect(instruction).toContain("crisis line");
  });

  it("does not hardcode one country's crisis resources", () => {
    const instruction = buildSupportModeInstruction("Alex");
    expect(instruction).toContain("If not known, tell");
    expect(instruction).not.toMatch(/netherlands|112|113 zelfmoordpreventie/i);
  });

  it("translates app data into human insight rather than raw metrics in profile reflection mode", () => {
    const instruction = buildSupportModeInstruction("Alex");
    const profileLine = instruction.split("\n").find(l => l.startsWith("- Profile reflection ("));
    expect(profileLine).toContain("human insight");
    expect(profileLine).toContain("never recite raw metrics");
  });
});
