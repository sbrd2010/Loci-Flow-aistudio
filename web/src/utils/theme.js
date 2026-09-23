// Two themes, Light (palette 29) and Dark (36c), plus Auto, which follows the
// device's dark-mode setting the way Motion and Text size follow the device.
// The choice lives only on this device (localStorage "loci_theme"); nothing
// here is synced.
//
// index.html repeats migrateStoredTheme + resolveTheme in its inline script so
// the first paint is already in the right theme. theme.test.js runs that
// script against this module, so the two cannot drift apart.

export const THEME_CHOICES = ["light", "dark", "auto"];

// The fifteen themes this replaced. The dark-ground ones become Dark and the
// rest Light, so nobody who picked a look wakes up in its opposite. "Dark"
// means the theme's --bg-primary was dark (e.g. Bento's #0d1117), measured,
// not guessed from its name. "glassy" was the default for anyone who never
// picked, so they land on Dark too.
const OLD_DARK_THEMES = ["glassy", "evening", "midnight-neon", "regal-amethyst", "option-d-bento", "option-e-slate"];

export function migrateStoredTheme(stored) {
  if (THEME_CHOICES.includes(stored)) return stored;
  if (!stored) return "auto";
  return OLD_DARK_THEMES.includes(stored) ? "dark" : "light";
}

// The value written to <html data-theme>: always "light" or "dark".
export function resolveTheme(choice, prefersDark) {
  if (choice === "auto") return prefersDark ? "dark" : "light";
  return choice === "dark" ? "dark" : "light";
}
