import { describe, it, expect } from "vitest";
import {
  parseCheckinTag,
  pickCheckinNote,
  buildCoachCheckin,
  isCheckinDue,
  buildCheckinResumeMessage,
  buildCheckinNotificationBody,
} from "./coachCheckin";

describe("parseCheckinTag", () => {
  it("returns null minutes and the original text when no tag is present", () => {
    expect(parseCheckinTag("Start with the report.")).toEqual({ cleanText: "Start with the report.", minutes: null });
  });

  it("extracts minutes and strips the tag from the end of the reply", () => {
    expect(parseCheckinTag("Start small.\n[[CHECKIN_IN:10]]")).toEqual({ cleanText: "Start small.", minutes: 10 });
  });

  it("is case-insensitive", () => {
    expect(parseCheckinTag("OK.\n[[checkin_in:5]]")).toEqual({ cleanText: "OK.", minutes: 5 });
  });

  it("clamps minutes below the minimum up to 1", () => {
    expect(parseCheckinTag("OK. [[CHECKIN_IN:0]]")).toEqual({ cleanText: "OK.", minutes: 1 });
  });

  it("clamps minutes above the maximum down to 180", () => {
    expect(parseCheckinTag("OK. [[CHECKIN_IN:9999]]")).toEqual({ cleanText: "OK.", minutes: 180 });
  });

  it("strips a tag in the middle of the text", () => {
    expect(parseCheckinTag("Before. [[CHECKIN_IN:15]] After.")).toEqual({ cleanText: "Before. After.", minutes: 15 });
  });
});

describe("pickCheckinNote", () => {
  it("returns null when there are no active today tasks", () => {
    expect(pickCheckinNote([])).toBeNull();
  });

  it("prefers the Now Focus task", () => {
    const tasks = [{ title: "Email client" }, { title: "Write report", isNowFocus: true }];
    expect(pickCheckinNote(tasks)).toBe("Write report");
  });

  it("falls back to the first active today task", () => {
    const tasks = [{ title: "Email client" }, { title: "Write report" }];
    expect(pickCheckinNote(tasks)).toBe("Email client");
  });
});

describe("buildCoachCheckin", () => {
  it("computes fireAt from minutes and now", () => {
    expect(buildCoachCheckin(10, "Write report", 1000)).toEqual({ fireAt: 1000 + 10 * 60000, note: "Write report", createdAt: 1000 });
  });

  it("normalizes a missing note to null", () => {
    expect(buildCoachCheckin(10, null, 1000).note).toBeNull();
  });
});

describe("isCheckinDue", () => {
  it("is false when there is no check-in", () => {
    expect(isCheckinDue(null, 1000)).toBe(false);
  });

  it("is false when fireAt is in the future", () => {
    expect(isCheckinDue({ fireAt: 2000 }, 1000)).toBe(false);
  });

  it("is true when fireAt has passed", () => {
    expect(isCheckinDue({ fireAt: 1000 }, 2000)).toBe(true);
  });
});

describe("buildCheckinResumeMessage", () => {
  it("references the noted task when present", () => {
    expect(buildCheckinResumeMessage("Rohan", "Write report")).toBe(
      'Hey Rohan — checking in like I said I would. How did it go with "Write report"?'
    );
  });

  it("falls back to a generic question without a note", () => {
    expect(buildCheckinResumeMessage("Rohan", null)).toBe(
      "Hey Rohan — checking in like I said I would. How are things going?"
    );
  });

  it("defaults the name to 'friend' when missing", () => {
    expect(buildCheckinResumeMessage(null, null)).toBe(
      "Hey friend — checking in like I said I would. How are things going?"
    );
  });
});

describe("buildCheckinNotificationBody", () => {
  it("references the noted task when present", () => {
    expect(buildCheckinNotificationBody("Write report")).toBe('How did it go with "Write report"?');
  });

  it("falls back to a generic question without a note", () => {
    expect(buildCheckinNotificationBody(null)).toBe("How are things going?");
  });
});
