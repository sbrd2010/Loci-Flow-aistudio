import { describe, it, expect } from "vitest";
import { miniView, ringDash, ringStroke, soundShortName } from "./miniWindow";
import { BINAURAL_TRACK_ID } from "./binauralBeat";

describe("miniView (#508, C2 ring)", () => {
  it("running: the sound's name as the label, the remaining fraction as the ring", () => {
    const v = miniView({ secondsLeft: 872, maxSeconds: 1500, running: true, sound: "Rain" });
    expect(v).toMatchObject({ state: "run", label: "Rain", time: "14:32", hours: false });
    expect(v.frac).toBeCloseTo(872 / 1500);
  });

  it("running with no sound on: no label", () => {
    expect(miniView({ secondsLeft: 900, maxSeconds: 1500, running: true }).label).toBe("");
  });

  it("last 5 minutes: counts down in whole minutes, from 5:00 to the last second", () => {
    expect(miniView({ secondsLeft: 300, maxSeconds: 1500, running: true })).toMatchObject({ state: "late", label: "5 min left" });
    expect(miniView({ secondsLeft: 221, maxSeconds: 1500, running: true })).toMatchObject({ state: "late", label: "4 min left", time: "3:41" });
    expect(miniView({ secondsLeft: 1, maxSeconds: 1500, running: true })).toMatchObject({ state: "late", label: "1 min left" });
    expect(miniView({ secondsLeft: 301, maxSeconds: 1500, running: true }).state).toBe("run");
  });

  it("paused wins over the last 5 minutes", () => {
    expect(miniView({ secondsLeft: 200, maxSeconds: 1500, running: false })).toMatchObject({ state: "paused", label: "Paused", time: "3:20" });
  });

  it("block end wins over paused: a full ring and the block's length, labelled by phase", () => {
    const done = miniView({ secondsLeft: 0, maxSeconds: 1500, running: false, blockPhase: "done" });
    expect(done).toMatchObject({ state: "done", label: "Block done", time: "25:00", frac: 1 });
    expect(miniView({ secondsLeft: 0, maxSeconds: 1500, running: false, blockPhase: "break" }).label).toBe("On a break");
    expect(miniView({ secondsLeft: 0, maxSeconds: 1500, running: false, blockPhase: "over" }).label).toBe("Break’s over");
  });

  it("a block over 99 minutes reads h:mm:ss and says so", () => {
    expect(miniView({ secondsLeft: 3900, maxSeconds: 7200, running: true })).toMatchObject({ time: "1:05:00", hours: true });
  });

  it("no length: an empty ring, never NaN", () => {
    const v = miniView({ secondsLeft: undefined, maxSeconds: 0, running: false });
    expect(v.frac).toBe(0);
    expect(v.time).toBe("0:00");
  });
});

describe("ringStroke", () => {
  it("is the window's shorter side / 44 px, at least 5, in the ring's 100-unit box", () => {
    expect(ringStroke(320, 292).width).toBeCloseTo(7 * 100 / 292);
    expect(ringStroke(400, 372).width).toBeCloseTo(9 * 100 / 372);
    expect(ringStroke(150, 122).width).toBeCloseTo(5 * 100 / 122);
    const { width, r } = ringStroke(320, 292);
    expect(r + width / 2).toBeCloseTo(50);
  });
});

describe("ringDash", () => {
  it("draws the remaining fraction and clamps outside 0–1", () => {
    const full = ringDash(1);
    const [len, total] = full.dash.split(" ").map(Number);
    expect(len).toBeCloseTo(total);
    expect(full.offset).toBeCloseTo(0);
    expect(Number(ringDash(-1).dash.split(" ")[0])).toBe(0);
    expect(ringDash(2).dash).toBe(full.dash);
  });
});

describe("soundShortName", () => {
  it("names the category of the track that's on, or nothing", () => {
    expect(soundShortName("gentle-midday-rain.mp3")).toBe("Rain");
    expect(soundShortName("forest-birds.mp3")).toBe("Nature");
    expect(soundShortName(BINAURAL_TRACK_ID)).toBe("40 Hz beat");
    expect(soundShortName("none")).toBe("");
    expect(soundShortName(null)).toBe("");
    expect(soundShortName("unknown.mp3")).toBe("");
  });
});
