import { describe, it, expect } from "vitest";
import { SOUND_CATEGORIES, trackUrl, getCategoryKeyForTrack, getTrackTitle, pickRandomVariation } from "./soundLibrary";

describe("soundLibrary", () => {
  describe("trackUrl", () => {
    it("resolves a bundled local file against /sounds/", () => {
      expect(trackUrl("after-school-rain.mp3")).toBe("/sounds/after-school-rain.mp3");
    });

    it("resolves a CDN variation path against the jsDelivr CDN base", () => {
      expect(trackUrl("sounds/rain/amber-sidewalks.mp3")).toBe(
        "https://cdn.jsdelivr.net/gh/sbrd2010/Loci-flow-sounds@main/sounds/rain/amber-sidewalks.mp3"
      );
    });
  });

  describe("getCategoryKeyForTrack", () => {
    it("returns null for null/undefined", () => {
      expect(getCategoryKeyForTrack(null)).toBeNull();
      expect(getCategoryKeyForTrack(undefined)).toBeNull();
    });

    it("returns the category key for a bundled local track", () => {
      expect(getCategoryKeyForTrack("after-school-rain.mp3")).toBe("rain");
      expect(getCategoryKeyForTrack("2-am-debug-loop.mp3")).toBe("lofi");
      expect(getCategoryKeyForTrack("midnight-amber-room.mp3")).toBe("jazz");
      expect(getCategoryKeyForTrack("dust-on-the-morning-keys.mp3")).toBe("piano");
    });

    it("returns the category key for a CDN variation", () => {
      expect(getCategoryKeyForTrack("sounds/jazz/last-call-in-c-minor.mp3")).toBe("jazz");
    });

    it("returns null for an unrecognized track id", () => {
      expect(getCategoryKeyForTrack("binaural-40hz")).toBeNull();
      expect(getCategoryKeyForTrack("some-unknown-file.mp3")).toBeNull();
    });
  });

  describe("getTrackTitle", () => {
    it("returns the human-readable title for a known track", () => {
      expect(getTrackTitle("sounds/rain/amber-sidewalks.mp3")).toBe("Amber Sidewalks");
      expect(getTrackTitle("after-school-rain.mp3")).toBe("After School Rain");
    });

    it("returns null for an unknown track", () => {
      expect(getTrackTitle("nope.mp3")).toBeNull();
    });
  });

  describe("pickRandomVariation", () => {
    it("always picks a file belonging to the requested category", () => {
      for (let i = 0; i < 20; i++) {
        const file = pickRandomVariation("rain");
        expect(SOUND_CATEGORIES.rain.variations.map(v => v.file)).toContain(file);
      }
    });

    it("excludes the given file when possible", () => {
      const excluded = SOUND_CATEGORIES.lofi.variations[0].file;
      for (let i = 0; i < 20; i++) {
        expect(pickRandomVariation("lofi", excluded)).not.toBe(excluded);
      }
    });
  });
});
