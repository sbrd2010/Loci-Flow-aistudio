import { describe, it, expect } from "vitest";
import { minutesForTaskOn } from "./focusLedger";

// K2: "Done. 25m logged." counts minutes on THAT task TODAY. Finishing the
// commitment after two hours spent on something else must not read as two
// hours on the commitment.
const raw = {
  "2024-06-15": {
    e1: { type: "focus_completed", taskId: "t1", focusElapsedSeconds: 1500 },
    e2: { type: "focus_abandoned", taskId: "t1", focusElapsedSeconds: 600 },
    e3: { type: "focus_completed", taskId: "t2", focusElapsedSeconds: 3000 },
    e4: { type: "focus_started", taskId: "t1", focusElapsedSeconds: 9999 },
  },
  "2024-06-14": {
    e5: { type: "focus_completed", taskId: "t1", focusElapsedSeconds: 1800 },
  },
};

describe("minutesForTaskOn", () => {
  it("sums every sitting on that task that day", () => {
    // 25m completed + 10m abandoned. Both are time actually spent.
    expect(minutesForTaskOn(raw, "t1", "2024-06-15")).toBe(35);
  });

  it("ignores other tasks and other days", () => {
    expect(minutesForTaskOn(raw, "t2", "2024-06-15")).toBe(50);
    expect(minutesForTaskOn(raw, "t1", "2024-06-14")).toBe(30);
    expect(minutesForTaskOn(raw, "t1", "2024-06-13")).toBe(0);
  });

  it("ignores a start with no terminal event, so time is never double-counted", () => {
    // e4 is focus_started — not terminal, so its seconds are not time spent.
    expect(minutesForTaskOn(raw, "t1", "2024-06-15")).not.toBe(35 + 167);
  });

  it("is zero rather than throwing when the ledger could not be read", () => {
    expect(minutesForTaskOn(null, "t1", "2024-06-15")).toBe(0);
    expect(minutesForTaskOn(raw, null, "2024-06-15")).toBe(0);
    expect(minutesForTaskOn(raw, "t1", null)).toBe(0);
  });
});
