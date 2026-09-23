import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEME_CHOICES, migrateStoredTheme, resolveTheme } from "./theme";

const OLD_THEMES = [
  "glassy", "coral", "teal", "polymer", "editorial", "midnight-neon", "solar-ember",
  "arctic-frost", "regal-amethyst", "option-a-amie", "option-c-zen", "option-d-bento",
  "option-e-slate", "evening", "paper",
  // removed before this change, still possibly in someone's storage
  "sage", "option-b-linear", "option-f-chronos",
];
const OLD_DARK = ["glassy", "evening", "midnight-neon", "regal-amethyst", "option-d-bento", "option-e-slate"];

describe("migrateStoredTheme", () => {
  it("keeps the three current choices", () => {
    for (const c of THEME_CHOICES) expect(migrateStoredTheme(c)).toBe(c);
  });

  it("starts a first launch on Auto", () => {
    expect(migrateStoredTheme(null)).toBe("auto");
    expect(migrateStoredTheme("")).toBe("auto");
  });

  it("sends each old dark-ground theme to Dark and every other old theme to Light", () => {
    for (const t of OLD_THEMES) {
      expect(migrateStoredTheme(t), t).toBe(OLD_DARK.includes(t) ? "dark" : "light");
    }
  });
});

describe("resolveTheme", () => {
  it("follows the device only on Auto", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

// index.html sets data-theme before React loads. Run that exact script and
// check it lands where the module does, for every stored value and both
// device settings.
describe("index.html boot script", () => {
  const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
  const script = html.match(/<script id="theme-boot">([\s\S]*?)<\/script>/)[1];

  const boot = (stored, prefersDark) => {
    let applied = null;
    const window = { matchMedia: () => ({ matches: prefersDark }) };
    const localStorage = { getItem: () => stored };
    const document = { documentElement: { setAttribute: (_k, v) => { applied = v; } } };
    new Function("window", "localStorage", "document", script)(window, localStorage, document);
    return applied;
  };

  it("matches the module for every stored value", () => {
    for (const stored of [null, ...THEME_CHOICES, ...OLD_THEMES]) {
      for (const prefersDark of [true, false]) {
        expect(boot(stored, prefersDark), `${stored} / prefersDark=${prefersDark}`)
          .toBe(resolveTheme(migrateStoredTheme(stored), prefersDark));
      }
    }
  });

  it("still paints when storage is blocked", () => {
    let applied = null;
    const window = { matchMedia: () => ({ matches: false }) };
    const localStorage = { getItem: () => { throw new Error("blocked"); } };
    const document = { documentElement: { setAttribute: (_k, v) => { applied = v; } } };
    new Function("window", "localStorage", "document", script)(window, localStorage, document);
    expect(applied).toBe("light");
  });
});
