import { useInsertionEffect, useLayoutEffect } from "react";

// Turn 76 (75, PART5 §2): from 1280px the app grows with the window, by the
// smaller of width ÷ 1422 and height ÷ 800, then a tenth smaller (Rohan's
// try-out, 6 Oct: "slightly big"), never below 1 or above 28.5/16 — ×1.07 on
// a 1903×940 24″. The header grows on every page; the pages built
// for it grow whole. The CSS is mostly px, so this is zoom, not font-size:
// --zoom divides the viewport units (app.css) and cssZoom() the measured
// sizes JS writes back (utils/cssZoom.js). Browser zoom doesn't change it,
// by decision (README Turn 76).
// Every page scales by the same rule (try-out D1), so switching tabs never
// changes the size; "focus" is the focus session's page.
export const SCALED_TABS = new Set(["today", "daymap", "roadmap", "mindbox", "coach", "settings", "focus"]);
export const SCALE_EASE = 1.1;

export function appScale(width, height) {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(28.5 / 16, Math.max(1, Math.min(width / 1422, height / 800) / SCALE_EASE));
}

export function useAppScale(activeTab) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--app-scale", String(appScale(window.innerWidth, window.innerHeight)));
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  // Before any page's layout effects: a page that measures itself on
  // arrival (Coach's chat) must see the route's own layout, not the one it
  // replaced (React runs a child's layout effects before its parent's).
  useInsertionEffect(() => {
    const root = document.documentElement;
    if (SCALED_TABS.has(activeTab)) root.dataset.scaleRoute = activeTab;
    else delete root.dataset.scaleRoute;
  }, [activeTab]);
}
