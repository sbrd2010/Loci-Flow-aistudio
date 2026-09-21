import React from "react";

// Momentum — Today's footer, below the ledger.
//
// "Days moved, not tasks completed. No streak counter, no 'you broke your
// streak', no number that can shame. Breaking the chain does nothing — that is
// deliberate."
//
// Height carries only the binary fact, not a quantity: a tall bar is a day you
// moved, a short one is a day you didn't. Scaling height by minutes would put
// back exactly the number the design removes — a short bar you have to explain
// to yourself.
//
// Renders nothing at all when there is no history (buildMomentum returns null)
// and when the sentence is absent, because the app never mentions a streak it
// is not currently in.

export default function Momentum({ bars = [], sentence = null }) {
  if (bars.length === 0) return null;
  // The bars ARE the content, so they are not decorative: hiding them from
  // the accessibility tree left a screen reader with the sentence alone —
  // and with nothing at all on a broken chain, where the sentence is
  // deliberately absent. The label states the same fact the bars show, in
  // the same non-judgemental terms.
  const moved = bars.filter(b => b.state !== "quiet").length;
  const label = bars.length === 1
    ? "Momentum: you moved something today."
    : `Momentum: you moved something on ${moved} of the last ${bars.length} days.`;
  return (
    <footer className="momentum">
      <div className="momentum-bars" role="img" aria-label={label}>
        {bars.map(b => (
          <span key={b.date} className={`momentum-bar is-${b.state}`} />
        ))}
      </div>
      {sentence && <span className="momentum-line">{sentence}</span>}
    </footer>
  );
}
