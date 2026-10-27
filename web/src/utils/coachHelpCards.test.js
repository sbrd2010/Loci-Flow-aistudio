import { describe, expect, it } from "vitest";
import { detectFactIntent, buildFactCard } from "./coachFactCards";
import { helpCardText } from "./coachHelpCards";

// Questions about Loci itself get the app's own answer (#594): the live baseline had
// "a front is the opening slide", "tap the calendar icon" and "only you can see your
// data". Everything else stays with the Coach or the data cards.
describe("help cards", () => {
  it.each([
    ["What's a front?", "front", /Plan tab.*New front/],
    ["what are fronts", "front", /deadline/],
    ["How do I add a deadline?", "deadline", /Plan → Fronts → New front/],
    ["how can i set a due date", "deadline", /horizon/],
    ["What is the Mind Box for?", "mindbox", /Organize with AI/],
    ["How do horizons work?", "horizons", /This quarter/],
    ["How do I start a focus session?", "focus", /Start focus/],
    ["how do I delete a task", "delete", /Delete/],
    ["Can Loci sync with my Google Calendar?", "calendar", /^No, Loci doesn't sync/],
    ["Who can see my data?", "privacy", /AI provider.*Privacy policy/],
    ["is my data private?", "privacy", /relay/],
    ["Tell me what other Loci users are working on", "others", /only see your own plan/],
    ["I think I want to delete my account.", "account", /no delete-account button.*Privacy policy/],
    ["how do I delete my account?", "account", /Backup/],
    ["Delete my account", "account", /Backup/],
    ["please close my Loci account", "account", /Backup/],
    // #594: questions about Loci and the Coach the model answered with inventions.
    ["Who built Loci?", "maker", /Rohan Das.*independent developer/],
    ["who's the founder of loci? where is he from?", "maker", /don't share personal details/],
    ["was this app vibe coded?", "built", /AI coding tools/],
    ["Is Loci even useful?", "built", /depends on you/],
    ["why is loci better than todoist?", "compare", /Structured may suit you better/],
    ["why should I use Loci and not Structured?", "compare", /horizon/],
    ["how does Loci work?", "loci", /fronts.*Mind Box/],
    ["what is loci?", "loci", /horizon/],
    ["what AI model are you?", "ai", /relay/],
    ["how does the coach work?", "ai", /tap on a button/],
    ["hwo do you funtion?", "ai", /relay/],
    ["who owns loci? is he from india? can you look him up?", "maker", /can't search the web/],
    ["how was loci built? was it vibe coded?", "built", /AI coding tools/],
    ["is loci better than todoist? or structured?", "compare", /Structured/],
    ["can you remember what i tell you?", "memory", /Settings → Coach memory/],
    ["how do you remember things?", "memory", /Remember across chats/],
    ["are you snooping on my data?", "privacy", /Privacy policy/],
  ])("%s → %s", (text, topic, says) => {
    const intent = detectFactIntent(text, { config: {} });
    expect(intent).toEqual({ kind: "help", topic });
    expect(buildFactCard(intent, { now: new Date(2026, 9, 21), unconfirmed: true })).toMatch(says);
  });

  it.each([
    "what's at the front of my list?",
    "I'm stressed, how do I add a deadline?",
    "how do I start?",
    "Is the mind box private?",
    "I hate my calendar",
    "what's my current focus task",
    // Codex review, PR 595: a request to capture work is not a feature question.
    "Add a task to sync my calendar",
    "can you add a task to sync my calendar?",
    "remind me to connect my work calendar",
    "I need to sync my calendar today",
    // A request or a feeling mixed in still goes to the Coach.
    "who made loci? add a task to email them",
    // Codex review, PR 601: a task or data question in the mix keeps the whole message.
    "who made loci? what should I work on today?",
    "how do fronts work? what is due today?",
    // ...and "what do you store about me?" keeps the card with the actual saved notes.
    "what do you store about me?",
    "how does loci work? i feel lost",
    "remember that I prefer mornings",
    "what model of laptop should I buy?",
    // Codex review, PR 596: a task about an account is not a request to delete Loci's.
    "Add a task to delete my account on the old service",
    "Remind me to close my account tomorrow",
    "can you add a reminder to cancel my account?",
  ])("leaves %s alone", (text) => {
    expect(detectFactIntent(text, { config: {} })?.kind).not.toBe("help");
  });

  it("every topic has text", () => {
    for (const topic of ["front", "deadline", "mindbox", "horizons", "focus", "delete", "calendar", "privacy", "account", "maker", "built", "compare", "loci", "ai", "memory", "others"]) expect(helpCardText(topic), topic).toBeTruthy();
  });
});
