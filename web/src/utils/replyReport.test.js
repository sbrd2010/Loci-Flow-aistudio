import { describe, expect, it } from "vitest";
import { REPORT_FIELD_MAX, replyReportContext } from "./replyReport";

describe("replyReportContext", () => {
  it("attaches the tester's message and the Coach reply", () => {
    expect(replyReportContext("What should I do first?", "Start with the water bill.")).toBe(
      "Your message:\nWhat should I do first?\n\nCoach reply:\nStart with the water bill."
    );
  });

  it("attaches the reply alone when there is no message before it", () => {
    expect(replyReportContext("", "Good morning, Sam.")).toBe("Coach reply:\nGood morning, Sam.");
  });

  it("stays within what the database accepts, and the reply keeps most of the room", () => {
    const text = replyReportContext("q".repeat(3000), "r".repeat(3000));
    expect(text.length).toBeLessThanOrEqual(REPORT_FIELD_MAX);
    expect(text).toContain(`${"r".repeat(1399)}…`);
    expect(text).toContain("q…");
  });
});
