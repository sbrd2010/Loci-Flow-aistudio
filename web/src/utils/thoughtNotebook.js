import { parseThought, serializeRuns } from "./thoughtFormat";

export const THOUGHT_HIGHLIGHTS = [
  { color: "yellow", label: "Yellow", paint: "rgba(255, 214, 102, 0.42)" },
  { color: "green", label: "Green", paint: "rgba(100, 188, 143, 0.35)" },
  { color: "blue", label: "Blue", paint: "rgba(84, 160, 255, 0.3)" },
  { color: "pink", label: "Pink", paint: "rgba(244, 140, 180, 0.35)" },
];
export const notebookText = text => parseThought(text).map(r => r.text).join("");
export const highlightPaint = color => THOUGHT_HIGHLIGHTS.find(h => h.color === color)?.paint || "transparent";
export const highlightFromPaint = paint => THOUGHT_HIGHLIGHTS.find(h => h.paint.replace(/\s/g, "") === String(paint).replace(/\s/g, ""))?.color || null;

// Offsets refer to visible text, including newlines, never to the B/U markers.
// Only known colours are stored; neither saved nor pasted HTML is rendered.
export function normalizeHighlights(value, text = "") {
  const colors = new Set(THOUGHT_HIGHLIGHTS.map(h => h.color));
  const low = at => { const c = text.charCodeAt(at); return c >= 0xdc00 && c <= 0xdfff; };
  const ranges = (Array.isArray(value) ? value : []).filter(h => h && colors.has(h.color) && Number.isInteger(h.start) && Number.isInteger(h.end))
    .map(h => {
      let start = Math.max(0, Math.min(text.length, h.start));
      let end = Math.max(start, Math.min(text.length, h.end));
      if (low(start)) start -= 1;
      if (low(end)) end += 1;
      return { start, end, color: h.color };
    }).sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const range of ranges) {
    const start = Math.max(range.start, out.at(-1)?.end || 0);
    if (range.end <= start) continue;
    const last = out.at(-1);
    if (last && last.end === start && last.color === range.color) last.end = range.end;
    else out.push({ ...range, start });
  }
  return out;
}

export function notebookRuns(text, highlights = []) {
  const ranges = normalizeHighlights(highlights, notebookText(text));
  let offset = 0;
  const out = [];
  for (const run of parseThought(text)) {
    const cuts = new Set([0, run.text.length]);
    for (const h of ranges) for (const edge of [h.start, h.end]) if (edge > offset && edge < offset + run.text.length) cuts.add(edge - offset);
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      const start = sorted[i - 1];
      const h = ranges.find(h => h.start <= offset + start && h.end > offset + start);
      out.push({ ...run, text: run.text.slice(start, sorted[i]), ...(h ? { h: h.color } : {}) });
    }
    offset += run.text.length;
  }
  return out;
}

export function notebookDraft(runs) {
  let offset = 0;
  const highlights = [];
  for (const r of runs) {
    if (r.h) highlights.push({ start: offset, end: offset + r.text.length, color: r.h });
    offset += r.text.length;
  }
  const text = serializeRuns(runs);
  return { text, highlights: normalizeHighlights(highlights, notebookText(text)) };
}

function sliceRuns(runs, start, end) {
  const out = [];
  let offset = 0;
  for (const r of runs) {
    const a = Math.max(0, start - offset);
    const b = Math.min(r.text.length, end - offset);
    if (b > a) out.push({ ...r, text: r.text.slice(a, b) });
    offset += r.text.length;
  }
  return out;
}

const replaceRuns = (runs, start, end, text) => [
  ...sliceRuns(runs, 0, start),
  ...(text ? [{ text, b: false, u: false }] : []),
  ...sliceRuns(runs, end, Infinity),
];
export function highlightNotebookSelection(runs, start, end, color) {
  const middle = sliceRuns(runs, start, end).map(r => {
    const { h, ...rest } = r;
    return color ? { ...rest, h: color } : rest;
  });
  return { runs: [...sliceRuns(runs, 0, start), ...middle, ...sliceRuns(runs, end, Infinity)], start, end };
}
const PREFIX = /^(?:\d+\. |[•*-] )/;

export function toggleNotebookList(runs, start, end, kind) {
  const text = runs.map(r => r.text).join("");
  const first = start > 0 ? text.lastIndexOf("\n", start - 1) + 1 : 0;
  const selectedEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = text.indexOf("\n", selectedEnd);
  const last = nextBreak < 0 ? text.length : nextBreak;
  const lines = text.slice(first, last).split("\n");
  const same = kind === "number" ? /^\d+\. / : /^• /;
  const remove = lines.every(line => same.test(line));
  let at = first;
  const edits = lines.map((line, i) => {
    const old = line.match(PREFIX)?.[0] || "";
    const edit = { start: at, end: at + old.length, text: remove ? "" : kind === "number" ? `${i + 1}. ` : "• " };
    at += line.length + 1;
    return edit;
  });
  let next = runs;
  for (const e of [...edits].reverse()) next = replaceRuns(next, e.start, e.end, e.text);
  const map = position => {
    let delta = 0;
    for (const e of edits) {
      if (position < e.start) break;
      if (position <= e.end) return e.start + delta + e.text.length;
      delta += e.text.length - (e.end - e.start);
    }
    return position + delta;
  };
  return { runs: next, start: map(start), end: map(end) };
}

export function notebookNewline(runs, start, end, continueList = true) {
  const text = runs.map(r => r.text).join("");
  const first = start > 0 ? text.lastIndexOf("\n", start - 1) + 1 : 0;
  const line = text.slice(first, start);
  const match = continueList && line.match(PREFIX);
  if (match && line.trim() === match[0].trim()) {
    return { runs: replaceRuns(runs, first, end, ""), start: first, end: first };
  }
  const prefix = match ? /^\d/.test(match[0]) ? `${Number.parseInt(match[0], 10) + 1}. ` : "• " : "";
  const insert = `\n${prefix}`;
  const caret = start + insert.length;
  return { runs: replaceRuns(runs, start, end, insert), start: caret, end: caret };
}
