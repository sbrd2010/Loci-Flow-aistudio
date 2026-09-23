import { describe, it, expect } from "vitest";
import { buildDayClock } from "./dayClock";
import { getFocusWindows } from "./focusWindows";

const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });

describe("buildDayClock", () => {
  it("reads WED 23 SEP, day before month, as the design draws it", () => {
    expect(buildDayClock(new Date(2026, 8, 23, 12, 0), windows).date).toBe("WED 23 SEP");
  });

  it("gives hours and zero-padded minutes left in the day's windows", () => {
    expect(buildDayClock(new Date(2026, 8, 23, 11, 20), windows).left).toBe("5h40m");
    expect(buildDayClock(new Date(2026, 8, 23, 16, 5), windows).left).toBe("55m");
  });

  it("has nothing left once the last window has ended", () => {
    expect(buildDayClock(new Date(2026, 8, 23, 18, 0), windows).left).toBeNull();
  });
});
