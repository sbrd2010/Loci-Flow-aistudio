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
  return (
    <footer className="momentum">
      <div className="momentum-bars" aria-hidden="true">
        {bars.map(b => (
          <span key={b.date} className={`momentum-bar is-${b.state}`} />
        ))}
      </div>
      {sentence && <span className="momentum-line">{sentence}</span>}
    </footer>
  );
}
