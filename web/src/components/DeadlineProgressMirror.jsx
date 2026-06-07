import { buildDeadlineProgressMirror } from "../utils/deadlineProgressMirror";

const STATUS_STYLES = {
  done: { bg: "rgba(22, 163, 74, 0.18)", border: "#16A34A", color: "#15803D", mark: "✓" },
  missed: { bg: "rgba(239, 68, 68, 0.14)", border: "#EF4444", color: "#DC2626", mark: "!" },
  open: { bg: "rgba(217, 119, 6, 0.16)", border: "#D97706", color: "#B45309", mark: "" },
  untracked: { bg: "var(--bg-secondary)", border: "var(--border)", color: "var(--text-muted)", mark: "" }
};

const TONE_STYLES = {
  good: { border: "#16A34A", bg: "rgba(22, 163, 74, 0.08)", color: "#15803D" },
  urgent: { border: "#EF4444", bg: "rgba(239, 68, 68, 0.08)", color: "#DC2626" },
  watch: { border: "#D97706", bg: "rgba(217, 119, 6, 0.08)", color: "#B45309" },
  steady: { border: "var(--accent)", bg: "var(--accent-ring, rgba(99,102,241,0.08))", color: "var(--accent)" },
  neutral: { border: "var(--border)", bg: "var(--bg-secondary)", color: "var(--text-secondary)" }
};

function Stat({ label, value, color }) {
  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      padding: "9px 8px",
      textAlign: "center",
      minWidth: 0
    }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "18px", lineHeight: 1, fontWeight: "900", color }}>{value}</div>
      <div style={{ marginTop: "4px", fontSize: "9px", fontWeight: "800", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}

export default function DeadlineProgressMirror({ payload }) {
  const mirror = buildDeadlineProgressMirror(payload?.config || {});
  if (!mirror.hasDeadline) return null;

  const tone = TONE_STYLES[mirror.tone] || TONE_STYLES.neutral;

  return (
    <section
      data-testid="deadline-progress-mirror"
      style={{
        background: "var(--bg-card)",
        border: `1.5px solid ${tone.border}`,
        borderRadius: "var(--radius-sm)",
        padding: "13px 14px",
        marginBottom: "16px",
        boxShadow: "0 4px 18px rgba(0,0,0,0.06)"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "10px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "10px", fontWeight: "900", letterSpacing: "0.08em", color: tone.color, textTransform: "uppercase" }}>
            Key Deadline Mirror
          </div>
          <h3 style={{ margin: "2px 0 0", fontSize: "15px", lineHeight: 1.25, fontWeight: "900", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
            {mirror.headline}
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "11.5px", lineHeight: 1.45, color: "var(--text-secondary)" }}>
            {mirror.label}
          </p>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "18px", lineHeight: 1, fontWeight: "900", color: tone.color }}>
            {mirror.doneCount}/7
          </div>
          <div style={{ marginTop: "3px", fontSize: "9px", color: "var(--text-muted)", fontWeight: "800", textTransform: "uppercase" }}>
            moves done
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px", marginBottom: "10px" }}>
        {mirror.days.map(day => {
          const status = STATUS_STYLES[day.status] || STATUS_STYLES.untracked;
          return (
            <div key={day.dateStr} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", minWidth: 0 }}>
              <div
                title={`${day.dateStr}: ${day.status}`}
                aria-label={`${day.label} ${day.status}`}
                style={{
                  width: day.isToday ? "30px" : "25px",
                  height: day.isToday ? "30px" : "25px",
                  borderRadius: "50%",
                  background: status.bg,
                  border: `${day.isToday ? 2.5 : 1.5}px solid ${status.border}`,
                  color: status.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: "900",
                  fontFamily: "var(--font-mono)"
                }}
              >
                {day.status === "open" ? "" : status.mark}
              </div>
              <span style={{ fontSize: "9px", fontWeight: day.isToday ? "900" : "700", color: day.isToday ? tone.color : "var(--text-muted)", textTransform: "uppercase" }}>
                {day.label}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "10px" }}>
        <Stat label="Done" value={mirror.doneCount} color="#15803D" />
        <Stat label="Missed" value={mirror.missedCount} color={mirror.missedCount > 0 ? "#DC2626" : "var(--text-muted)"} />
        <Stat label="Run" value={mirror.doneRun} color="var(--accent)" />
      </div>

      <div style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: "var(--radius-sm)",
        padding: "9px 10px",
        fontSize: "12px",
        lineHeight: 1.45,
        color: "var(--text-primary)",
        fontWeight: "650"
      }}>
        {mirror.body}
      </div>
    </section>
  );
}
