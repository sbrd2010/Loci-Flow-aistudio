// #653: the first-run guide. A new account writes one real task, picks its
// first step, makes it the one thing (Do this now), and then gets a five-stop
// look around the real app. Start focus is never pressed for them.
//
// Progress lives on this device only (localStorage, one key per account).
// The account's saved tasks stay the truth: reconcileGuide() reads them to
// move the guide on, so a reload or a pin made elsewhere is picked up, and a
// replay never creates a task or starts a timer.

export const TOUR_STOPS = [
  { id: "now", tab: "today", targets: ["now", "nav-today"], title: "Your one thing" },
  { id: "upnext", tab: "today", targets: ["upnext", "switch", "nav-today"], title: "Up next and Day map",
    text: "The rest of today waits in Up next, out of the way. Switch to Day map there to see your day laid out in time." },
  { id: "mindbox", tab: "mindbox", targets: ["braindump", "nav-mindbox"], title: "Mind Box",
    text: "Too much in your head? Brain dump is where it goes: any thought, any order. Sort it later. Try one now, or choose Later." },
  { id: "plan", tab: "roadmap", targets: ["plan", "nav-roadmap"], title: "Plan",
    text: "Bigger things live here: this week, this month, this quarter and the next 6 months. Pull them into Today when it’s time." },
  { id: "coach", tab: "coach", targets: ["coach", "nav-coach"], title: "Coach, your AI partner",
    text: "Stuck, overwhelmed or unsure what’s next? Ask Coach. It reads your own tasks and plans. It’s ready to use after the tour." },
];
export const LAST_STOP = TOUR_STOPS.length - 1;

// Written in advance and labelled so. Onboarding never calls an AI provider.
// The chips are Coach's own starters (CoachTab.jsx) plus "How was my week?".
export const COACH_EXAMPLES = [
  { chip: "What should I start with?", user: "What should I start with?",
    coach: "Start with “Send the client invoice”. It’s due tomorrow and takes about ten minutes. First step: open last month’s invoice and copy it.",
    action: "Start focus · 10 min" },
  { chip: "I’m overwhelmed", user: "I’m overwhelmed. Everything feels urgent.",
    coach: "Let’s make it smaller. Only two things are due this week; the rest can wait in Plan. Which feels lighter right now: “Book the dentist” or “Draft the report intro”?",
    action: "" },
  { chip: "I’m stuck", user: "I’m stuck on the team presentation.",
    coach: "Make the first step tiny: open your slides and write one sentence, the point you want people to remember. That’s enough for five minutes.",
    action: "Start focus · 5 min" },
  { chip: "How was my week?", user: "How was my week?",
    coach: "You focused on four of five days, mostly in the mornings. Two tasks slid from Monday to Friday. Next week, try giving each one a first step before you start it.",
    action: "" },
];
// The answer to "What would help you most?" opens the example that fits it.
const NEED_EXAMPLE = { overplanner: 0, overwhelmed: 1, initiation: 2, momentum: 3 };
export function exampleForNeed(challengeType) {
  return NEED_EXAMPLE[challengeType] ?? 2;
}

const STEPS = ["task", "pin", "ready", "tour", "done"];

export function startGuide() {
  return { step: "task", stop: 0, taskUuid: null, tourPending: false, tourStarted: false, afterTour: false, focused: false, resume: false, note: null };
}

function valid(state) {
  return !!state && typeof state === "object" && STEPS.includes(state.step)
    && Number.isInteger(state.stop) && state.stop >= 0 && state.stop <= LAST_STOP;
}

const keyFor = (uid) => `loci_first_run_v1:${uid || "anon"}`;

export function loadGuide(uid, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(keyFor(uid)) || "null");
    return valid(parsed) ? { ...startGuide(), ...parsed } : null;
  } catch {
    return null;
  }
}

export function saveGuide(uid, state, storage = globalThis.localStorage) {
  try {
    if (state) storage?.setItem(keyFor(uid), JSON.stringify(state));
    else storage?.removeItem(keyFor(uid));
  } catch { /* storage blocked: the guide just won't survive a reload */ }
}

const finished = (state, note) => ({ ...state, step: "done", tourPending: false, afterTour: false, resume: false, note });
const toStop = (state, stop) => ({ ...state, step: "tour", stop, tourPending: true, tourStarted: true, afterTour: false, resume: false, note: null });

export function guideReducer(state, action) {
  if (action.type === "start") return startGuide();
  if (action.type === "replay") {
    // Never creates a task: with one pinned it tours from the top, with any
    // open task it asks for Do this now, with none it offers the first-task sheet.
    const base = { ...startGuide(), taskUuid: action.pinnedUuid || null };
    if (action.pinnedUuid) return toStop(base, 0);
    return { ...base, step: action.hasTask ? "pin" : "task" };
  }
  if (!state) return state;
  switch (action.type) {
    case "taskAdded": return { ...state, step: "pin", taskUuid: action.uuid };
    case "taskGone": return { ...state, step: "task", taskUuid: null, tourPending: false };
    case "pinned": return { ...state, step: "ready", taskUuid: action.uuid || state.taskUuid, tourPending: true };
    case "startTour": return toStop(state, 0);
    case "resumeTour": return toStop(state, state.tourStarted ? state.stop : 0);
    case "next": return state.stop >= LAST_STOP ? guideReducer(state, { type: "finish" }) : toStop(state, state.stop + 1);
    case "back": return toStop(state, Math.max(0, state.stop - 1));
    case "finish":
      // The tour ends at the person's own first focus: back to Ready, with
      // Start focus lit, unless they have already focused.
      return state.focused ? finished(state, "done") : { ...state, step: "ready", tourPending: false, afterTour: true, resume: false, note: null };
    case "focusStarted": return { ...state, focused: true, resume: false };
    case "focusEnded":
      if (state.afterTour) return finished(state, "done");
      // One quiet card after the session, once (owner decision on #653).
      return state.tourPending && state.step !== "done" ? { ...state, resume: true } : state;
    case "later": return finished(state, "later");
    case "skip": return finished(state, "skipped");
    case "dismissNote": return { ...state, note: null };
    default: return state;
  }
}

// What the saved tasks say should happen next, or null. Pure, so a reload or
// a second device editing the task moves the guide the same way.
export function reconcileGuide(state, tasks = []) {
  if (!state || !["pin", "ready", "tour"].includes(state.step)) return null;
  const live = tasks.filter(t => t && !t.isDeleted);
  const own = state.taskUuid ? live.find(t => t.uuid === state.taskUuid) : null;
  if (state.step === "pin") {
    // Pinning any open task counts: the person did the real action, even if
    // they chose a different task than the one they just wrote.
    const pinned = own?.isNowFocus ? own : live.find(t => t.isNowFocus && !t.isCompleted);
    if (pinned) return { type: "pinned", uuid: pinned.uuid };
    if (state.taskUuid && !own) return { type: "taskGone" };
    return null;
  }
  if (state.step === "ready" && state.taskUuid && !own) return { type: "taskGone" };
  return null;
}

// The card's words and which parts of the app it rings.
export function guideCard(state, { taskTitle = "", tap = "Tap" } = {}) {
  if (!state) return null;
  if (state.resume) {
    const left = TOUR_STOPS.length - state.stop;
    return state.tourStarted
      ? { kicker: "WELCOME BACK", title: `${left} tour ${left === 1 ? "stop" : "stops"} left`, text: "Pick up the tour where you left off, or save it for later.",
          targets: [], primary: { label: "Continue tour", action: "resumeTour" }, skip: { label: "Later", action: "later" } }
      : { kicker: "WELCOME BACK", title: "Nice start", text: "You’ve done the hard part. Want a 90-second look around Loci?",
          targets: [], primary: { label: "Show me around", action: "resumeTour" }, skip: { label: "Later", action: "later" } };
  }
  if (state.step === "pin") {
    const which = taskTitle ? `“${taskTitle}”` : "a task";
    return { kicker: "YOUR FIRST TASK · 3 OF 3", title: "Make it your one thing",
      text: `Open ${which} in Up next and ${tap.toLowerCase()} Do this now. It moves to Now, and everything else can wait.`,
      targets: ["upnext", "pick", "donow", "nav-today"], tab: "today", skip: { label: "Skip guide", action: "skip" } };
  }
  if (state.step === "ready") {
    return state.afterTour
      ? { kicker: "READY", title: "That’s the tour", text: "Start when you’re ready. Pick a length and press Start focus. The timer never starts by itself.",
          targets: ["start", "nav-today"], tab: "today", skip: { label: "Not now", action: "later" } }
      : { kicker: "READY", title: "Your task is ready", text: "Take a 90-second look around Loci first, or start focusing straight away.",
          targets: ["now", "nav-today"], tab: "today", primary: { label: "Show me around · 90 s", action: "startTour" }, skip: { label: "Skip guide", action: "skip" } };
  }
  if (state.step === "tour") {
    const stop = TOUR_STOPS[state.stop];
    const text = stop.id === "now"
      ? `This is your one thing${taskTitle ? `: “${taskTitle}”` : ""}. When you start, the rest of the day stays out of your way.`
      : stop.text;
    return { kicker: `TOUR · ${state.stop + 1} OF ${TOUR_STOPS.length}`, title: stop.title, text, targets: stop.targets, tab: stop.tab, stopId: stop.id,
      primary: { label: state.stop === LAST_STOP ? "Finish" : "Next", action: "next" },
      back: state.stop > 0 ? { label: "Back", action: "back" } : null,
      skip: { label: "Skip tour", action: "skip" } };
  }
  return null;
}

export const NOTES = {
  done: "Tour done. Replay it anytime in Settings › Support.",
  skipped: "Guide closed. Replay it anytime in Settings › Support.",
  later: "Saved for later. Replay the tour anytime in Settings › Support.",
};
