import { describe, it, expect } from "vitest";
import { buildLocalSafetyReply, localSafetyTurns, CRISIS_RE, MEDICAL_RISK_RE } from "./crisisSafety";
import * as rescuePrompt from "./rescueCoachPrompt";

// Addendum H: "the crisis check is a property of every free-text path to the
// provider, not of one screen". Coach and Rescue are both such paths, and
// before this module existed only Rescue had the check.

describe("crisisSafety — the one check both free-text paths use", () => {
  it("is literally the same function Rescue uses, so the two cannot drift apart", () => {
    expect(rescuePrompt.buildLocalSafetyReply).toBe(buildLocalSafetyReply);
    expect(rescuePrompt.CRISIS_RE).toBe(CRISIS_RE);
    expect(rescuePrompt.MEDICAL_RISK_RE).toBe(MEDICAL_RISK_RE);
  });

  it("answers locally on crisis language", () => {
    for (const text of [
      "I want to kill myself",
      "i want to die",
      "I might hurt myself",
      "everyone would be better off dead",
      "I don't want to be here",
      "I feel unsafe",
    ]) {
      expect(buildLocalSafetyReply(text, "Rohan")).toContain("emergency services");
    }
  });

  it("answers locally on medical risk", () => {
    expect(buildLocalSafetyReply("I have chest pain and can't breathe", "Rohan")).toContain("medical help");
    expect(buildLocalSafetyReply("I think I'm having a medical emergency", "Rohan")).toContain("medical help");
  });

  // A false positive here answers someone frustrated with a task as though they
  // were in danger, which is its own harm. The gate stays narrow on purpose.
  it("returns null for ordinary frustration, so the coach still coaches", () => {
    for (const text of [
      "I don't want to start this",
      "I feel anxious and frozen",
      "this task is killing me slowly",
      "I'm dead tired",
      "what should I work on next?",
      "",
    ]) {
      expect(buildLocalSafetyReply(text, "Rohan")).toBeNull();
    }
  });

  it("falls back to a neutral name and tolerates junk input", () => {
    expect(buildLocalSafetyReply("I want to die")).toContain("friend");
    expect(buildLocalSafetyReply(null, "Rohan")).toBeNull();
    expect(buildLocalSafetyReply(undefined, undefined)).toBeNull();
  });
});

describe("localSafetyTurns", () => {
  it("finds the message answered on this device and its canned reply, even after a rename", () => {
    const user = { isUser: true, text: "I want to die" };
    const reply = { isUser: false, text: buildLocalSafetyReply("I want to die", "Rohan") };
    const later = { isUser: true, text: "What next?" };
    const turns = localSafetyTurns([user, reply, later, { isUser: false, text: "Pick the report." }]);
    expect(turns.has(user)).toBe(true);
    expect(turns.has(reply)).toBe(true);
    expect(turns.has(later)).toBe(false);
  });

  it("leaves a message that only looks like one: a provider answered it", () => {
    const user = { isUser: true, text: "I feel like I might hurt myself" };
    const answered = { isUser: false, text: "I'm here with you. Tell me more." };
    expect(localSafetyTurns([user, answered]).size).toBe(0);
  });

  it("covers the medical reply too", () => {
    const user = { isUser: true, text: "I have chest pain" };
    const reply = { isUser: false, text: buildLocalSafetyReply("I have chest pain", "Sam") };
    expect(localSafetyTurns([user, reply]).size).toBe(2);
  });
});
