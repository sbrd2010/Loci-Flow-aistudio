import { describe, expect, it } from "vitest";
import { breaksFromWindows } from "./dayMapRoute";
import { defaultFixTime, describeFixMoves, previewFix, timeChips, toLociMinutes } from "./fixedTime";

const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const task = (uuid, title, minutes) => ({ uuid, title, minutes });
const durationOf = (t) => t.minutes;

describe("timeChips (58d)", () => {
  it("puts the picked half hour fourth of six", () => {
    expect(timeChips(hm("14:30")).map(clock)).toEqual(["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]);
    expect(timeChips(hm("14:40")).map(clock)).toEqual(["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]);
  });
  it("pages by three hours, earlier and later", () => {
    expect(timeChips(hm("14:30"), -1).map(clock)[0]).toBe("10:00");
    expect(timeChips(hm("14:30"), 1).map(clock)[0]).toBe("16:00");
  });
});

describe("toLociMinutes", () => {
  // A day from 07:00 with a window to 02:00.
  it("keeps a time after midnight on the day's scale", () => {
    expect(toLociMinutes(hm("00:30"), hm("07:00"))).toBe(1440 + 30);
    expect(toLociMinutes(1440 + 30 + 5, hm("07:00"))).toBe(1440 + 35);
    expect(toLociMinutes(hm("14:30"), hm("07:00"))).toBe(hm("14:30"));
    expect(toLociMinutes(-5, hm("07:00"))).toBe(hm("23:55"));
  });
});

describe("defaultFixTime", () => {
  it("is where the stop sits now, or the next 5 minutes for something new", () => {
    expect(defaultFixTime(hm("15:05"), hm("11:02"))).toBe(hm("15:05"));
    expect(defaultFixTime(undefined, hm("11:02"))).toBe(hm("11:05"));
  });
});

// 58d: the Everly call at 14:30. Pharmacy (14:15–14:30) still fits before
// it; Prof. Hale moves from 14:35 to 15:05; the day now ends at 18:10.
describe("previewFix + describeFixMoves (58d)", () => {
  const lunch = breaksFromWindows([{ startMin: hm("08:00"), endMin: hm("13:35") }, { startMin: hm("14:15"), endMin: hm("17:30") }], "Lunch");
  const route = [task("cv", "Prepare CV", 120), task("ph", "Pharmacy: order the refill", 15), task("hale", "Reply to Prof. Hale", 25),
    task("dad", "Dad: write the letter", 25), task("pr", "Course: PRINCE2", 60), task("grove", "Grove: tailor the summary", 45), task("dentist", "Book the dentist", 10)];
  const call = task("call", "Call with the Everly recruiter", 30);
  const opts = { from: hm("11:35"), breaks: lunch, durationOf };

  it("says what still fits, what moves, and where the day ends", () => {
    const moves = describeFixMoves(previewFix(route, call, hm("14:30"), opts), call);
    expect(moves.fits).toEqual({ title: "Pharmacy: order the refill", start: hm("14:15"), end: hm("14:30") });
    expect(moves.moved).toEqual({ title: "Reply to Prof. Hale", from: hm("14:35"), to: hm("15:05"), more: 4 });
    expect(moves.movedCount).toBe(5);
    expect(clock(moves.dayEnds)).toBe("18:10");
  });

  it("fixing a stop already on the route moves only the ones in its way", () => {
    const moves = describeFixMoves(previewFix(route, route[2], hm("16:30"), opts), route[2]);
    // Hale leaves 14:35 for 16:30; Dad and PRINCE2 flow up behind Pharmacy.
    expect(moves.moved.title).toBe("Dad: write the letter");
    expect(clock(moves.moved.from)).toBe("15:05");
    expect(clock(moves.moved.to)).toBe("14:35");
  });

  it("says nothing moves when nothing does", () => {
    const moves = describeFixMoves(previewFix(route, call, hm("20:00"), opts), call);
    expect(moves.moved).toBeNull();
    expect(moves.movedCount).toBe(0);
  });
});
