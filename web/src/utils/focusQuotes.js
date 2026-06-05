const CATEGORY_PATTERN = [
  "execution",
  "focus",
  "execution",
  "antiPlanning",
  "execution",
  "focus",
  "execution",
  "focus",
  "execution",
  "antiPlanning",
  "focus",
  "execution",
];

const QUOTE_GROUPS = {
  execution: [
    ["Stay here. This task. This moment.", "Unknown"],
    ["Quiet the mind. Move the hands.", "Unknown"],
    ["Your potential is a debt you owe to yourself.", "Unknown"],
    ["Capability without execution is a tragedy.", "Unknown"],
    ["Do not let your talent become your biggest regret.", "Unknown"],
    ["Lock your eyes on the work at hand.", "Unknown"],
    ["Your mind is a weapon. Direct it now.", "Unknown"],
    ["Trust your talent. Skip the plan. Just begin.", "Unknown"],
    ["You already know enough. Execute.", "Unknown"],
    ["Starve the urge to drift.", "Unknown"],
    ["Do not look away from the target.", "Unknown"],
    ["Be entirely present with this one thing.", "Unknown"],
    ["The only distraction is the one you allow.", "Unknown"],
    ["You have the power. Now do the work.", "Unknown"],
    ["Your potential is real. Prove it with action.", "Unknown"],
    ["Action creates the energy you are waiting for.", "Unknown"],
    ["Finish this, and unlock your true future.", "Unknown"],
    ["You are getting your life back, step by step.", "Unknown"],
    ["Do not die with your music still inside you.", "Wayne Dyer"],
    ["The tragedy of life is what dies inside a man while he lives.", "Albert Schweitzer"],
    ["You control your mind, or it controls you.", "Napoleon Hill"],
    ["Own this minute. The rest will follow.", "Unknown"],
    ["Do it tired. Do it scared. Just execute.", "Unknown"],
    ["Your future self is begging you to execute.", "Unknown"],
    ["Talent is cheap. Execution is priceless.", "Unknown"],
    ["The pain of discipline weighs ounces, regret weighs tons.", "Jim Rohn"],
    ["Wake up. Your potential is bleeding out.", "Unknown"],
    ["Stop wishing. Start forcing the momentum.", "Unknown"],
    ["Rule your mind or it will rule you.", "Horace"],
    ["One step. Move your hands right now.", "Unknown"],
    ["Your mind wanders because you let it.", "Unknown"],
    ["Do the hard task. Free your brain.", "Unknown"],
    ["Action is the ultimate mind control.", "Unknown"],
    ["Build your life. One drop of sweat now.", "Unknown"],
    ["You are stronger than your drifting thoughts.", "Unknown"],
    ["Look forward. Move forward. Execute now.", "Unknown"],
    ["You have delayed enough. Reclaim your day.", "Unknown"],
    ["Prove your genius by finishing this.", "Unknown"],
    ["Unexecuted talent is just a hallucination.", "Unknown"],
    ["No more excuses. Just mechanical execution.", "Unknown"],
    ["The clock is ticking. Be here now.", "Unknown"],
    ["Master this second. Conquer this hour.", "Unknown"],
    ["Your potential demands your focus today.", "Unknown"],
    ["Refuse to let your mind cheat you.", "Unknown"],
    ["Defeat the drift. Execute the task.", "Unknown"],
  ],
  focus: [
    ["He who chases two rabbits catches neither.", "Confucius"],
    ["Put more wood behind fewer arrows.", "Larry Page"],
    ["One single task. Nothing else matters right now.", "Unknown"],
    ["Starve your distractions. Feed your focus.", "Unknown"],
    ["Subtract options. Add execution.", "Unknown"],
    ["Focus is a weapon. Do not blunt it.", "Unknown"],
    ["Saying no to options is the secret to focus.", "Unknown"],
    ["Do not multiply your worries. Focus on this hour.", "Unknown"],
    ["Procrastination is the grave in which opportunity is buried.", "Unknown"],
    ["Later is the prefix to never.", "Unknown"],
    ["The cost of procrastinating is the life you could have lived.", "Unknown"],
    ["A messy start beats a perfect delay.", "Unknown"],
    ["Amateurs wait for inspiration. The rest of us work.", "Chuck Close"],
    ["Procrastination is the thief of time.", "Edward Young"],
    ["While we waste our time hesitating, life goes by.", "Seneca"],
    ["Procrastination makes easy things hard, and hard things harder.", "Mason Cooley"],
    ["Tomorrow is the only day that appeals to a lazy man.", "Jimmy Lyons"],
    ["Concentrate all your thoughts upon the work at hand.", "Alexander Graham Bell"],
    ["You cannot escape tomorrow's responsibility by evading today's.", "Abraham Lincoln"],
    ["Kill the urge to do it later.", "Unknown"],
    ["Focus is a muscle. Flex it now.", "Unknown"],
    ["One single target. Blinders on.", "Unknown"],
    ["Delaying the task doubles the agony.", "Unknown"],
    ["There is only now. Later does not exist.", "Unknown"],
    ["A map is useless if you never march.", "Unknown"],
    ["Cut the noise. Block the world. Focus.", "Unknown"],
    ["The best way out is always through.", "Robert Frost"],
    ["Do not pause. Do not look away.", "Unknown"],
    ["Procrastination is an insult to your talent.", "Unknown"],
    ["Bury the word tomorrow.", "Unknown"],
    ["Your list is bleeding. Stop the procrastination.", "Unknown"],
    ["Eyes down. Task on. No deviations.", "Unknown"],
    ["An unexecuted task steals your peace.", "Unknown"],
    ["Give this task your absolute everything.", "Unknown"],
    ["Procrastination is slow-motion failure. Wake up.", "Unknown"],
    ["One block of time. Direct impact.", "Unknown"],
    ["Immersion beats hesitation every single time.", "Unknown"],
    ["Do not negotiate with your laziness.", "Unknown"],
    ["The focus you avoid is the growth you block.", "Unknown"],
    ["Stay on the line until it's done.", "Unknown"],
  ],
  antiPlanning: [
    ["Less planning. More doing.", "Unknown"],
    ["Ideas are easy. Execution is everything.", "John Doerr"],
    ["Overthinking is a symptom of underacting.", "Adam Grant"],
    ["To think too long about doing destroys doing.", "Samuel Johnson"],
    ["Action expresses priorities.", "Mahatma Gandhi"],
    ["Thinking is easy, acting is difficult.", "Johann Wolfgang von Goethe"],
    ["A good plan violently executed now is better.", "George S. Patton"],
    ["You don't need a system. You need to start.", "Unknown"],
    ["Break the chain of overplanning. Do one thing.", "Unknown"],
    ["Done is better than perfect.", "Sheryl Sandberg"],
    ["Planning is hiding. Action is exposing.", "Unknown"],
    ["Stop tweaking the list. Click start.", "Unknown"],
    ["Your calendar won't save you. Action will.", "Unknown"],
    ["A perfect plan without movement is dead.", "Unknown"],
    ["You cannot think your way into execution.", "Unknown"],
    ["Planning is the comfort zone. Step out.", "Unknown"],
    ["Fewer tasks planned. More tasks crushed.", "Unknown"],
    ["Analysis is paralysis. Just move.", "Unknown"],
    ["Stop designing the road. Start walking.", "Unknown"],
    ["A messy action destroys a flawless plan.", "Unknown"],
  ],
};

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function stableHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export const FOCUS_QUOTE_CATEGORIES = Object.freeze({
  execution: "Execution, Potential, Mind Control",
  focus: "Focus and Anti-Procrastination",
  antiPlanning: "Anti-Overplanning and Analysis Paralysis",
});

export const DAILY_QUOTE_CATEGORY_PATTERN = Object.freeze([...CATEGORY_PATTERN]);

export const FOCUS_QUOTES = Object.freeze(
  Object.entries(QUOTE_GROUPS).flatMap(([category, quotes]) =>
    quotes.map(([text, author], index) => Object.freeze({
      id: `${category}-${String(index + 1).padStart(3, "0")}`,
      quote: text,
      text,
      author,
      category,
      wordCount: wordCount(text),
    }))
  )
);

export function getLocalDayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getTwoHourSlot(date = new Date()) {
  return Math.max(0, Math.min(11, Math.floor(date.getHours() / 2)));
}

export function getQuoteCategoryForSlot(slot) {
  return DAILY_QUOTE_CATEGORY_PATTERN[Math.max(0, Math.min(11, Number(slot) || 0))];
}

function selectQuote({ dayKey, slot, category }) {
  const pool = FOCUS_QUOTES.filter((quote) => quote.category === category);
  if (pool.length === 0) return null;

  const index = stableHash(`${dayKey}:${slot}:${category}`) % pool.length;
  let quote = pool[index];

  if (slot > 0) {
    const previousCategory = getQuoteCategoryForSlot(slot - 1);
    const previous = selectQuote({ dayKey, slot: slot - 1, category: previousCategory });
    if (previous?.id === quote.id) {
      quote = pool[(index + 1) % pool.length];
    }
  }

  return quote;
}

export function getFocusQuoteForSlot(date = new Date()) {
  const slot = getTwoHourSlot(date);
  const category = getQuoteCategoryForSlot(slot);
  return selectQuote({ dayKey: getLocalDayKey(date), slot, category });
}

export function getCurrentFocusQuote() {
  return getFocusQuoteForSlot(new Date());
}

export function getDailyFocusQuotePlan(date = new Date()) {
  const dayKey = getLocalDayKey(date);
  return DAILY_QUOTE_CATEGORY_PATTERN.map((category, slot) => ({
    slot,
    category,
    quote: selectQuote({ dayKey, slot, category }),
  }));
}

export function countQuoteCategories(plan = getDailyFocusQuotePlan()) {
  return plan.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
}
