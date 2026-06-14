import { describe, it, expect } from "vitest";
import { getFocusWindows } from "./focusWindows";
import { getDueDailyCheckins } from "./reminders";

const dt = (h, mi = 0) => new Date(2024, 5, 15, h, mi);
const TODAY = "2024-06-15";

describe("getDueDailyCheckins", () => {
  const windows = getFocusWindows({ focusWindows: [{ start: "09:00", end: "17:00" }] });

  it("returns nothing before the first focus window opens", () => {
    expect(getDueDailyCheckins({}, windows, dt(8, 0))).toEqual([]);
  });

  it("returns 'morning' once Morning Ritual is no longer pending", () => {
    const config = { morningRitualShownDate: TODAY };
    expect(getDueDailyCheckins(config, windows, dt(9, 0))).toEqual(["morning"]);
  });

  it("returns 'midday' once the focus midpoint passes, after committing", () => {
    const config = { morningRitualShownDate: TODAY, dailyCommitmentDate: TODAY, dailyCommitmentTaskIds: ["a"] };
    expect(getDueDailyCheckins(config, windows, dt(13, 0))).toEqual(["midday"]);
  });

  it("can return multiple due check-ins at once", () => {
    const config = { morningRitualShownDate: TODAY };
    expect(getDueDailyCheckins(config, windows, dt(16, 45))).toEqual(["morning", "reflection"]);
  });

  it("returns nothing once all three are completed for the day", () => {
    const config = {
      morningRitualShownDate: TODAY,
      dailyCommitmentDate: TODAY,
      dailyCommitmentTaskIds: ["a"],
      dailyMiddayCheckDate: TODAY,
      dailyReflectionDate: TODAY,
    };
    expect(getDueDailyCheckins(config, windows, dt(16, 45))).toEqual([]);
  });
});
