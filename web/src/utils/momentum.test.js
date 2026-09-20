import { describe, it, expect } from "vitest";
import { buildMomentum, ordinalWord } from "./momentum";
import { getFocusWindows } from "./focusWindows";

const windows = getFocusWindows({});
const now = new Date("2024-06-15T12:00:00");

// A countable session on a given day.
function day(dateStr, seconds = 1500) {
  return { [dateStr]: { [`e-${dateStr}`]: { type: "focus_completed", taskId: "t1", focusElapsedSeconds: seconds } } };
}
const raw = (...dates) => Object.assign({}, ...dates.map(d => day(d)));

describe("ordinalWord", () => {
  it("spells the ones, teens and tens", () => {
    expect(ordinalWord(1)).toBe("First");
    expect(ordinalWord(9)).toBe("Ninth");
    expect(ordinalWord(10)).toBe("Tenth");
    expect(ordinalWord(12)).toBe("Twelfth");
    expect(ordinalWord(20)).toBe("Twentieth");
    expect(ordinalWord(30)).toBe("Thirtieth");
  });

  it("spells the compounds", () => {
    expect(ordinalWord(21)).toBe("Twenty-first");
    expect(ordinalWord(43)).toBe("Forty-third");
    expect(ordinalWord(99)).toBe("Ninety-ninth");
  });

  it("gives up rather than inventing a form", () => {
    expect(ordinalWord(0)).toBeNull();
    expect(ordinalWord(100)).toBeNull();
    expect(ordinalWord(1.5)).toBeNull();
  });
});

describe("buildMomentum", () => {
  it("does not render at all with no history — an empty frame is a scoreboard", () => {
    expect(buildMomentum(null, now, windows)).toBeNull();
    expect(buildMomentum({}, now, windows)).toBeNull();
  });

  it("reads one day of history as one bar and 'First day.'", () => {
    const m = buildMomentum(raw("2024-06-15"), now, windows);
    expect(m.bars).toHaveLength(1);
    expect(m.bars[0].state).toBe("today");
    expect(m.sentence).toBe("First day.");
  });

  // K5: fewer bars governs only a history shorter than five days. No empty
  // leading slots, because the window starts at the first day of history.
  it("renders fewer bars under five days of history, never empty slots", () => {
    const m = buildMomentum(raw("2024-06-13", "2024-06-14", "2024-06-15"), now, windows);
    expect(m.bars.map(b => b.state)).toEqual(["moved", "moved", "today"]);
    expect(m.sentence).toBe("Third day running.");
  });

  // K5: a quiet day INSIDE the window is a --border bar, not a missing one.
  it("marks a quiet day inside the window rather than dropping it", () => {
    const m = buildMomentum(raw("2024-06-11", "2024-06-13", "2024-06-14", "2024-06-15"), now, windows);
    expect(m.bars.map(b => b.state)).toEqual(["moved", "quiet", "moved", "moved", "today"]);
    // The chain broke on the 12th, so the current run is three days.
    expect(m.sentence).toBe("Third day running.");
  });

  it("never shows more than five bars", () => {
    const m = buildMomentum(raw("2024-06-09", "2024-06-10", "2024-06-11", "2024-06-12", "2024-06-13", "2024-06-14", "2024-06-15"), now, windows);
    expect(m.bars).toHaveLength(5);
    expect(m.sentence).toBe("Seventh day running.");
  });

  // An untouched morning is not a broken chain.
  it("counts the run ending yesterday when today has no session yet", () => {
    const m = buildMomentum(raw("2024-06-13", "2024-06-14"), now, windows);
    expect(m.bars[m.bars.length - 1].state).toBe("quiet");
    expect(m.sentence).toBe("Second day running.");
  });

  // "The app never mentions a streak it is not currently in."
  it("says nothing when the chain is broken, but still shows the bars", () => {
    const m = buildMomentum(raw("2024-06-11", "2024-06-12"), now, windows);
    expect(m.sentence).toBeNull();
    expect(m.bars.length).toBeGreaterThan(0);
  });

  it("does not count a mis-tap as a day moved", () => {
    // Under a minute is zero minutes and zero moves — see focusLedger.
    expect(buildMomentum(raw("2024-06-15") && { "2024-06-15": { e1: { type: "focus_completed", taskId: "t1", focusElapsedSeconds: 45 } } }, now, windows)).toBeNull();
  });
});
