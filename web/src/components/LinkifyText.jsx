import React from "react";
import { splitTextWithLinks } from "../utils/linkify";

// Renders plain text with bare http(s) URLs turned into safe <a> tags.
// Not markdown — task titles/concreteStep are plain strings, so this
// deliberately does not interpret *, _, #, etc. Non-http(s) schemes never
// become links because the matching regex requires an http/https scheme.
export default function LinkifyText({ text }) {
  const parts = splitTextWithLinks(text);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "link"
          ? <a key={i} href={p.value} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>{p.value}</a>
          : <React.Fragment key={i}>{p.value}</React.Fragment>
      )}
    </>
  );
}
