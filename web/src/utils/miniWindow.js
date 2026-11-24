// The mini window (Document Picture-in-Picture), design 77 C2 "Ring" (#508):
// the ring fills the window, the digits and the title sit inside it, and
// round icon buttons fade in over the ring's bottom on hover or keyboard
// focus (shown for the first 4 s after it opens, so they can be found). The
// title stays on hover (the drawing hides it), so its ↗ can still be clicked.
// Paused and block end show their own buttons under a smaller ring instead.
// Dark by default whatever the app's theme; ⋯ switches it (this device only).
//
// `miniView` is the pure part (what the window says, in which state);
// `buildMiniWindow` makes the DOM once and returns `render(view)`.

import { clockParts } from "./focusClock";
import { BINAURAL_TRACK_ID } from "./binauralBeat";
import { getCategoryKeyForTrack } from "./soundLibrary";

export const MINI_THEME_KEY = "loci_mini_theme";
export const MINI_FRESH_MS = 4000;
const LATE_SECONDS = 5 * 60;

// The running label names the sound that's on ("Rain"); nothing when it's off.
const SOUND_NAMES = { rain: "Rain", nature: "Nature", lofi: "Lo-fi", jazz: "Jazz", piano: "Piano", chillhop: "Chillhop" };
export function soundShortName(trackId) {
  if (!trackId || trackId === "none") return "";
  if (trackId === BINAURAL_TRACK_ID) return "40 Hz beat";
  return SOUND_NAMES[getCategoryKeyForTrack(trackId)] || "";
}

// What the window shows. `blockPhase` is the hook's block end ("done" |
// "break" | "over" | null). Block end wins over paused, paused over the last
// five minutes. The ring is the remaining fraction: full when a block is
// done; during block end's 5-minute break (Q41) it counts the break down, as
// the focus bar does.
export function miniView({ secondsLeft, maxSeconds, running, blockPhase = null, sound = "", breakLeft = 0, breakSeconds = 300 }) {
  const left = Math.max(0, Math.round(Number(secondsLeft) || 0));
  const max = Math.max(0, Math.round(Number(maxSeconds) || 0));
  if (blockPhase === "break") {
    const b = Math.max(0, Math.round(Number(breakLeft) || 0));
    const bMax = Math.max(1, Math.round(Number(breakSeconds) || 0));
    return { state: "done", phase: "break", label: "On a break", ...clock(b, bMax), frac: Math.min(1, b / bMax) };
  }
  if (blockPhase) {
    const label = blockPhase === "over" ? "Break’s over" : "Block done";
    return { state: "done", phase: blockPhase, label, ...clock(max, max), frac: 1 };
  }
  const frac = max > 0 ? Math.min(1, left / max) : 0;
  if (!running) return { state: "paused", label: "Paused", ...clock(left, max), frac };
  if (left > 0 && left <= LATE_SECONDS) {
    return { state: "late", label: `${Math.ceil(left / 60)} min left`, ...clock(left, max), frac };
  }
  return { state: "run", label: sound || "", ...clock(left, max), frac };
}

function clock(seconds, max) {
  const { lead, seconds: ss, hours } = clockParts(seconds, max);
  return { time: `${lead}:${ss}`, hours };
}

// The mini window's own palette (drawing 77-c4 dark, 77-c5 light).
const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --bg:#0e1712; --ink:#e8eee9; --muted:#a9b6ad; --line:#26332c; --track:#1f3027; --arc:#8fd1a8;
          --late:#f3ead2; --quiet:#5d6b63; --chip:#16211b; }
  body.is-light { --bg:#f7f4ec; --ink:#0f1f16; --muted:#3e5044; --line:#dcdfd5; --track:#e0ece3; --arc:#1f4d36;
          --late:#7A5A1C; --quiet:#858b86; --chip:#f7f4ec; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    height: 100vh; padding: 14px; font-family: Manrope, system-ui, sans-serif; color: var(--ink);
    background: var(--bg); user-select: none; overflow: hidden; }

  /* The ring is the window: diameter = window − 28; with buttons under it, − 92. */
  #ring { position: relative; flex: none; width: calc(min(100vw, 100vh) - 28px); aspect-ratio: 1;
    container-type: size; border-radius: 50%; cursor: pointer; }
  body.has-cta #ring { width: calc(min(100vw, 100vh) - 92px); }
  #ring > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  #pr-bg, #pr-fg { fill: none; }
  #pr-bg { stroke: var(--track); }
  #pr-fg { stroke: var(--arc); stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
  body.is-paused #pr-fg { stroke: var(--quiet); }
  body.is-late #pr-fg { stroke: var(--late); }

  #face { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 4px; padding: 0 16cqmin; text-align: center; }
  #pi { display: none; width: 20px; height: 20px; color: var(--arc); }
  body.is-done #pi { display: block; }
  #pp { font-size: 12.5px; font-weight: 700; line-height: 1.2; color: var(--muted); }
  #pp:empty { display: none; }
  body.is-late #pp { color: var(--late); }
  body.is-done #pp { color: var(--arc); }
  #pt { font-size: 25cqmin; font-weight: 800; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums;
    color: var(--ink); white-space: nowrap; }
  #pt.is-hours { font-size: 19cqmin; }
  body.is-paused #pt { color: var(--muted); }
  body.is-late #pt { color: var(--late); }
  /* The title opens Loci's tab; the mini window stays (try-out 38). */
  #pl { max-width: 100%; font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1.3;
    color: var(--muted); background: none; border: 0; border-radius: 4px; cursor: pointer;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  #pl::after { content: " ↗"; }
  #pl:hover { color: var(--ink); }
  #pl:focus-visible { outline: 2px solid var(--arc); outline-offset: 2px; }
  body.has-cta #pl { display: none; }

  /* Hover or keyboard focus: round icons over the ring's bottom (150 ms). */
  #pip-btns { position: absolute; left: 0; right: 0; bottom: 9.5cqmin; display: flex; justify-content: center; gap: 6px;
    opacity: 0; pointer-events: none; transition: opacity 150ms ease; }
  body:not(.has-cta):hover #pip-btns, body:not(.has-cta).is-fresh #pip-btns, body:not(.has-cta).menu-open #pip-btns,
  body:not(.has-cta):has(#pip-btns :focus-visible) #pip-btns { opacity: 1; pointer-events: auto; }
  body.has-cta #pip-btns { display: none; }
  .ic { width: 40px; height: 40px; flex: none; border-radius: 50%; display: grid; place-items: center; padding: 0;
    color: var(--ink); background: var(--chip); border: 1px solid var(--line); cursor: pointer; }
  .ic svg { width: 17px; height: 17px; }
  .ic:hover { border-color: var(--quiet); }
  .ic:focus-visible { outline: 2px solid var(--arc); outline-offset: 2px; }
  #pip-done { color: var(--arc); border-color: var(--arc); }
  .ic[hidden] { display: none; }

  /* The ⋯ menu: what the row leaves out, and the theme. */
  /* A panel at the window's bottom (over the row), never past its edges. */
  #pip-menu { position: fixed; left: 50%; transform: translateX(-50%); bottom: 8px; width: min(220px, calc(100vw - 16px));
    max-height: calc(100vh - 16px); overflow-y: auto; padding: 4px; display: none; flex-direction: column; background: var(--chip);
    border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.28); z-index: 2; }
  body.menu-open #pip-menu { display: flex; }
  #pip-menu button { min-height: 36px; padding: 0 12px; text-align: left; font: inherit; font-size: 13px; font-weight: 700;
    color: var(--ink); background: none; border: 0; border-radius: 6px; cursor: pointer; }
  #pip-menu button:hover, #pip-menu button:focus-visible { background: var(--line); outline: none; }
  #pip-menu button[hidden] { display: none; }

  /* Paused and block end: outlined buttons under the ring. */
  #pip-cta { display: none; gap: 8px; }
  body.has-cta #pip-cta { display: flex; }
  #pip-cta button { height: 40px; padding: 0 14px; font: inherit; font-size: 14px; font-weight: 800; white-space: nowrap;
    color: var(--ink); background: none; border: 1px solid var(--quiet); border-radius: 4px; cursor: pointer; }
  #pip-cta button.is-main { color: var(--arc); border-color: var(--arc); }
  #pip-cta button[hidden] { display: none; }
  #pip-cta button:focus-visible { outline: 2px solid var(--arc); outline-offset: 2px; }

  /* The row by width (77-c2): 400 → Pause +5 Shuffle Done ⋯; 320 → Pause +5 Done ⋯; less → Pause Done ⋯.
     From 320, while a sound can shuffle, Shuffle takes +5's place (owner, after #672: Shuffle stays
     in reach at the default size); +5 moves to ⋯. */
  @media (max-width: 399px) {
    #pip-shuffle { display: none; }
    body.can-shuffle #pip-shuffle { display: grid; }
    body.can-shuffle #pip-add5 { display: none; }
  }
  @media (max-width: 319px) {
    #pip-add5, body.can-shuffle #pip-shuffle { display: none; }
    #pl { display: none; }
    #pp { font-size: 11px; }
    /* The row takes the label's place while it shows. */
    body:not(.has-cta):hover #pp, body:not(.has-cta).is-fresh #pp { visibility: hidden; }
    #pip-cta { gap: 6px; }
    #pip-cta button { height: 36px; padding: 0 9px; font-size: 12.5px; }
  }
  @media (min-width: 400px) and (min-height: 400px) { #pl { font-size: 14px; } }

  /* Too small for a ring (under 180): the time on one line, Pause and Done always shown. */
  @media (max-height: 179px), (max-width: 179px) {
    body { gap: 8px; padding: 8px 12px; }
    body.has-cta #ring, #ring { container-type: normal; width: 100%; aspect-ratio: auto; border-radius: 6px; }
    #ring > svg, #pl, #pi, #pip-more, #pip-add5, #pip-shuffle, #pip-cta { display: none !important; }
    #face { position: static; padding: 0; }
    #pp { visibility: visible !important; }
    #pt, #pt.is-hours { font-size: clamp(24px, min(34vh, 21vw), 120px); }
    #pip-btns { position: static; opacity: 1; pointer-events: auto; }
    body.has-cta #pip-btns { display: flex; }
    /* At block end there is nothing to resume: Done only. */
    body.is-done #pip-play { display: none; }
  }
  /* Smaller still: the time alone. */
  @media (max-height: 139px), (max-width: 139px) {
    body { padding: 4px 8px; }
    #pp { font-size: 10px; }
    #pip-btns, body.has-cta #pip-btns { display: none; }
    #pt, #pt.is-hours { font-size: clamp(16px, min(70vh, 22vw), 140px); }
  }
  @media (prefers-reduced-motion: reduce) { #pip-btns, #pr-fg { transition: none; } }
`;

const ICONS = {
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  play: "M6 3l14 9-14 9V3z",
  plus: "M12 5v14M5 12h14",
  shuffle: "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4",
  check: "M20 6 9 17l-5-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

// Ring arithmetic in the SVG's 100-unit box. The stroke is the window's
// shorter side / 44, at least 5 px (77-c2), converted to box units for a
// ring `ringPx` wide; the radius keeps the stroke inside the box.
export function ringStroke(windowMin, ringPx) {
  const px = Math.max(5, Math.round((Number(windowMin) || 0) / 44));
  const width = ringPx > 0 ? (px * 100) / ringPx : 4;
  return { width, r: 50 - width / 2 };
}
// The remaining arc from 12 o'clock, shrinking clockwise, as the focus
// page's ring (focusClock).
export function ringDash(frac, r = 48) {
  const c = 2 * Math.PI * r;
  const f = Math.min(1, Math.max(0, Number(frac) || 0));
  return { dash: `${f * c} ${c}`, offset: -(1 - f) * c };
}

// Builds the window once. `on` holds the actions: togglePlay, addFive,
// shuffle, stuck, done, nextBlock, openTab. Returns `render(view)`, where
// view = miniView(...) plus { title, canShuffle, running }.
export function buildMiniWindow(doc, win, on, storage, fontHrefs = []) {
  const svgNS = "http://www.w3.org/2000/svg";
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
  const icon = (name) => {
    const s = doc.createElementNS(svgNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    const p = doc.createElementNS(svgNS, "path");
    p.setAttribute("d", ICONS[name]);
    s.appendChild(p);
    return s;
  };

  // The PiP document starts empty: it needs the app's font stylesheet too.
  for (const href of fontHrefs) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    doc.head.appendChild(link);
  }
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);
  let light = false;
  try { light = storage?.getItem(MINI_THEME_KEY) === "light"; } catch (_) { /* storage blocked */ }
  doc.body.classList.toggle("is-light", light);

  // The ring: track, arc, and the face (check, label, time, title).
  // A click on the ring pauses or resumes (a mouse convenience); the
  // accessible control is #pip-play, and Space works anywhere.
  const ring = el("div", { id: "ring", title: "Pause or resume · Space" });
  const svg = doc.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  for (const id of ["pr-bg", "pr-fg"]) {
    const c = doc.createElementNS(svgNS, "circle");
    c.id = id;
    c.setAttribute("cx", "50");
    c.setAttribute("cy", "50");
    if (id === "pr-fg") c.setAttribute("transform", "rotate(-90 50 50)");
    svg.appendChild(c);
  }
  const check = icon("check");
  check.id = "pi";
  const label = el("div", { id: "pp" });
  const time = el("div", { id: "pt" });
  const title = el("button", { id: "pl", type: "button", title: "Open Loci — this window stays open" });
  title.addEventListener("click", (e) => { e.stopPropagation(); on.openTab(); });
  const face = el("div", { id: "face" }, check, label, time, title);

  // The icon row, over the ring's bottom.
  const row = el("div", { id: "pip-btns" });
  const iconBtn = (id, name, aria, tip, onClick) => {
    const b = el("button", { id, type: "button", className: "ic", title: tip });
    b.setAttribute("aria-label", aria);
    b.appendChild(icon(name));
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    row.appendChild(b);
    return b;
  };
  const play = iconBtn("pip-play", "pause", "Pause", "Pause · Space", on.togglePlay);
  iconBtn("pip-add5", "plus", "Add 5 minutes", "+5 min", on.addFive);
  const shuffle = iconBtn("pip-shuffle", "shuffle", "Shuffle sound", "Another track · S", on.shuffle);
  // No key for Done here: the window keeps focus over other apps, so a stray
  // "d" would complete the task, with no Undo (owner decision, #672).
  iconBtn("pip-done", "check", "Done", "Done", on.done);
  const more = iconBtn("pip-more", "more", "More", "More", () => setMenu(!doc.body.classList.contains("menu-open")));
  more.setAttribute("aria-haspopup", "menu");
  ring.append(svg, face, row);

  // ⋯: +5 and Shuffle when the row leaves them out, I'm stuck, the theme.
  const menu = el("div", { id: "pip-menu" });
  menu.setAttribute("role", "menu");
  const item = (id, text, onClick) => {
    const b = el("button", { id, type: "button", textContent: text });
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", (e) => { e.stopPropagation(); setMenu(false); onClick(); });
    menu.appendChild(b);
    return b;
  };
  const mAdd5 = item("pip-menu-add5", "+5 min", on.addFive);
  const mShuffle = item("pip-menu-shuffle", "Shuffle sound", on.shuffle);
  item("pip-stuck", "I’m stuck", on.stuck);
  // The title is ↗ from 320 wide; under that, and anywhere, it's here too.
  item("pip-menu-open", "Open Loci", on.openTab);
  const mTheme = item("pip-menu-theme", "", () => {
    light = !light;
    doc.body.classList.toggle("is-light", light);
    try { storage?.setItem(MINI_THEME_KEY, light ? "light" : "dark"); } catch (_) { /* storage blocked */ }
    mTheme.textContent = light ? "Dark theme" : "Light theme";
  });
  mTheme.textContent = light ? "Dark theme" : "Light theme";
  const setMenu = (open) => {
    doc.body.classList.toggle("menu-open", open);
    more.setAttribute("aria-expanded", String(open));
    if (open) {
      const w = win.innerWidth;
      // ⋯ holds what the row leaves out (see the row by width, above).
      const canShuffle = !shuffle.hidden;
      mAdd5.hidden = w >= 400 || (w >= 320 && !canShuffle);
      mShuffle.hidden = !canShuffle || w >= 320;
      menu.querySelector("button:not([hidden])")?.focus();
    }
  };
  doc.addEventListener("click", (e) => { if (!menu.contains(e.target) && e.target !== more) setMenu(false); });

  // Paused and block end: the buttons under the ring.
  const cta = el("div", { id: "pip-cta" });
  const ctaBtn = (id, text, main, onClick) => {
    const b = el("button", { id, type: "button", textContent: text, className: main ? "is-main" : "" });
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    cta.appendChild(b);
    return b;
  };
  const resume = ctaBtn("pip-resume", "Resume", true, on.togglePlay);
  const next = ctaBtn("pip-next", "Next block", true, on.nextBlock);
  const doneTask = ctaBtn("pip-cta-done", "Done task", false, on.done);

  ring.addEventListener("click", on.togglePlay);
  doc.body.append(ring, cta, menu);

  // Space pauses or resumes (on a focused button, it presses the button); S
  // shuffles; Esc closes ⋯.
  doc.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const menuOpen = doc.body.classList.contains("menu-open");
    if (e.key === "Escape") { if (menuOpen) { setMenu(false); more.focus(); } return; }
    if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = [...menu.querySelectorAll("button:not([hidden])")];
      const i = items.indexOf(doc.activeElement);
      const next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
      e.preventDefault();
      next?.focus();
      return;
    }
    const onButton = e.target?.closest?.("button");
    if (e.key === " ") {
      if (onButton) return;
      e.preventDefault();
      on.togglePlay();
    } else if (e.key === "s" || e.key === "S") on.shuffle();
  });

  // Shown for the first 4 s, so the buttons can be found.
  doc.body.classList.add("is-fresh");
  win.setTimeout(() => doc.body.classList.remove("is-fresh"), MINI_FRESH_MS);

  const arc = svg.querySelector("#pr-fg");
  const circles = svg.querySelectorAll("circle");
  let shownRunning = null;
  let lastFrac = 0;
  // The stroke and radius follow the ring's real size (window resizes too).
  const drawArc = () => {
    const { width, r } = ringStroke(Math.min(win.innerWidth, win.innerHeight), ring.getBoundingClientRect().width);
    for (const c of circles) { c.setAttribute("r", String(r)); c.setAttribute("stroke-width", String(width)); }
    const { dash, offset } = ringDash(lastFrac, r);
    arc.setAttribute("stroke-dasharray", dash);
    arc.setAttribute("stroke-dashoffset", String(offset));
    arc.style.display = lastFrac > 0 ? "" : "none";
  };
  win.addEventListener("resize", drawArc);
  return function render(v) {
    const body = doc.body;
    for (const s of ["run", "paused", "late", "done"]) body.classList.toggle(`is-${s === "run" ? "running" : s}`, v.state === s);
    body.classList.toggle("has-cta", v.state === "paused" || v.state === "done");
    label.textContent = v.label;
    time.textContent = v.time;
    time.className = v.hours ? "is-hours" : "";
    title.textContent = v.title;
    lastFrac = v.frac;
    const running = v.state === "run" || v.state === "late";
    if (running !== shownRunning) {
      shownRunning = running;
      play.replaceChildren(icon(running ? "pause" : "play"));
      play.setAttribute("aria-label", running ? "Pause" : "Resume");
      play.title = running ? "Pause · Space" : "Resume · Space";
    }
    shuffle.hidden = !v.canShuffle;
    doc.body.classList.toggle("can-shuffle", Boolean(v.canShuffle));
    drawArc();
    resume.hidden = v.state !== "paused";
    next.hidden = doneTask.hidden = v.state !== "done";
  };
}
