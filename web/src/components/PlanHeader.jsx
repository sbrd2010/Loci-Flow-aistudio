import React from "react";

// Plan's head (45h–j): the title and one switch, Horizons | Fronts. A phone
// gives the switch the width below the title; a tablet or laptop puts it
// beside the title.
const VIEWS = [
  { id: "horizons", label: "Horizons" },
  { id: "plan", label: "Fronts" },
];

export default function PlanHeader({ view, onChange }) {
  const onKeyDown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = VIEWS[(VIEWS.findIndex(v => v.id === view) + 1) % VIEWS.length];
    onChange(next.id);
    requestAnimationFrame(() => document.getElementById(`plan-tab-${next.id}`)?.focus());
  };
  return (
    <header className="plan-head">
      <h1 className="plan-head-title">Plan</h1>
      <div className="plan-seg" role="tablist" aria-label="Plan views" onKeyDown={onKeyDown}>
        {VIEWS.map(v => (
          <button
            key={v.id}
            id={`plan-tab-${v.id}`}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            tabIndex={view === v.id ? 0 : -1}
            className="plan-seg-opt"
            onClick={() => view !== v.id && onChange(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </header>
  );
}
