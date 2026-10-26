// Questions about Loci itself, answered by the app (#594). The models did not know
// Loci: "a front is the opening slide", "tap the calendar icon to add a deadline",
// "only you can see your data", or "that's outside my scope" for the Mind Box. These
// answers are fixed text that matches the app, so they cannot be wrong, and they cost
// no AI call. Only a plain question about one topic gets one; anything else goes to
// the Coach as before. Keep the text in step with the app's own labels.

const HELP = [
  {
    topic: "front",
    re: /\bwhat(?:'s| is| are)(?: a)? fronts?\b(?! (?:of|in)\b)|\bhow do fronts work\b|\bwhat do you mean by (?:a )?fronts?\b/,
    text: "A front is a named piece of work with its own deadline, like a launch, an exam or a move. Fronts are in the Plan tab, under Fronts: tap New front to add one, and link tasks to it when you add them.",
  },
  {
    topic: "deadline",
    re: /\bhow (?:do|can) i (?:add|set|create|make|put) (?:a |an |my )?(?:deadline|due date)s?\b|\bcan i (?:add|set) (?:a )?(?:deadline|due date)s?\b/,
    text: "Tasks in Loci don't have due dates: each sits in a horizon (Today, This week, This month…). For a real deadline, make a front with a due date: Plan → Fronts → New front. Your one key deadline is set in Settings.",
  },
  {
    topic: "mindbox",
    re: /\bwhat(?:'s| is) (?:the )?(?:mind ?box|brain ?dump)(?: (?:for|used for|about))?\b(?! in\b)|\bhow (?:do i use|does) (?:the )?mind ?box(?: work)?\b/,
    text: "Mind Box is where you dump whatever is on your mind, so it stops circling. When you're ready, Organize with AI sorts those thoughts into tasks, and the Morning ritual helps you start the day.",
  },
  {
    topic: "horizons",
    re: /\bhow do (?:the )?horizons work\b|\bwhat(?:'s| is| are)(?: a)? horizons?\b/,
    text: "Every task sits in one horizon: Today, This week, This month, This quarter or 6 months. Plan things where they belong, and pull a task forward to Today when you're ready to act on it.",
  },
  {
    topic: "focus",
    re: /\bhow (?:do|can) i (?:start|begin|run) (?:a )?focus(?: session| timer)?\b/,
    text: "On Today, make a task your One thing, then tap Start focus to run its timer. You can also ask me to start a focus session on a task, and tap the button I offer.",
  },
  {
    topic: "delete",
    re: /\bhow (?:do|can) i (?:delete|remove) (?:a |this |that )?tasks?\b/,
    text: "Tap the task to open it, then choose Delete; you can undo it right after. I can't delete tasks from chat.",
  },
  {
    topic: "calendar",
    re: /\b(?:sync|connect|link|integrat)\w*\b.{0,40}\bcalendar\b|\bcalendar\b.{0,20}\b(?:sync|integration)\b/,
    text: "No, Loci doesn't sync with Google Calendar or any other calendar. Tasks at a set time show on your Day map, inside Loci.",
  },
  {
    topic: "privacy",
    re: /\bwho (?:can|could) see my (?:data|tasks|plan|chats?|messages)\b|\bis my (?:data|chat|plan|info\w*) (?:private|safe|secure|shared)\b|\bwhere is my data\b|\bdo you (?:store|save|share|sell|keep) my (?:data|chats?|messages)\b/,
    text: "Your plan is kept in your own Loci account. When you use Coach or another AI feature, the text of your message and the parts of your plan it needs go to the AI provider that answers, through Loci's relay, which passes them on without storing them. Loci doesn't sell your data. The details are in Settings → Privacy policy.",
  },
  {
    topic: "others",
    re: /\bother (?:loci )?(?:users|people)(?:'s)?\b.{0,40}\b(?:working on|doing|tasks|plans?|data)\b|\bwhat (?:are|is) (?:other|everyone else)\b/,
    text: "I can only see your own plan. I have no access to anyone else's tasks or data.",
  },
];

// A plain question about one Loci topic, or null. `t` is lower-cased, with straight quotes.
export function detectHelpTopic(t) {
  return HELP.find(h => h.re.test(t))?.topic || null;
}

export function helpCardText(topic) {
  return HELP.find(h => h.topic === topic)?.text || null;
}
