import React, { useState, useMemo } from "react";
import "../styles/insights.css";
import { CATEGORY_ICONS } from "../utils/taskOps";
import { useTodayStr } from "../hooks/useTodayStr";
import {
  getDateRangeDays,
  sliceContributions,
  computeRangeStats,
  computeCompletionsByDayOfWeek,
  computeCompletedByCategory,
  computeActiveMix,
  parseLocalDateOnly,
} from "../utils/insightsContext";

const RANGE_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
];

const DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function StatTile({ label, value }) {
  return (
    <div className="insights-stat-tile">
      <div className="insights-stat-value">{value}</div>
      <div className="insights-stat-label">{label}</div>
    </div>
  );
}

function formatDateLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Chronological bars — one per actual calendar day in the range. 7 days get
// full always-visible labels (room to spare); 30 days get slim bars with
// sparse date ticks (every 5th + the last) so 360px stays readable, while
// every bar still carries an accessible/title label with its exact date and
// count — "no chart relies on hover" per the mobile-layout requirement.
function DailyBarsSection({ rangeKey, daily }) {
  const isSlim = rangeKey === "30d";
  const maxCount = Math.max(1, ...daily.map((d) => d.count));
  const first = parseLocalDateOnly(daily[0].dateString);
  const last = parseLocalDateOnly(daily[daily.length - 1].dateString);

  return (
    <div className="insights-section">
      <h3 className="insights-section-title">{isSlim ? "30-Day Trend" : "Daily Completions"}</h3>
      <p className="insights-section-subtitle">
        {formatDateLabel(first)} – {formatDateLabel(last)}
      </p>
      <div className={`insights-bars${isSlim ? " insights-bars--slim" : ""}`}>
        {daily.map((d, i) => {
          const date = parseLocalDateOnly(d.dateString);
          const dateLabel = formatDateLabel(date);
          // 0 height, not a small nonzero minimum — a zero day must not
          // visually resemble a small positive value, especially in the
          // 30-day chart where most bars have no visible numeric label.
          // insights-bar-track's own baseline border is what a zero bar
          // reads against, distinct from an actually-missing bar.
          const heightPct = d.count === 0 ? 0 : Math.max(6, Math.round((d.count / maxCount) * 100));
          const showTick = !isSlim || i % 5 === 0 || i === daily.length - 1;
          const tickLabel = isSlim ? String(date.getDate()) : date.toLocaleDateString("en-US", { weekday: "short" });
          return (
            <div key={d.dateString} className="insights-bar-col">
              <div className="insights-bar-track">
                <div
                  className="insights-bar-fill"
                  style={{ height: `${heightPct}%` }}
                  role="img"
                  aria-label={`${dateLabel}: ${d.count} completed`}
                  title={`${dateLabel}: ${d.count} completed`}
                />
              </div>
              {!isSlim && <span className="insights-bar-value">{d.count}</span>}
              <span className={`insights-bar-tick${showTick ? "" : " insights-bar-tick--hidden"}`} aria-hidden={!showTick}>
                {tickLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Sun-Sat aggregate, only rendered by the caller once computeCompletionsByDayOfWeek
// has decided there's a confident, non-tied bestDay — otherwise the caller
// shows the "Building your rhythm" fallback instead of this chart entirely,
// so a low-confidence pattern is never presented as if it were a settled one.
function WeekdayPatternSection({ weekday }) {
  const maxCount = Math.max(1, ...DAY_ORDER.map((d) => weekday.counts[d]));
  return (
    <div className="insights-section">
      <h3 className="insights-section-title">Completion Pattern</h3>
      <div className="insights-bars">
        {DAY_ORDER.map((day) => {
          const count = weekday.counts[day];
          const isBest = day === weekday.bestDay;
          // Same 0-height-not-a-minimum treatment as the daily bars above.
          const heightPct = count === 0 ? 0 : Math.max(6, Math.round((count / maxCount) * 100));
          return (
            <div key={day} className="insights-bar-col">
              <div className="insights-bar-track">
                <div
                  className={`insights-bar-fill${isBest ? " insights-bar-fill--best" : ""}`}
                  style={{ height: `${heightPct}%` }}
                  role="img"
                  aria-label={`${day}: ${count} completed`}
                  title={`${day}: ${count} completed`}
                />
              </div>
              <span className="insights-bar-value">{count}</span>
              <span className="insights-bar-tick">{day}</span>
            </div>
          );
        })}
      </div>
      <p className="insights-pattern-note">
        Most Completions: <strong>{weekday.bestDay}</strong>
      </p>
    </div>
  );
}

function CategoryBars({ entries, total, variant }) {
  const maxCount = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="insights-category-list">
      {entries.map(([cat, count]) => (
        <div key={cat} className="insights-category-row">
          <span className="insights-category-name">
            {CATEGORY_ICONS[cat] ? `${CATEGORY_ICONS[cat]} ` : ""}
            {cat}
          </span>
          <div className="insights-category-track">
            <div
              className={`insights-category-fill${variant ? ` insights-category-fill--${variant}` : ""}`}
              style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
              role="img"
              aria-label={`${cat}: ${count} of ${total}`}
            />
          </div>
          <span className="insights-category-count">{count}</span>
        </div>
      ))}
    </div>
  );
}

// Rendered whenever the caller has any completions for the period at all —
// deliberately no early-return on empty categoryCounts, since the
// disclosure below is meaningful (and worth showing) even when there's
// nothing to list. No exact "X of Y" coverage claim here — dateCompletedString
// and contributions[]'s date can be stamped by two different clocks at every
// current completion call site (see insightsContext.js's
// computeCompletedByCategory comment / issue #361), so retainedCount isn't a
// reliable numerator for a coverage percentage against the range total.
function CategoryBreakdownSection({ category }) {
  const entries = Object.entries(category.categoryCounts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="insights-section">
      <h3 className="insights-section-title">Completed by Category</h3>
      {entries.length > 0 ? (
        <CategoryBars entries={entries} total={category.retainedCount} />
      ) : (
        <p className="insights-pattern-note insights-pattern-note--muted">No category details available for this period.</p>
      )}
      <p className="insights-coverage-note">
        Category details are based on available task records and may not exactly match the completion total above.
      </p>
    </div>
  );
}

function CurrentLoadSection({ activeMix }) {
  const entries = Object.entries(activeMix.categoryMix).sort((a, b) => b[1] - a[1]);
  return (
    <div className="insights-section insights-section--current">
      <h3 className="insights-section-title">Current Load — based on tasks open now</h3>
      {entries.length === 0 ? (
        <p className="insights-pattern-note insights-pattern-note--muted">No open tasks right now.</p>
      ) : (
        <CategoryBars entries={entries} total={activeMix.currentOpenCount} variant="current" />
      )}
    </div>
  );
}

export default function InsightsPanel({ payload, onBack }) {
  const { tasks = [], contributions = [] } = payload || {};
  const [rangeKey, setRangeKey] = useState("7d");
  // This panel has no other 1s/60s clock tick of its own, so without this,
  // a memo keyed only on [rangeKey, tasks, contributions] would hold Today/
  // 7 Days/30 Days anchored to whatever day it was when first computed —
  // never advancing past a midnight rollover while the panel stays open
  // with no task/contribution edits happening. Same hook App.jsx/DayMapPage
  // already use for this exact class of staleness.
  const todayStr = useTodayStr();

  // contributions[] is unbounded (one record per active day for the
  // account's lifetime) and every one of these builders re-scans it — worth
  // skipping on re-renders that don't actually change rangeKey/tasks/
  // contributions/todayStr (e.g. an unrelated config sync tick while this
  // is open).
  const { stats, daily, weekday, category, activeMix } = useMemo(() => {
    const rangeDays = getDateRangeDays(rangeKey, parseLocalDateOnly(todayStr));
    const rangeStats = computeRangeStats(contributions, rangeDays);
    return {
      stats: rangeStats,
      daily: sliceContributions(contributions, rangeDays),
      weekday: rangeKey !== "today" ? computeCompletionsByDayOfWeek(contributions, rangeDays) : null,
      category: computeCompletedByCategory(tasks, rangeDays),
      activeMix: computeActiveMix(tasks),
    };
  }, [rangeKey, tasks, contributions, todayStr]);

  const hasAnyCompletions = stats.totalCompleted > 0;

  return (
    <>
      <div className="mindbox-subview-header">
        <button className="mindbox-back-btn" onClick={onBack}>← Back</button>
        <h2 className="mindbox-subview-title">Insights</h2>
      </div>

      <div className="insights-range-row" role="group" aria-label="Date range">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            aria-pressed={rangeKey === opt.key}
            className={`insights-range-btn${rangeKey === opt.key ? " selected" : ""}`}
            onClick={() => setRangeKey(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="insights-stat-grid">
        <StatTile label="Completed" value={stats.totalCompleted} />
        <StatTile label="Daily Pace" value={stats.dailyPace} />
        <StatTile label="Completion Days" value={stats.completionDaysCount} />
        <StatTile label="Current Open" value={activeMix.currentOpenCount} />
      </div>

      {!hasAnyCompletions && (
        <p className="insights-empty-state">
          Loci has no completed tasks recorded for this period. Plans may have changed, work may have happened outside
          the task list, or nothing has been marked complete yet.
        </p>
      )}

      {hasAnyCompletions && rangeKey !== "today" && <DailyBarsSection rangeKey={rangeKey} daily={daily} />}

      {hasAnyCompletions && weekday && weekday.bestDay && <WeekdayPatternSection weekday={weekday} />}
      {hasAnyCompletions && weekday && !weekday.bestDay && (
        <div className="insights-section">
          <h3 className="insights-section-title">Completion Pattern</h3>
          <p className="insights-pattern-note insights-pattern-note--muted">
            Building your rhythm — keep going and a pattern will emerge here.
          </p>
        </div>
      )}

      {hasAnyCompletions && <CategoryBreakdownSection category={category} />}

      <CurrentLoadSection activeMix={activeMix} />

      <p className="insights-footnote">Based on tasks recorded in Loci. Loci does not monitor apps or screen activity.</p>
    </>
  );
}
