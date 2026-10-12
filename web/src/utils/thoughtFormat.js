// 78 §5: a thought's **bold** and __underline__ are kept as markers in the
// stored text and shown without them, in the editor and in the list.

const MARK = { "**": "b", "__": "u" };

// Only markers with a partner toggle; a stray one stays as text.
function pairedMarkers(text) {
  const at = { "**": [], "__": [] };
  const re = /\*\*|__/g;
  let m;
  while ((m = re.exec(text))) at[m[0]].push(m.index);
  const keep = new Set();
  for (const k of Object.keys(at)) {
    const list = at[k].length % 2 ? at[k].slice(0, -1) : at[k];
    list.forEach(i => keep.add(i));
  }
  return keep;
}

// "a **b** c" → [{text:"a ",b:false,u:false},{text:"b",b:true,u:false},…]
export function parseThought(text) {
  const s = String(text || "");
  const keep = pairedMarkers(s);
  const runs = [];
  const style = { b: false, u: false };
  let buf = "";
  const flush = () => { if (buf) { runs.push({ text: buf, b: style.b, u: style.u }); buf = ""; } };
  for (let i = 0; i < s.length; i += 1) {
    const two = s.slice(i, i + 2);
    if (MARK[two] && keep.has(i)) {
      flush();
      style[MARK[two]] = !style[MARK[two]];
      i += 1;
    } else {
      buf += s[i];
    }
  }
  flush();
  return runs;
}

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
    let t = r.text;
    if (r.u) t = `__${t}__`;
    if (r.b) t = `**${t}**`;
    return t;
  }).join("");
}

// For a task title or the coach: no markers, one line.
export function plainThought(text) {
  return parseThought(text).map(r => r.text).join("").replace(/\s+/g, " ").trim();
}
