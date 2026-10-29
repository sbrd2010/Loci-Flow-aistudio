import { describe, expect, it } from "vitest";
import { highlightNotebookSelection, notebookDraft, notebookNewline, notebookRuns, notebookText, normalizeHighlights, toggleNotebookList } from "./thoughtNotebook";

describe("notebook formatting", () => {
  it("round-trips highlights independently of bold/underline storage", () => {
    const text = "A **blue**\n__sample__";
    const highlights = [{ start: 2, end: 6, color: "blue" }, { start: 7, end: 13, color: "yellow" }];
    expect(notebookDraft(notebookRuns(text, highlights))).toEqual({ text, highlights });
    expect(notebookText(text)).toBe("A blue\nsample");
  });
  it("ignores unknown colours and invalid ranges and keeps an emoji whole", () => {
    expect(normalizeHighlights([{ start: 1, end: 2, color: "yellow" }, { start: 0, end: 3, color: "url(javascript:x)" }, { start: -1, end: 0, color: "pink" }], "😀x"))
      .toEqual([{ start: 0, end: 2, color: "yellow" }]);
  });
  it("numbers selected lines while keeping their inline formatting", () => {
    const runs = notebookRuns("**Blue**\nGreen", [{ start: 5, end: 10, color: "green" }]);
    const listed = toggleNotebookList(runs, 0, 10, "number");
    expect(notebookDraft(listed.runs)).toEqual({ text: "1. **Blue**\n2. Green", highlights: [{ start: 11, end: 16, color: "green" }] });
    expect(notebookDraft(toggleNotebookList(listed.runs, 0, 16, "number").runs).text).toBe("**Blue**\nGreen");
  });
  it("toggles bullets and converts numbered lists", () => {
    const listed = toggleNotebookList(notebookRuns("1. Blue\n2. Green"), 0, 16, "bullet");
    expect(notebookDraft(listed.runs).text).toBe("• Blue\n• Green");
    expect(notebookDraft(toggleNotebookList(listed.runs, 0, 14, "bullet").runs).text).toBe("Blue\nGreen");
  });
  it("changes or removes only the selected highlight without losing bold text", () => {
    const original = notebookRuns("**Blue sample**", [{ start: 0, end: 11, color: "blue" }]);
    const changed = highlightNotebookSelection(original, 5, 11, "yellow");
    expect(notebookDraft(changed.runs).highlights).toEqual([{ start: 0, end: 5, color: "blue" }, { start: 5, end: 11, color: "yellow" }]);
    const removed = notebookDraft(highlightNotebookSelection(changed.runs, 5, 11, null).runs);
    expect(removed.text).toBe("**Blue sample**");
    expect(removed.highlights).toEqual([{ start: 0, end: 5, color: "blue" }]);
  });
  it("continues numbering and bullets, and exits an empty list item", () => {
    expect(notebookDraft(notebookNewline(notebookRuns("1. Sample"), 9, 9).runs).text).toBe("1. Sample\n2. ");
    expect(notebookDraft(notebookNewline(notebookRuns("• Sample"), 8, 8).runs).text).toBe("• Sample\n• ");
    expect(notebookDraft(notebookNewline(notebookRuns("1. Sample\n2. "), 13, 13).runs).text).toBe("1. Sample\n");
    expect(notebookDraft(notebookNewline(notebookRuns("1. Sample"), 9, 9, false).runs).text).toBe("1. Sample\n");
  });
  it("splits a nonempty list item when Enter is pressed immediately after its prefix", () => {
    expect(notebookDraft(notebookNewline(notebookRuns("1. Blue"), 3, 3).runs).text).toBe("1. \n2. Blue");
    expect(notebookDraft(notebookNewline(notebookRuns("• Blue"), 2, 2).runs).text).toBe("• \n• Blue");
  });
});
