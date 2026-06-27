// Matches http(s) URLs only — never javascript:, data:, or other schemes,
// since the scheme is required and hardcoded to http/https. Stops at
// whitespace and trims trailing sentence punctuation that's likely not
// part of the URL.
const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/gi;

export function splitTextWithLinks(text = "") {
  const str = String(text || "");
  const parts = [];
  let lastIndex = 0;
  for (const match of str.matchAll(URL_RE)) {
    if (match.index > lastIndex) parts.push({ type: "text", value: str.slice(lastIndex, match.index) });
    parts.push({ type: "link", value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < str.length) parts.push({ type: "text", value: str.slice(lastIndex) });
  return parts.length > 0 ? parts : [{ type: "text", value: str }];
}
