import React from "react";

// A numbered section heading (73a): gold mono number, sentence-case title,
// and one Lora line on what the section shows.
export default function SectionHead({ num, id, title, line, children }) {
  return (
    <div className="rv-head">
      <div className="rv-head-row">
        <h2 className="rv-title" id={id}><span className="rv-title-num" aria-hidden="true">{num}</span>{title}</h2>
        {children}
      </div>
      {line && <p className="rv-line-text">{line}</p>}
    </div>
  );
}
