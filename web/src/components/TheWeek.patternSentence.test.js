import { describe, it, expect } from "vitest";
import { patternSentence } from "./TheWeek";

// The one sentence under the week's figure. Every branch states something
// demonstrably true of the week's own numbers, so each of them is worth
// pinning: a wrong claim here is the screen lying to the user about their week.

const day = (date, minutes, moves) => ({ date, minutes, moves });
const summary = (perDay, over = {}) => {
  const totalMinutes = perDay.reduce((n, d) => n + d.minutes, 0);
  const totalMoves = perDay.reduce((n, d) => n + d.moves, 0);
  return {
    perDay,
    totalMinutes,
    totalMoves,
    daysMoved: perDay.filter(d => d.moves > 0).length,
    byFront: new Map(),
    ...over,
  };
};
const nameOf = (id) => (id === null ? "work on no front" : `Front ${id}`);

describe("patternSentence", () => {
  it("treats an empty week as a record, not a gap", () => {
    const s = patternSentence(summary([day("2026-11-04", 0, 0)]), nameOf);
    expect(`${s.before}${s.bold}${s.after}`).toBe("Nothing is logged this week. That is a record too, not a gap.");
  });

  it("names a front only when it really took more than half the time", () => {
    const base = summary([day("2026-11-03", 60, 1), day("2026-11-04", 40, 1)]);
    const over = patternSentence({ ...base, byFront: new Map([["f1", 60], ["f2", 40]]) }, nameOf);
    expect(over.bold).toBe("Front f1");
    expect(over.before).toMatch(/More than half/);

    // Exactly half is not more than half.
    const even = summary([day("2026-11-03", 50, 1), day("2026-11-04", 50, 1)]);
    const out = patternSentence({ ...even, byFront: new Map([["f1", 50], ["f2", 50]]) }, nameOf);
    expect(out.before).not.toMatch(/More than half/);
  });

  // The bug: the candidate day was picked by MOVE count and its share then
  // measured in minutes, so a day of several short moves beat a day holding
  // one long session.
  it("ranks the busiest day by the same measure it then reports", () => {
    const out = patternSentence(summary([
      day("2026-11-03", 35, 5),  // more moves, less time
      day("2026-11-04", 65, 1),  // fewer moves, nearly two thirds of the week
    ]), nameOf);
    // Ranking by moves picked the 35-minute day, measured ITS share as 0.35,
    // fell under the threshold and reported nothing — missing a week that
    // really did happen on one day. Ranking by minutes finds the 65.
    expect(out.bold).toBe("one day");
    expect(out.before).toMatch(/Most of the week/);
  });

  it("does not claim one day when the week is evenly spread", () => {
    const out = patternSentence(summary([
      day("2026-11-02", 30, 1), day("2026-11-03", 30, 1),
      day("2026-11-04", 30, 1), day("2026-11-05", 30, 1),
    ]), nameOf);
    expect(out.bold).toBe("4 of the last 4 days");
  });

  it("never claims 'one day' when only one day was worked at all", () => {
    const out = patternSentence(summary([day("2026-11-03", 0, 0), day("2026-11-04", 90, 2)]), nameOf);
    // daysMoved === 1 — "most of the week happened on one day" would be true
    // but useless, and it shames. It reports the count instead.
    expect(out.bold).toBe("1 of the last 2 days");
  });
});
