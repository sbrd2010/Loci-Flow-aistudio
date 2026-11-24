import { describe, expect, it } from "vitest";
import { defaultReminderDateTime, formatHHMM, parseClock, quarterHoursAfter, minutesOfHHMM, reminderQuickPicks } from "./clockText";

describe("parseClock", () => {
  it("reads 24-hour and 12-hour times as typed", () => {
    for (const [text, min] of [
      ["14:30", 870], ["14.30", 870], ["14h30", 870], ["1430", 870], ["930", 570], ["9", 540], ["09:05", 545],
      ["0:00", 0], ["23:59", 1439], ["2pm", 840], ["2:30 pm", 870], ["2.30PM", 870], ["12am", 0], ["12pm", 720], ["12:15a", 15], [" 7 ", 420],
    ]) expect(parseClock(text), text).toBe(min);
  });
  it("refuses what isn't a time", () => {
    for (const text of ["", "abc", "24:00", "12:60", "13pm", "0am", "1:5", "12345", "-1"]) expect(parseClock(text), text).toBeNull();
  });
});

describe("helpers", () => {
  it("formats and reads HH:MM, wrapping past midnight", () => {
    expect(formatHHMM(870)).toBe("14:30");
    expect(formatHHMM(1500)).toBe("01:00");
    expect(minutesOfHHMM("07:45")).toBe(465);
    expect(minutesOfHHMM("7:45")).toBeNull();
  });
  it("offers the next quarter-hours, within the day's limit", () => {
    expect(quarterHoursAfter(622, 4)).toEqual([630, 645, 660, 675]);
    expect(quarterHoursAfter(630, 2)).toEqual([645, 660]);
    expect(quarterHoursAfter(1400, 6, 1440)).toEqual([1410, 1425]);
    expect(quarterHoursAfter(1400, 4, 1560)).toEqual([1410, 1425, 1440, 1455]);
  });
});

describe("reminderQuickPicks", () => {
  it("in the morning: in an hour, this evening, tomorrow 9, Monday 9", () => {
    const picks = reminderQuickPicks(new Date(2026, 9, 6, 10, 22)); // Tue 6 Oct 10:22
    expect(picks.map(p => [p.key, p.date, p.time])).toEqual([
      ["hour", "2026-10-06", "11:25"], ["evening", "2026-10-06", "18:00"], ["tomorrow", "2026-10-07", "09:00"], ["monday", "2026-10-12", "09:00"],
    ]);
  });
  it("late in the day there is no 'this evening', and an hour on can be tomorrow", () => {
    const picks = reminderQuickPicks(new Date(2026, 9, 6, 23, 30));
    expect(picks.map(p => p.key)).toEqual(["hour", "tomorrow", "monday"]);
    expect(picks[0]).toMatchObject({ date: "2026-10-07", time: "00:30" });
  });
  it("on a Monday, Monday is a week on", () => {
    expect(reminderQuickPicks(new Date(2026, 9, 12, 8, 0)).at(-1).date).toBe("2026-10-19");
  });
});

// #665: the date came from toISOString() (UTC) while the hour was local, so
// east of UTC after midnight it was yesterday, and west of UTC in the evening
// it was tomorrow.
describe("defaultReminderDateTime", () => {
  const inZone = (tz, fn) => {
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try { fn(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  };
  it("is the next whole hour on the local date, in any time zone", () => {
    for (const [tz, [y, mo, d, h, mi], want] of [
      ["Asia/Kolkata", [2026, 10, 13, 2, 10], { dateStr: "2026-11-13", timeStr: "03:00" }],
      ["America/Los_Angeles", [2026, 10, 13, 19, 10], { dateStr: "2026-11-13", timeStr: "20:00" }],
      ["Europe/London", [2026, 10, 13, 14, 10], { dateStr: "2026-11-13", timeStr: "15:00" }],
      ["Asia/Kolkata", [2026, 10, 13, 23, 30], { dateStr: "2026-11-14", timeStr: "00:00" }],
      ["America/Los_Angeles", [2026, 11, 31, 23, 5], { dateStr: "2027-01-01", timeStr: "00:00" }],
    ]) inZone(tz, () => expect(defaultReminderDateTime(new Date(y, mo, d, h, mi)), `${tz} ${h}:${mi}`).toEqual(want));
  });
});
