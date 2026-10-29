import { describe, expect, it } from "vitest";
import { detectFactIntent, answerFromData } from "./coachFactCards";
import { makeFixture, NOW } from "./coachSyllabus.fixture";

// The made-up user ("Sam") of the syllabus: 13 tasks on 6 days (5 the week before);
// 250 focus minutes in 6 sessions on 5 days, busiest day Sun 18 (1h30m); Tax paperwork
// 2 days overdue, Workshop in 12 days, key deadline Conference talk in 20 days;
// one parked task; 4 Mind Box thoughts.

const fixture = makeFixture();
const data = { ...fixture, now: NOW };
const ask = (text, over = {}) => answerFromData(text, { ...data, ...over });

describe("which questions a card answers", () => {
  it.each([
    ["What's due this week?", "deadlines"],
    ["Anything overdue?", "deadlines"],
    ["When is my key deadline?", "deadlines"],
    ["How many days until my workshop?", "deadlines"],
    ["Which of my fronts is the most urgent?", "deadlines"],
    ["what's late?", "deadlines"],
    ["What is due today?", "deadlines"],
    ["what's due tomorrow", "deadlines"],
    ["What have I parked?", "parked"],
    ["any tasks on hold?", "parked"],
    ["What's in my mind box?", "mindbox"],
    ["show my brain dump", "mindbox"],
    ["How many focus sessions did I do this week?", "focus"],
    ["How long did I focus this week?", "focus"],
    ["Which day did I focus the most?", "focus"],
    ["on which day was my focus time highest", "focus"],
    ["Total focus time last week?", "focus"],
    ["have I been focusing enough lately", "focus"],
    ["how much did I focus yesterday", "focus"],
    ["Am I doing better than last week?", "compare"],
    ["did I finish more tasks than last month?", "compare"],
    ["What do you know about me?", "known"],
    ["what have you remembered about me", "known"],
  ])("%s -> %s", (text, kind) => {
    expect(detectFactIntent(text, { config: fixture.config })?.kind).toBe(kind);
  });

  it.each([
    "I'm stressed about this deadline",
    "what should I do about my deadline?",
    "how long should I focus?",
    "park the groceries task",
    "add to my brain dump: buy milk",
    "start a focus session on the slides",
    "How many days until Christmas?",
    "I keep putting off the report",
    "what's my current focus task",
    "how long is a focus session",
    "tell me my pattern",
    "Remember that I don't like meetings after 3pm",
    "What's the capital of France?",
    "I feel behind today",
    "when is the meeting?",
    "how was my week?",
    "What should I work on next?",
    "mark the invoice bug as done",
    "how many focus sessions can I do today?",
    "why am I so tired due to the deadline?",
    "why is my focus so low?",
    "I feel hopeless. Is anything overdue?",
    "any overdue? I want to give up",
    "is anything overdue? i feel like a failure",
    "Am I going to fail my deadline?",
    "What's the point of all these deadlines",
    "What's due? Also add buy milk",
    "What do you know about me? I'm so tired of this",
    "Is the mind box private?",
    "What does parked mean?",
    "Is 25 minutes of focus enough?",
    "Which day is best to focus?",
    "Is my mood better than last week?",
    "Has my sleep improved since last week?",
  ])("leaves %s to the Coach", (text) => {
    expect(detectFactIntent(text, { config: fixture.config }), text).toBeNull();
  });

  it("ignores long messages", () => {
    expect(detectFactIntent(`what's due ${"and so on ".repeat(30)}?`, { config: fixture.config })).toBeNull();
  });
});

describe("deadlines card", () => {
  it("lists the fronts soonest first with days, date and next move, and flags the key deadline", () => {
    const { text } = ask("What's due this week?");
    expect(text.indexOf("Tax paperwork")).toBeLessThan(text.indexOf("Workshop"));
    expect(text).toContain("- **Tax paperwork**: 2 days overdue (19 Oct). Next move: Find the receipts.");
    expect(text).toContain("- **Workshop**: in 12 days (2 Nov). Next move: Finish the slides.");
    expect(text).toContain("- **Conference talk** (your key deadline): in 20 days (10 Nov).");
    expect(text).toContain("Tasks don't have due dates of their own");
  });

  it("answers about one front when the question names it", () => {
    const { text } = ask("How many days until my workshop?");
    expect(text).toBe("**Workshop**: in 12 days (2 Nov). Next move: Finish the slides.");
  });

  it("answers about the key deadline by its name", () => {
    expect(ask("how many days left for the conference talk?").text).toContain("in 20 days (10 Nov)");
  });

  it("lists only what is overdue, or says nothing is", () => {
    const late = ask("Anything overdue?").text;
    expect(late).toContain("Overdue:");
    expect(late).toContain("Tax paperwork");
    expect(late).not.toContain("Workshop");
    const none = ask("Anything overdue?", { config: { ...fixture.config, fronts: fixture.config.fronts.filter((f) => f.id !== "front-tax") } }).text;
    expect(none).toContain("Nothing is overdue.");
    expect(none).toContain("Next up:");
  });

  it("does not match a front's name inside another word", () => {
    const config = { ...fixture.config, fronts: [...fixture.config.fronts, { id: "front-art", name: "Art", dueAt: "2026-11-30" }] };
    expect(detectFactIntent("how many days left until I start", { config })).toBeNull();
    expect(detectFactIntent("how many days until art", { config })?.frontId).toBe("front-art");
  });

  it("says a named front has no deadline instead of listing the others", () => {
    const config = { ...fixture.config, fronts: [...fixture.config.fronts, { id: "front-gym", name: "Gym" }] };
    expect(ask("when is the gym due?", { config }).text).toBe("**Gym** has no deadline set.");
  });

  it("leaves parked fronts out", () => {
    const config = { ...fixture.config, fronts: fixture.config.fronts.map((f) => (f.id === "front-tax" ? { ...f, parked: true } : f)) };
    const { text } = ask("What's due this week?", { config });
    expect(text).not.toContain("Tax paperwork");
    expect(text).toContain("Workshop");
  });

  it("names the most urgent front", () => {
    expect(ask("Which of my fronts is the most urgent?").text).toMatch(/^Most urgent:\n- \*\*Tax paperwork\*\*/);
  });

  it("says plainly that nothing is due when no front has a date", () => {
    const { text } = ask("What's due this week?", { config: { fronts: [] } });
    expect(text).toContain("None of your fronts has a deadline set");
    expect(text).toContain("tasks don't have due dates of their own");
  });
});

describe("parked and Mind Box cards", () => {
  it("lists every parked task, however long ago it was parked", () => {
    expect(ask("What have I parked?").text).toBe("You have 1 parked task:\n- Learn the new design tool");
  });

  it("says so when nothing is parked, and ignores deleted and finished tasks", () => {
    const tasks = fixture.tasks.map((t) => (t.isParked ? { ...t, isDeleted: true } : t));
    expect(ask("What have I parked?", { tasks }).text).toBe("You have no parked tasks.");
  });

  it("lists every Mind Box thought, newest first", () => {
    const { text } = ask("What's in my mind box?");
    expect(text.startsWith("Your Mind Box has 4 thoughts, newest first:")).toBe(true);
    expect(text.indexOf("Try a new notes app")).toBeLessThan(text.indexOf("Look into standing desks"));
    expect(text).toContain("- Idea: weekly review ritual on Fridays");
    expect(ask("What's in my mind box?", { brainDump: [] }).text).toBe("Your Mind Box is empty.");
  });
});

describe("focus card", () => {
  it("answers the highest-focus-day holdout from recorded minutes", () => {
    const { text, kind } = ask("on which day was my focus time highest");
    expect(kind).toBe("focus");
    expect(text).toContain("Busiest day: Sun 18 (1h30m).");
  });

  it.each(["last 2 weeks", "past two weeks", "last 14 days", "last fortnight"])("reads 14 days of focus for %s", period => {
    const event = (date, minutes) => ({ type: "focus_completed", taskId: "sample", lociDateString: date, focusElapsedSeconds: minutes * 60 });
    const focusRaw = {
      "2026-10-21": { a: event("2026-10-21", 20) },
      "2026-10-08": { b: event("2026-10-08", 40) },
      "2026-10-07": { c: event("2026-10-07", 90) },
    };
    const question = `How long did I focus over the ${period}?`;
    const { text } = ask(question, { focusRaw });
    expect(detectFactIntent(question).focusDays).toBe(14);
    expect(text).toContain("Focus in the last 14 days (8 Oct to 21 Oct): **1h** in 2 sessions on 2 days.");
    expect(text).toContain("Busiest day: Thu 8 (40m).");
    expect(text).not.toContain("1h30m");
  });

  it("gives minutes, sessions, days, the busiest day and the days one by one", () => {
    const { text } = ask("How many focus sessions did I do this week?");
    expect(text).toContain("**4h10m** in 6 sessions on 5 days");
    expect(text).toContain("Busiest day: Sun 18 (1h30m).");
    expect(text).toContain("By day: Thu 15 45m, Sat 17 1h, Sun 18 1h30m, Tue 20 30m, Wed 21 25m.");
  });

  it("answers today and yesterday from the same log", () => {
    expect(ask("how much did I focus today").text).toBe("Focus today: 25m in 1 session.");
    expect(ask("how much did I focus yesterday").text).toBe("Focus yesterday: 30m in 1 session.");
  });

  it("says plainly when nothing is logged in the period asked about", () => {
    expect(ask("Total focus time last week?").text).toMatch(/^No focus sessions are logged in the 7 days before the last 7 days/);
  });

  it("does not guess when the focus log could not be read", () => {
    expect(ask("How long did I focus this week?", { focusRaw: null }).text).toContain("I couldn't read your focus log just now");
  });
});

describe("compare and known cards", () => {
  it("compares tasks finished and focus time with the period before", () => {
    const { text } = ask("Am I doing better than last week?");
    expect(text).toContain("**13** in the last 7 days, **5** in the 7 days before (8 more)");
    expect(text).toContain("Focus time: **4h10m** vs **0m** the 7 days before.");
  });

  it("leaves the focus part out, and says so, when the log could not be read", () => {
    const { text } = ask("Am I doing better than last week?", { focusRaw: null });
    expect(text).toContain("**13**");
    expect(text).toContain("so that part is left out");
  });

  it("lists what is saved about the user, and where to change it", () => {
    const { text } = ask("What do you know about me?");
    expect(text).toContain("Main goal this quarter: run the workshop and finish the slides by Nov 2.");
    expect(text).toContain("Prefers mornings for deep work.");
    expect(text).toContain("Settings › Coach › Coach memory");
    expect(text).not.toMatch(/\b120\b|58\s*%/); // no raw metrics
  });

  it("says so when nothing is saved, or when memory is off", () => {
    expect(ask("What do you know about me?", { config: {} }).text).toContain("I haven't saved anything about you yet");
    expect(ask("What do you know about me?", { config: { coachMemoryEnabled: false } }).text).toContain("switched off");
  });
});

describe("unconfirmed sync", () => {
  it("never states cached data as fact", () => {
    for (const q of ["What's due?", "What have I parked?", "What do you know about me?", "How long did I focus this week?"]) {
      expect(ask(q, { unconfirmed: true }).text, q).toContain("hasn't finished syncing");
    }
  });
});
