// 78 §5: a thought's **bold** and __underline__ are kept as markers in the
// stored text and shown without them, in the editor and in the list.

const MARK = { "**": "b", "__": "u" };

// Text → literal pieces and markers. A backslash keeps the next \, * or _
// as text, so a typed "foo__bar__" is never read as underline.
function tokens(text) {
  const out = [];
  let buf = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\" && /[\\*_]/.test(text[i + 1] || "")) { buf += text[i + 1]; i += 1; continue; }
    const two = text.slice(i, i + 2);
    if (MARK[two]) {
      if (buf) out.push(buf);
      buf = "";
      out.push({ mark: MARK[two] });
      i += 1;
      continue;
    }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

// "a **b** c" → [{text:"a ",b:false,u:false},{text:"b",b:true,u:false},…]
// Only markers with a partner toggle; a stray last one stays as text.
export function parseThought(text) {
  const toks = tokens(String(text || ""));
  const count = { b: 0, u: 0 };
  toks.forEach(t => { if (t.mark) count[t.mark] += 1; });
  const left = { ...count };
  const runs = [];
  const style = { b: false, u: false };
  const add = (str) => {
    const last = runs[runs.length - 1];
    if (last && last.b === style.b && last.u === style.u) last.text += str;
    else runs.push({ text: str, b: style.b, u: style.u });
  };
  toks.forEach(t => {
    if (typeof t === "string") { add(t); return; }
    const k = t.mark;
    left[k] -= 1;
    if (count[k] % 2 && left[k] === 0) { add(k === "b" ? "**" : "__"); return; }
    style[k] = !style[k];
  });
  return runs.filter(r => r.text);
}

// Plain typed text (Focus's "Park a thought", Rescue) → stored text.
export const escapeThought = (t) => String(t || "").replace(/[\\*_]/g, c => `\\${c}`);
const escapeText = escapeThought;

// Runs back to stored text; neighbouring runs with the same style join.
export function serializeRuns(runs) {
  const merged = [];
  for (const r of runs || []) {
    if (!r.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.b === !!r.b && last.u === !!r.u) last.text += r.text;
    else merged.push({ text: r.text, b: !!r.b, u: !!r.u });
  }
  return merged.map(r => {
    let t = escapeText(r.text);
    if (r.u) t = `__${t}__`;
    if (r.b) t = `**${t}**`;
    return t;
  }).join("");
}

// For a task title or the coach: no markers, one line.
export function plainThought(text) {
  return parseThought(text).map(r => r.text).join("").replace(/\s+/g, " ").trim();
}
