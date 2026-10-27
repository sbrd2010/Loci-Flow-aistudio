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
    re: /\bare you (?:digging|looking|snooping|spying) (?:into|on|at) my (?:privacy|data|life|stuff|tasks)\b|\bwho (?:can|could) see my (?:data|tasks|plan|chats?|messages)\b|\bis my (?:data|chat|plan|info\w*) (?:private|safe|secure|shared)\b|\bwhere is my data\b|\bdo you (?:store|save|share|sell|keep) my (?:data|chats?|messages)\b/,
    text: "Your plan is kept in your own Loci account. When you use Coach or another AI feature, the text of your message and the parts of your plan it needs go to the AI provider that answers, through Loci's relay, which passes them on without storing them. Loci doesn't sell your data. The details are in Settings → Privacy policy.",
  },
  {
    // Answered even as a statement ("I want to delete my account"): the model
    // invented "Help → Contact Support" and a support email (#594).
    topic: "account",
    always: true,
    re: /\b(?:delete|close|remove|cancel|deactivate) (?:my |the )?(?:loci )?account\b/,
    text: "Loci has no delete-account button yet. To have your account data deleted, sign out and use the contact under \"Deleting your data\" in Settings → Privacy policy. You can download a backup first in Settings → Data → Backup.",
  },
  // About Loci and the Coach (#594). The model invented "a team of productivity
  // designers", "tasks tied to a concrete deadline" and "I'm not familiar with
  // Loci". Wording approved by the owner, including their name as maker.
  {
    topic: "maker",
    re: /\bwho (?:made|makes|built|builds|created|owns|runs|developed|is behind)\b.{0,15}\bloci\b|\b(?:owner|founder|creator|developer|maker)s? of loci\b|\bloci'?s (?:owner|founder|creator|developer|maker)\b/,
    text: "Loci is made by Rohan Das, an independent developer building it in the open. I don't share personal details about him beyond that, and I can't search the web.",
  },
  {
    topic: "built",
    re: /\bhow (?:was|is) loci (?:made|built|developed|coded)\b|\bvibe[- ]?coded\b|\bis loci (?:any |even |actually |really )*(?:useful|any good|good|worth it)\b/,
    text: "Loci is built by Rohan Das. Whether it's useful depends on you: it's made for people who plan a lot and do too little, or lose track of what matters this week.",
  },
  {
    topic: "compare",
    re: /\b(?:better|different|worse)\b.{0,30}\b(?:todoist|structured|ticktick|notion|google tasks|other (?:apps|planners|to-?do apps))\b|\bloci (?:vs\.?|versus|or) (?:todoist|structured|ticktick|notion)\b|\bwhy (?:would|will|should) i (?:not )?use\b.{0,40}\b(?:loci|structured|todoist)\b/,
    text: "Most task apps are a list of due dates. Loci plans by horizon (Today, This week, This month, This quarter, 6 months), so you see what matters now without losing what comes later. Real deadlines get their own fronts, the Mind Box catches loose thoughts, and the Coach sees your whole plan. Todoist and Structured are good apps; if you live by a calendar, Structured may suit you better. Loci is for deciding what deserves your time.",
  },
  {
    topic: "loci",
    re: /\bhow (?:does|do) loci work\b|\bwhat(?:'s| is) loci(?: for| about)?\s*\??$|\bhow (?:do|can|should) i use loci\b|\bwhat does loci do\b/,
    text: "Loci plans by horizon instead of due dates: every task sits in Today, This week, This month, This quarter or 6 months, so you see what matters now without losing what comes later. Real deadlines get their own fronts, the Mind Box catches loose thoughts so they stop circling, and I, the Coach, see your whole plan, so my advice is about your actual week, not generic tips.",
  },
  {
    topic: "ai",
    re: /\b(?:which|what) (?:ai|model|llm|ai model)\b.{0,15}\b(?:are you|is this|do you use|powers you)\b|\bare you (?:chatgpt|gpt|gemini|claude|an? ai|a bot|a robot|human|a real person)\b|\bh(?:ow|wo) do you (?:work|f\w*tion)\b|\bhow does (?:the )?coach work\b|\bhow can (?:the )?coach help\b|\bwhat can (?:you|the coach) do\b/,
    text: "I'm Loci's Coach, an AI. My replies come from AI models that Loci reaches through its relay (Groq, Ollama Cloud, Google Gemini and a few others). I read your plan and our recent chat to suggest a next step, and anything I offer to change needs your tap on a button. I can't see your screen, search the web, make images or talk by voice.",
  },
  {
    // Answered even phrased as "remember what I say": a question about memory, not a
    // request to save something ("remember that I prefer mornings" stays with the Coach).
    topic: "memory",
    always: true,
    re: /^(?:can you )?remember (?:what i (?:say|tell you|said)|things i (?:say|tell you)|our (?:chats?|conversations?))\b|\bh(?:ow|wo) do you remember\b|\bdo you remember (?:what i say|our (?:chats?|conversations?)|things)\b/,
    text: "With Coach memory on, I keep short notes of things worth remembering, like a preference or a goal. You can see, edit or delete each one in Settings → Coach memory, or switch off \"Remember across chats\". Beyond those notes I see your plan and our recent chat.",
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

// Topics answered whether the message is a question or not.
export const helpAlways = (topic) => !!HELP.find(h => h.topic === topic)?.always;

// The message opens with the topic itself ("delete my account"), so it is the ask,
// not a task about it ("remind me to close my account").
export const helpLeads = (topic, t) => HELP.find(h => h.topic === topic)?.re.exec(t)?.index === 0;

export function helpCardText(topic) {
  return HELP.find(h => h.topic === topic)?.text || null;
}
