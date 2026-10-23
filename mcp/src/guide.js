// The guide a connected AI reads before it judges a plan: how Loci is meant to be
// used, so the review measures the plan against that and not against generic
// productivity advice. Every statement about the app here comes from its own code.

export const LOCI_METHOD = `HOW LOCI PLANS (judge the plan against this)
- Horizons: Today, then This week, This month, This quarter and 6 months. The names, and any extra horizons, are the user's own; "Work · older" is the old Work horizon not yet sorted. A task's horizon says when it should happen.
- Fronts: named pieces of work, each with its own deadline and one next move. A task belongs to a front through its frontId, and with no date of its own it takes the front's. A front's date is what makes a task late.
- Today is the one working list, in the user's own order. One task can be pinned as the one thing to do now (isNowFocus). The Minimum Day ("At least these 3") is up to three of today's tasks that the user confirms each day as the ones to keep even if the day goes wrong; it resets daily, and get_today lists it only once confirmed. A task moved to tomorrow leaves Today and returns on the next day. Parked tasks are set aside on purpose until restored or dropped.
- Time: focus windows set the working day. The Day map lays Today out as a route inside them, in order; a stop that does not end by the end of the day "won't fit". A task's estimate is its minutes. A plan is sound when its minutes fit the focus time left (get_day_map, fit).
- A task's next step should be a concrete first action. The text "Do first tiny step" is only a placeholder, not a step.
- Mind Box holds thoughts that are not tasks yet. Close the day records what was done, moved to tomorrow, planned and dropped, and the first thing for tomorrow.
- Two kinds of "today": the calendar date (deadlines, daily completion counts) and the Loci day (the Today list, completions, the focus log; it runs until the end of a window that passes midnight). The day-based tools (get_overview, get_today, get_day_map, get_plan, get_week, get_stuck, get_focus_history, get_coach_review) return both.`;

// The user's own rules for a good plan. Edit this when they decide them: the three
// questions below are the ones a review most needs answered.
export const OWNER_RULES = `THE USER'S OWN RULES FOR A GOOD PLAN
They have not written these down yet: how many tasks belong on Today, how far an estimate may drift from how long things really take, and how many days a task may sit before it counts as stuck. Until they do, do not invent limits. Report the numbers, say plainly which rule you would need to judge them, and let the user decide.`;

export const HOW_TO_REVIEW = `HOW TO REVIEW
1. Call get_overview, then the page tools you need: get_today, get_day_map, get_plan, get_stuck. For a trend, get_week, get_focus_history and get_coach_review. For loose thoughts, get_mind_box. For what the Coach wrote, get_coach_brief.
2. Start with facts and their numbers: what is planned against the focus time left, what is overdue or due soon (by front and by task), what has sat untouched or parked, how the last days went.
3. Then say where the plan looks off and why, tying each point to the tool result it comes from. Separate "the data shows" from "I infer".
4. Name the deadlines at risk first.
5. Suggest one or two changes the user could make themselves. You cannot change anything in Loci.
6. Say what you could not see or what looked thin. A short plan with little history cannot support a firm verdict.`;

export const REVIEW_GUIDE = [LOCI_METHOD, OWNER_RULES, HOW_TO_REVIEW].join("\n\n");

// The prompt a user can start from (Claude lists it; the same text is available as the
// get_review_guide tool for apps that do not show prompts).
export function reviewPrompt(focus) {
  const ask = focus && focus.trim()
    ? `Review my Loci plan, focusing on: ${focus.trim()}.`
    : "Review my Loci plan: am I planning well, what is stuck, and which deadlines am I at risk of missing?";
  return `${ask}\n\n${REVIEW_GUIDE}`;
}
