import { describe, it, expect } from "vitest";
import {
  parseCheckinTag,
  pickCheckinNote,
  buildCoachCheckin,
  isCheckinDue,
  buildCheckinResumeMessage,
  buildCheckinNotificationBody,
  parseCheckinRequestFromMessage,
  isDuplicateCheckinResume,
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

  it("treats minutes below the minimum as no tag", () => {
    expect(parseCheckinTag("OK. [[CHECKIN_IN:0]]")).toEqual({ cleanText: "OK.", minutes: null });
  });

  it("treats minutes above the maximum as no tag", () => {
    expect(parseCheckinTag("OK. [[CHECKIN_IN:9999]]")).toEqual({ cleanText: "OK.", minutes: null });
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

describe("parseCheckinRequestFromMessage", () => {
  it("parses 'check on me in 10 minutes'", () => {
    expect(parseCheckinRequestFromMessage("Can you check on me in 10 minutes?")).toBe(10);
  });

  it("parses 'check back in 1 hour' as 60 minutes", () => {
    expect(parseCheckinRequestFromMessage("Please check back in 1 hour")).toBe(60);
  });

  it("parses 'get back to me at 11am' relative to now", () => {
    const now = new Date(2024, 0, 1, 10, 3).getTime(); // 10:03 AM
    expect(parseCheckinRequestFromMessage("get back to me at 11am", now)).toBe(57);
  });

  it("parses 'ask me again at 15:30' (24-hour time) relative to now", () => {
    const now = new Date(2024, 0, 1, 15, 0).getTime(); // 15:00
    expect(parseCheckinRequestFromMessage("ask me again at 15:30", now)).toBe(30);
  });

  it("rejects an out-of-range duration", () => {
    expect(parseCheckinRequestFromMessage("check on me in 5 hours")).toBeNull();
  });

  it("rejects a recurring request", () => {
    expect(parseCheckinRequestFromMessage("check on me every hour")).toBeNull();
  });

  it("rejects a recurring request with a specific time", () => {
    expect(parseCheckinRequestFromMessage("remind me every day at 9am")).toBeNull();
  });

  it("returns null when there is no check-in request", () => {
    expect(parseCheckinRequestFromMessage("Thanks, that helps a lot!")).toBeNull();
  });

  it("returns null when intent is present but no time is specified", () => {
    expect(parseCheckinRequestFromMessage("Can you check in with me later?")).toBeNull();
  });

  it("schedules a check-in from the user's message even when the AI reply has no tag", () => {
    const aiReply = "Got it, I'll keep that in mind!";
    const { minutes: tagMinutes } = parseCheckinTag(aiReply);
    expect(tagMinutes).toBeNull();
    const fallbackMinutes = parseCheckinRequestFromMessage("check on me in 15 minutes");
    expect(tagMinutes ?? fallbackMinutes).toBe(15);
  });

  it("prefers a valid AI tag over the message fallback", () => {
    const aiReply = "On it. [[CHECKIN_IN:20]]";
    const { minutes: tagMinutes } = parseCheckinTag(aiReply);
    const fallbackMinutes = parseCheckinRequestFromMessage("check on me in 15 minutes");
    expect(tagMinutes ?? fallbackMinutes).toBe(20);
  });

  it("an out-of-range AI tag does not override a valid user request", () => {
    const aiReply = "Sure thing! [[CHECKIN_IN:9999]]";
    const { minutes: tagMinutes } = parseCheckinTag(aiReply);
    expect(tagMinutes).toBeNull();
    const fallbackMinutes = parseCheckinRequestFromMessage("check on me in 15 minutes");
    expect(tagMinutes ?? fallbackMinutes).toBe(15);
  });
});

describe("isDuplicateCheckinResume", () => {
  const resumeText = 'Hey Rohan — checking in like I said I would. How did it go with "Write report"?';

  it("is false for an empty history", () => {
    expect(isDuplicateCheckinResume([], resumeText)).toBe(false);
  });

  it("is false when the last message is different text", () => {
    expect(isDuplicateCheckinResume([{ text: "Something else", isUser: false }], resumeText)).toBe(false);
  });

  it("is false when the last message is from the user", () => {
    expect(isDuplicateCheckinResume([{ text: resumeText, isUser: true }], resumeText)).toBe(false);
  });

  it("is true when the last message already is this exact resume message", () => {
    const history = [{ text: "earlier", isUser: true }, { text: resumeText, isUser: false }];
    expect(isDuplicateCheckinResume(history, resumeText)).toBe(true);
  });
});
