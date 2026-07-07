const CRISIS_RE = /\b(suicid(?:e|al)|kill(?:ing)? myself|want(?:s|ed)? to die|don['’]?t want to (?:exist|be here|live)|end(?:ing)? (?:it all|my life)|self[-\s]?harm|hurt(?:ing)? myself|might hurt myself|better off (?:dead|without me)|i feel unsafe|can['’]?t do this anymore|done with life)\b/i;

const PANIC_RE = /\b(panic(?:king)?|can['’]?t breathe|chest (?:pain|tight\w*)|heart\w*.{0,15}racing|hyperventilat\w*)\b/i;

const PROFILE_RE = /\b(what do you know about me|what do you remember about me|what have you learned about me|tell me my pattern|why am i like this|tell me about myself)\b/i;

const REMINDER_VERB_RE = /\b(remind me|check in|follow up|circle back|ask me again|ping me)\b/i;
const TIME_SIGNAL_RE = /\b(later|in \d+\s*min\w*|at \d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow(?: morning)?)\b/i;
const STANDALONE_TIME_RE = /\b(in \d+\s*min\w*|tomorrow morning)\b/i;

// "family" excludes a directly-following possessive apostrophe ("family's
// priorities") — unlike "career's"/"work's" (awkward, rarely said), "my
// family's priorities" is a very natural phrase, but it's asking about the
// family's priorities, not the user's own tasks. Without this exclusion,
// the message routes to full_task (the user's visible tasks, no category
// filter, since detectRequestedCategories separately excludes third-party
// possessives and returns [] here) and can get answered from the user's own
// Loci tasks instead of being treated as a non-task/third-party ask (Codex
// review finding).
const BROAD_TASK_QUERY_RE = /\b(what are my tasks|what['’]?s due|what is due|anything due|due date|what['’]?s my deadline|what is my deadline|show my tasks|what do i have today|what tasks do i have|list my tasks|my task list|show my list|what['’]?s on my list|what do i need to do today|check (?:my |the )?(?:today['’]?s|this week['’]?s?|week) (?:focus|horizon)|check (?:this|my) week horizon|check today['’]?s focus|today['’]?s?\s+focus|what['’]?s?\s+my\s+focus\b|my\s+focus\s+for\s+today|today['’]?s?\s+priorit(?:y|ies)|(?:what are|tell me|show me|check|what about) my(?:\s+(?:this\s+|(?:\d+|six)\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family(?!['’]s)|month|quarter)s?['’]?s?(?:\s*(?:and|&|\/|,)\s*(?:this\s+|(?:\d+|six)\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family(?!['’]s)|month|quarter)s?['’]?s?){0,2})?\s*priorit(?:y|ies)|what should be my priority|which priority should i focus on|can['’]?t you check|check my week|(?:what['’]?s|what is|anything)\s+(?:actually |really )?(?:urgent|pressing|critical|important)\b|(?:what['’]?s|what is)(?: next)? on my plate(?: today)?|(?:what['’]?s|what is) in my brain dump|check my brain dump|what do i even do|what['’]?s there to do|what to do (?:right now|today|now)\b)\b/i;

// Real users type messy — texting shorthand, dropped apostrophes, common
// abbreviations — and every regex above only recognizes clean English
// phrasing. Rather than hand-tuning every regex for every possible typo
// (a losing battle), normalize a small set of very common, low-risk
// shorthand tokens to their canonical form before classification. This never
// touches the message actually sent to the LLM or stored in chat history —
// it only affects which context mode the classifier picks.
const SHORTHAND_MAP = [
  [/\bwut\b/gi, "what"],
  [/\bwat\b/gi, "what"],
  [/\bshud\b/gi, "should"],
  [/\brn\b/gi, "right now"],
  [/\bu\b/gi, "you"],
  [/\bur\b/gi, "your"],
  [/\br\b/gi, "are"],
  // Never rewrite a digit that's actually a clock time, duration, or a
  // priority-scope count (e.g. "in 2 minutes", "at 2 pm", "my 2 work
  // priorities") — TIME_SIGNAL_RE/STANDALONE_TIME_RE and BROAD_TASK_QUERY_RE's
  // "(?:\d+|six)\s+(?:career|work|...)" branch elsewhere in this file need the
  // literal digit. The lookbehind guards "at N", the lookahead guards
  // "N <unit>"/"N am|pm"/"N <category>".
  // The category-word exclusion is only a real "count" (not "2" meaning
  // "to") when it follows "my" ("my 2 work priorities") — without requiring
  // that, adding job/office/fitness/wellness/gym/home/family to this list
  // broke ordinary "to <verb>" shorthand before those words ("remind me 2
  // job hunt"/"remind me 2 fitness class" never normalized to "remind me to
  // ...", so with no time signal the message fell to "light" instead of
  // reaching the ADD_TASK path). Duration/time-unit words stay
  // unconditionally excluded regardless of a preceding "my" (Codex review
  // finding, mirrors the equivalent "4"->"for" fix below).
  [/(?<!\bat\s)(?:(?<!\bmy\s)\b2\b(?=\s*(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\b2\b(?!\s*(?:min(?:ute)?s?|hours?|hrs?|am|pm|months?|quarters?|career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b))/gi, "to"],
  // The category-word exclusion here is only a real "count" (not "4" meaning
  // "for") when it follows "my" ("my 4 work priorities") — without requiring
  // that, adding job/office/fitness/wellness/gym/home/family to this list
  // broke ordinary "for <category>" shorthand ("what should i tackle 4
  // fitness" never normalized to "...for fitness", so the category-filter
  // regexes elsewhere in this file — which only recognize the literal word
  // "for" — never fired). Duration/time-unit words stay unconditionally
  // excluded regardless of a preceding "my" ("in 4 months" must not become
  // "in for months") (Codex review finding).
  [/(?<!\bat\s)(?:(?<!\bmy\s)\b4\b(?=\s*(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\b4\b(?!\s*(?:min(?:ute)?s?|hours?|hrs?|am|pm|months?|quarters?|career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b))/gi, "for"],
  [/\bb4\b/gi, "before"],
  [/\bdis\b/gi, "this"],
  [/\bdat\b/gi, "that"],
  [/\bkno\b/gi, "know"],
  [/\bsumthing\b/gi, "something"],
  [/\bsumthin\b/gi, "something"],
  [/\bgimme\b/gi, "give me"],
  [/\bwanna\b/gi, "want to"],
  [/\bgonna\b/gi, "going to"],
  [/\bgotta\b/gi, "got to"],
  // "i dont know" (not "i do not know") so this still matches EMOTIONAL_RE's
  // existing don['’]?t know where to start pattern — "idk where to start" is
  // a very common real-world distress phrasing that should route the same
  // way its unabbreviated form already does.
  [/\bidk\b/gi, "i dont know"],
  [/\bive\b/gi, "i have"],
  // Dropped-apostrophe "im" (extremely common when typing fast) doesn't match
  // any of this file's many "i(['’]m| am) ..." patterns (overwhelmed, stuck,
  // stressed, anxious, frustrated, etc.) — normalize it to "i am" so those
  // patterns work exactly as they already do for "i'm"/"i am".
  [/\bim\b/gi, "i am"],
  [/\btodos\b/gi, "tasks"],
  [/\btodo\b/gi, "task"],
  // Common misspellings of "what" (with the contraction still attached) and
  // "which" — "wat"/"wut" alone are already covered above, but "wats"/"wuts"
  // is a distinct token that needs its own rule.
  [/\bwats\b/gi, "what's"],
  [/\bwuts\b/gi, "what's"],
  [/\bwich\b/gi, "which"],
  // Common misspellings of "priority"/"priorities"/"prioritize" — these were
  // silently falling through BROAD_TASK_QUERY_RE's exact "priorit(y|ies)"
  // spelling requirement. The stem-only rule (no trailing \b) lets the real
  // suffix (e/ing/ed) survive untouched, e.g. "priortize" -> "prioritize".
  [/\bpriorites\b/gi, "priorities"],
  [/\bpriorty\b/gi, "priority"],
  [/\bpriortiz/gi, "prioritiz"],
  [/\bimportent\b/gi, "important"],
  [/\bdoin\b/gi, "doing"],
  [/\bconfuzed\b/gi, "confused"],
  [/\bnxt\b/gi, "next"],
  [/\bstrt\b/gi, "start"],
  [/\bfst\b/gi, "first"],
  [/\bhlp\b/gi, "help"],
  [/\bsum\b/gi, "some"],
  [/\bcn\b/gi, "can"],
  [/\bb\b/gi, "be"],
  [/\b2day\b/gi, "today"],
  [/\b2nite\b/gi, "tonight"],
  [/\b2moro(?:w)?\b/gi, "tomorrow"],
];

// Exported so coachActions.js's intent-pattern matching (messageSeemsActionLike)
// can normalize the same way — otherwise a message that reaches full_task
// via this normalization (e.g. "remind me 2 call the plumber") could still
// have its resulting action tag blocked by the gate, which would otherwise
// see the raw, un-normalized text ("2" instead of "to").
// Also applies the compound-category rewrite (see COMPOUND_CATEGORY_PHRASES
// below) — it previously only ran inside detectRequestedCategories, so
// classifyContextMode still evaluated the raw "job search"/"work from home"
// text and BROAD_TASK_QUERY_RE (which requires a single bare category word
// immediately before "priorities", not an extra word like "search"/"from
// home" in between) never matched, leaving broad asks like "what are my job
// search priorities" at "light" even though detectRequestedCategories
// separately resolved a category for them (Codex review finding).
export function normalizeForClassification(text) {
  return rewriteCompoundCategoryPhrases(SHORTHAND_MAP.reduce((acc, [re, replacement]) => acc.replace(re, replacement), text));
}

function isCheckinRequest(text) {
  return (REMINDER_VERB_RE.test(text) && TIME_SIGNAL_RE.test(text)) || STANDALONE_TIME_RE.test(text);
}

const TASK_RE = /\b(plan(?:ning)? (?:my|the|today)|prioriti[sz]e|deadline|schedule|agenda|now focus|set now focus|pin now focus|what should i do|what do i have to do|what are my tasks|what should i work on|help me choose|next step|add (?:this |that )?task|add (?:it )?to (?:my|the|today['’]?s) list|add\b.{1,50}\bto (?:my|the) list|create (?:a )?task|capture this|put (?:this|it) in (?:my|the) tasks|mark\b.{1,50}\bdone\b|mark (?:it |this )?done|completed|finished|complete this|i(['’]m| am) done with (?:this|that|it)?\s*task|i(['’]m| am) done with .{1,50}\btask|(?:done with|finished)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|delete (?:this|that) task|undo|park (?:this|that)|defer (?:this|that)|(?:park|defer)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|move (?:this|it) to (?:today|week|month|quarter|6 months|work)|start (?:a )?timer|start (?:a\s+|current\s+|now\s+)?focus|focus session|overdue|(?:what['’]?s|what is|anything) due|due (?:today|tomorrow|this week|date)|tasks?|my list|on my list|parked|what did i park|should i start|which task should i start)\b/i;

const EMOTIONAL_RE = /\b(comfort me|i feel (?:terrible|awful|horrible|useless|down|bad|sad|low|hopeless)|i feel like (?:such a |a total |a real |a complete |a )failure\b|i hate this|i failed|i(?:['’]ve| have)? wasted (?:the|my)(?:\s+\w+){0,2}\s+day|i(['’]m| am) overwhelmed|too many things|don['’]?t know where to start|don['’]?t push (?:tasks|me)|i(['’]m| am) stuck|can['’]?t (?:start|focus)|i(['’]m| am) stressed|i(['’]m| am) anxious|fight with|my family is stressing me|i need rest|i just want to (?:play games|rest)|i did it|small win|i(['’]m| am) frustrated|i can['’]?t work|done with everything)\b/i;

const FRESH_SCAN_RE = /\b(scan (everything|all|my list|all my tasks|my whole list) again|re-plan|look at (everything|all my tasks) again|fresh scan|full scan|check all my tasks|review my whole list|re-plan from my full list|look at all my tasks|scan all my tasks)\b/i;

const COMPACT_FOLLOWUP_RE = /\b(key point|one sentence|10[-\s]?min(?:ute)?s?\s*version|make it smaller|shorter|how do i start|make this easier|concrete steps|turn (?:that|this|it) into .{0,30}steps|what should i do next|set that|do next|tell me more|what did you mean|how do i do that|which one|why\??|explain that|elaborate|clarify)\b/i;

// "want to focus on"/"dive into"/"jump into"/"time to work on" exclude a
// preceding question word, mirroring the "switch/set/swap focus" guard
// above — without it, "what should I dive into in Madrid?" (an unrelated
// travel question sharing TASK_ASK_RE's already-bounded "dive into" verb)
// unconditionally matched here and skipped TASK_ASK_RE's lookahead entirely,
// a regression introduced when merging #340's TASK_ASK_RE bounding work with
// #342's unconstrained EXPLICIT_ACTION_RE synonym additions.
// "i'm done <gerund>" excludes a small denylist of non-task gerunds
// (stressing/thinking/worrying/talking/dealing/freaking/panicking about
// something) — without it, "I'm done stressing about the report" or "I'm
// done thinking about the report" routed to full_task and removed the
// previous barrier that kept such emotional/reflective phrasing away from
// coachActions.js's COMPLETE_TASK gate, which could then accept a
// hallucinated completion tag for "report" (Codex review finding). Not
// exhaustive — a known, accepted residual gap for gerunds outside this list.
const EXPLICIT_ACTION_RE = /\b(add (?:this|that)?\s*task|add\b.{1,50}\bto (?:my |the )?(?:today['’]?s?\s+)?list|add\b.{1,50}\bto (?:today|week|month|quarter|work)|create (?:a )?task|capture this|put (?:this|it) in (?:my|the)?\s*tasks|mark\b.*\bdone|mark (?:it|this)? done|done with (?:this|that|it)?\s*task|done with .{1,50}\btask|(?:done with|finished)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|complete this|delete (?:this|that) task|park (?:this|that|it|task)\b|park\s+.{1,50}\btask|defer (?:this|that|it|task)\b|defer\s+.{1,50}\btask|(?:park|defer)\s+(?!life\b|everything\b)[a-z0-9\s'’\"_-]{2,50}|move (?:this|it) to|start (?:a )?timer|start (?:a\s+|current\s+|now\s+)?focus|focus session|(?<!\b(?:what|how|why|would|could|should)\b.{0,20})(?:switch|set|swap)\s+(?:my\s+|the\s+)?focus\s+(?:to|on)|(?<!\b(?:what|how|why|would|could|should)\b.{0,20})make\s+.{1,40}\s+my focus\b|remind me (?:to|that|i)\b|don['’]?t forget\b|wrapped? up|knocked out|crossed\s+.{1,50}\boff\b|jot(?:ted)? down|note(?:d)? down|need to remember (?:to|that)|(?<!\b(?:what|which|how|why|would|could|should)\b.{0,20})(?:want to focus on|dive into|jump into|time to work on)|put off|postpone|shelve|i(?:['’]m| am) done (?!stressing|thinking|worrying|talking|dealing|freaking|panicking)\w+ing\b)\b/i;

// Body-double session requests ("be my body double", "sit with me while I
// work", "stay with me") read as task/focus requests even when they don't
// use "start"/"focus"/"timer" wording — route them to full_task so the
// coach has task context to confirm and the COACH ACTIONS block to start a
// session via START_FOCUS.
const BODY_DOUBLE_RE = /\b(body[\s-]?double|sit with me|stay with me|work (?:alongside|next to) me|keep me company while i work)\b/i;

// Fear/distress phrasing ("I'm scared, stay with me") can overlap with
// BODY_DOUBLE_RE's "stay with me" wording but is emotional support, not a
// work-session request — route it to "emotional" instead of "full_task".
const FEAR_DISTRESS_RE = /\b(i(['’]m| am) (?:scared|afraid|terrified|frightened)|don['’]?t leave me)\b/i;

// "handle"/"deal with"/"nail" are common task verbs but also ordinary verbs
// in unrelated domains ("what should I handle carefully in this recipe?",
// "what should I nail to the wall?") — require the verb to be followed only
// by a short, task-shaped continuation (or nothing) rather than matching
// regardless of trailing content, so an unrelated question with substantial
// text after the verb doesn't false-positive into full_task. "get to" was
// removed entirely — too generic/ambiguous ("get to eat", "get to know") to
// safely pattern-match at all (Codex review finding).
// "do"/"work on"/"start"/"focus on" are the original, long-standing verb set
// here and stay unconstrained (pre-existing accepted risk, not part of this
// PR's changes). Every verb added by this PR — including "handle"/"deal
// with"/"nail" from the previous review round — requires being followed
// only by a short task-shaped continuation (or nothing), since Codex found
// the fix only covered three of the newly-added verbs: "what should I be
// doing about this rash?" and "what should I dive into in Madrid?" still
// false-positived into full_task via the unconstrained ones.
// "which one/task should I do/tackle/handle" mirrors the "what should I
// <verb>" shape above and needs the same end-of-clause/task-scope
// lookahead — without it, "which one should I handle carefully in this
// recipe?" and "which one should I do in this recipe?" false-positive into
// full_task on their unrelated trailing clause (Codex review finding,
// two rounds — the "do" alternative was still unconstrained even after
// "tackle"/"handle" were bounded).
const TASK_ASK_RE = /\b(what should i (?:actually |really |just |honestly )?(?:do|work on|start|focus on)|what should i (?:actually |really |just |honestly )?(?:tackle|handle|knock out|deal with|nail|dive into|jump into|be doing|be working on|be spending(?: my)? time on|spend(?: my)? time on)(?=\s*(?:first|next|today|now|right now|this (?:week|month|quarter))?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|which (?:one|task) shall i focus|which (?:one|task) should i (?:start|do|tackle|handle)(?=\s*(?:first|next|today|now|right now|this (?:week|month|quarter))?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|shall i focus|help me (?:choose|pick|prioritize|plan)|choose a task|pick a task|pick one (?:thing|task)|next step|prioritize my|plan my|plan today)\b/i;

// Broader "what's my priority/focus" noun-phrase asks — these name a
// priority without any of TASK_ASK_RE's "what should I <verb>" phrasing at
// all, so a purely verb-based pattern can never catch them.
// "important"/"urgent"/"pressing"/"critical" stand alone as priority
// descriptors even without a following noun ("what's important" is already
// a priority question). "top"/"main"/"biggest" don't — they're relative
// modifiers that need an object to mean anything task-related, so without
// requiring the noun, "what's the top speed of a cheetah?" or "what's the
// main idea here?" would false-positive into full_task (Codex review finding).
// Bare "next"/"pending"/"coming up" (unlike the "on my/the <noun>" shapes,
// which are already scoped by the possessive framing) need an end-of-clause
// lookahead — otherwise "what's next in this recipe?" false-positives
// (Codex review finding). "one thing I should <verb>" needs the same
// treatment ("what's the one thing I should do before taking aspirin?"),
// and "number one <noun>" additionally needs a leading "my" — otherwise it
// matches ANY mention of "number one thing" regardless of whose priority is
// being discussed, e.g. "the number one thing to see in Rome" (Codex review
// finding). Direction-seeking catch-alls ("point me to", "steer me toward",
// "orient me to") are scoped to known-safe complete phrasings only — the
// open-ended "toward/to <anything>" forms matched ordinary navigation
// requests like "point me to the settings page" or "steer me toward the
// nearest clinic" (Codex review finding).
// "what needs my attention"/"what's on my radar/deck/plate/agenda/horizon"/
// "walk me through what matters" need an end-of-clause-or-category lookahead
// — without one, "what needs my attention in this recipe?", "what's on my
// radar in chess?", and "walk me through what matters in this codebase"
// false-positive into full_task on their unrelated trailing clause. The
// lookahead also accepts "for <category>" so FOCUS_FOR_CLAUSE_RE's matching
// lead-ins ("needs my attention for work") keep working (Codex review finding).
// "what's important/urgent/pressing/critical...", "what deserves my
// attention/energy", and "what do I have going on" need the same
// end-of-clause-or-category lookahead as the other aliases here — without
// one, "what is the important thing about CSS?", "what deserves my
// attention in this recipe?", and "what do I have going on in my stomach?"
// false-positive into full_task on their unrelated trailing clause. "my
// number one <noun>" also needs to accept a trailing "today"/"right now",
// like its neighboring priority phrases — without it, "what's my number one
// priority today?" fell back to "light" instead of "full_task" (Codex
// review finding).
const PRIORITY_SYNONYM_RE = /\bwhat(?:['’]?s|\s+is) (?:my |the )?(?:most )?(?:important|urgent|pressing|critical)(?: (?:thing|priority|task|focus))?(?=\s*(?:(?:today|right now)?\s*(?:[.?!]|$)|for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b))|\bwhat(?:['’]?s|\s+is) (?:my |the )?(?:top|main|biggest) (?:thing|priority|task|focus)\b|\bwhat needs my attention(?=\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat needs (?:doing|to be done)(?=\s*(?:today|now)?\s*(?:[.?!]|$))|\bwhat deserves my (?:attention|energy)(?=\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat(?:['’]?s|\s+is) (?:on (?:my |the )?(?:deck|radar|plate|agenda|horizon))(?=\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat(?:['’]?s|\s+is) (?:next|pending|coming up)(?=\s*(?:today|this week|this month)?\s*(?:[.?!]|$))|\bwhat do i have going on(?=\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bgive me (?:some |a bit of )?(?:my priorities|the game plan)\b|\bgive me (?:some |a bit of )?(?:clarity|direction)(?=\s*(?:[.?!]|$))|\b(?:long|short) term priorities\b|\b(?:immediate|future) priorities\b|\bpriorit(?:y|ies) for the (?:day|week|month|quarter|year)\b|\bthis (?:week|month|quarter|year)['’]?s? focus\b|\bwhat(?:['’]?s|\s+is) the smart move(?=\s*(?:today|right now)?\s*(?:[.?!]|$))|\bwhat(?:['’]?s|\s+is) my north star\b|\bwhat(?:['’]?s|\s+is) the one thing i should (?:nail|do|focus on)(?=\s*(?:today|now)?\s*(?:[.?!]|$))|\bmy number one (?:focus|priority|thing)(?=\s*(?:today|right now)?\s*(?:[.?!]|$))|\bpoint me in the right direction\b|\bsteer me toward (?:something useful|what matters|the right (?:thing|direction|task))\b|\borient me\b(?=\s*(?:for the day)?\s*(?:[.?!]|$))|\bwalk me through what matters(?=\s*(?:[.?!]|$))\b/i;

// Antonym/negation priority asks ("what can wait", "what's not urgent") —
// these are just as much a priority question as their positive-phrased
// counterparts, but neither TASK_ASK_RE nor PRIORITY_SYNONYM_RE's
// affirmative wording matches a negated one.
// "what should i not do" and "what can i skip/ignore/put off" need an
// end-of-clause lookahead — without one, "what should I not do if I see a
// bear?" and "what can I ignore in this recipe?" false-positive into
// full_task on their unrelated trailing clause (Codex review finding).
// "what's not/the least/lowest/low important..." and "what has the lowest
// priority" need the same end-of-clause lookahead as the other aliases here
// — without one, "what's not important in JavaScript?", "what's the least
// important thing about this movie?", and "what has the lowest priority in
// CSS?" false-positive into full_task on their unrelated trailing clause
// (Codex review finding).
// Several aliases here are category/horizon-filtered priority questions in
// their own right ("what can wait for work?", "what's not urgent for
// health?"), so their lookaheads also accept "for <category>" — without it,
// these stayed "light" instead of "full_task" (Codex review finding). The
// final "not due soon/going to hurt if I skip it" alternative also needs the
// same end-of-clause guard as its siblings — without one, "what's not due
// soon in JavaScript?" false-positived into full_task (Codex review finding).
const NEGATION_PRIORITY_RE = /\bwhat should i not do(?=\s*(?:today|now|right now)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat can wait(?=\s*(?:today|for now)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat can i (?:skip|ignore|put off)(?=\s*(?:today|for now|right now)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat(?:['’]?s|\s+is) (?:not |the least |least |lowest |low )(?:important|urgent|pressing|critical|priority)(?=\s*(?:thing|priority|task|focus)?\s*(?:(?:today|right now)?\s*(?:[.?!]|$)|for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b))|\bwhat don['’]?t i need to worry about(?=\s*(?:today|right now)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat(?:['’]?s|\s+is) optional(?=\s*(?:today)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat has the lowest priority(?=\s*(?:today|right now)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat am i free to skip(?=\s*(?:today|right now)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat shouldn['’]?t i worry about(?=\s*(?:today|right now)?\s*(?:[.?!]|$)|\s+for\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b)|\bwhat(?:['’]?s|\s+is) not (?:due soon|going to hurt if i skip it)(?=\s*(?:[.?!]|$))\b/i;

// Low-energy asks need the full visible task list with estimates so the
// coach can prefer the smallest task per the PRIORITY QUESTIONS rule — the
// compact_task prompt doesn't carry that context, so these always route to
// full_task even on the paced/compact-follow-up path.
const LOW_ENERGY_RE = /\b(low energy|no energy|low on energy|out of energy|exhausted|burnt out|burned out|running on empty|drained|too tired)\b/i;

// Category-filtered ("which work task should I do first?") or
// horizon-filtered ("what should I focus on this month?") priority questions
// need the PRIORITY QUESTIONS framework and {Category} tags that only the
// full_task prompt carries — never compact these, even on the paced path.
// Extended to include TASK_ASK_RE's newer verb set (tackle, handle, knock
// out, deal with, nail, dive into, jump into, be doing, be working on, be
// spending time on, spend time on) and PRIORITY_SYNONYM_RE's newer alias
// lead-ins, both for the "for <category>" shape and the "this
// week/month/quarter" horizon shape — without this, "what should I tackle
// for work?" or "what should I dive into this quarter?" matched TASK_ASK_RE
// but not PRIORITY_FILTER_RE, so on the paced/compact-follow-up path
// classifyContextMode() returned "compact_task" (whose prompt only carries
// the last plan/current focus, not the full task list) instead of
// "full_task" for these category/horizon-filtered priority questions
// (Codex review finding).
const PRIORITY_FILTER_RE = /\bwhich\s+(?:of\s+my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\s+tasks?\b|\b(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\s+(?:task|priorit\w*)\s+(?:should|to)\b|\b(?:focus on|tackle|handle|knock out|deal with|nail|dive into|jump into|be doing|be working on|be spending(?: my)? time on|spend(?: my)? time on)\s+this\s+(?:month|quarter|week)\b|\b(?:focus on|priorit\w*|do|work on|start|tackle|handle|knock out|deal with|nail|dive into|jump into|be doing|be working on|be spending(?: my)? time on|spend(?: my)? time on|needs my attention|on (?:my |the )?(?:deck|radar|plate|agenda|horizon)|(?:the )?game plan)\b[^.?!]{0,30}\bfor\s+(?:my\s+)?(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b|\b(?:show me|what are|list|check|tell me)\s+my\s+(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\s+tasks?\b|\bwhat\s+(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\s+tasks?\b/i;

// job/office -> Work, fitness/wellness/gym -> Health, home/family -> Personal:
// common synonyms for the app's four category tags, so a message naming one
// of these (e.g. "what are my job priorities") still resolves to the actual
// tag a task would carry, instead of being invisible to category detection.
const CATEGORY_LABELS = {
  career: "Career",
  work: "Work",
  health: "Health",
  personal: "Personal",
  job: "Work",
  office: "Work",
  fitness: "Health",
  wellness: "Health",
  gym: "Health",
  home: "Personal",
  family: "Personal",
};

// Mirrors PRIORITY_FILTER_RE's category-question shapes (not its horizon
// shape — "focus on this month" isn't a {Category} filter) but captures
// which specific category was named, instead of just testing for a match.
// Used to build a deterministic "no visible tasks in that category" context
// note (see buildLociCategoryFilterContext) — the system prompt's own
// PRIORITY QUESTIONS rule already tells the model to disclose a category
// mismatch, but relying on the model to notice via the {Category} tags alone
// isn't reliable enough on its own; see issue #338.
// These shapes only ever name a single category.
const SINGLE_CATEGORY_PATTERNS = [
  // Excludes "add a work task to ...", "create a high priority health task
  // to ..." — those are ADD_TASK commands, not a category-filtered priority
  // ask, even though they share the "<category> task ... to" shape. The
  // window is wide enough to span a few filler words between the verb and
  // the category.
  /(?<!\b(?:add|create|make)\b.{0,40})\b(career|work|health|personal|job|office|fitness|wellness|gym|home|family)\s+(?:task|priorit\w*)\s+(?:should|to)\b/i,
  // "Show me/what are/list my <category> tasks" — a category-scoped
  // task-list ask, distinct from the "priorities" clause below.
  /\b(?:show me|what are|list|check|tell me)\s+my\s+(career|work|health|personal|job|office|fitness|wellness|gym|home|family)\s+tasks?\b/i,
  // "What work tasks do I have?" — category named directly before "task(s)",
  // without "are/my" the pattern above requires.
  /\bwhat\s+(career|work|health|personal|job|office|fitness|wellness|gym|home|family)\s+tasks?\b/i,
];

// Mirrors the "which <category> task(s)" shape, but — like the other clauses
// below — captures the whole trailing clause instead of a single category,
// so "which work task and health task should I do first?" finds both
// instead of stopping at the first "task".
const WHICH_TASK_CLAUSE_RE = /\bwhich\s+(?:of\s+my\s+)?([a-z0-9\s&/,'’]{1,60}?)\b(?=\s+(?:should|shall|is|are|do|does|can|will|to)\b|[.?!]|$)/i;

// Mirrors BROAD_TASK_QUERY_RE's own "what are/tell me/show me my <category>
// priorities" shape, but — unlike BROAD_TASK_QUERY_RE, which only needs to
// know THAT a category was named — this needs to know WHICH one(s), and that
// shape can name up to three ("my health and work priorities", "my health/
// work priorities") or include a leading count/scope qualifier ("my 2 work
// priorities", "my six work priorities"). Rather than replicate that exact
// compound grammar, capture the whole "my ... priorities" clause (bounded to
// a sane length so it can't run across an unrelated later "priorities" in a
// long message) and scan it for every category word inside.
const CATEGORY_PRIORITY_CLAUSE_RE = /(?:what are|tell me|show me|check|what about)\s+my\s+([a-z0-9\s&/,'’]{1,60}?)\s*priorit(?:y|ies)\b/i;
// Mirrors the "focus on/prioritize ... for <category>" shape, but — like
// CATEGORY_PRIORITY_CLAUSE_RE above — captures the whole trailing clause
// instead of a single category, so "prioritize for health and work" finds
// both instead of only the first. Also covers PRIORITY_SYNONYM_RE's newer
// alias lead-ins ("needs my attention for work", "on my radar for health",
// "the game plan for work") — those route to full_task fine on their own,
// but without a matching category-detection shape, a missing-category
// mismatch note never fires for them (Codex review finding).
// Also covers TASK_ASK_RE's newer verb set ("tackle", "handle", "knock out",
// "deal with", "nail", "dive into", "jump into", "be doing", "be working
// on", "be spending time on", "spend time on") — those route to full_task
// fine on their own via "for <category>", but without a matching
// category-detection lead-in here, a missing-category mismatch note never
// fires for "what should I tackle for work?" (Codex review finding).
// Also covers PRIORITY_SYNONYM_RE's priority-noun/adjective lead-ins ("top",
// "main", "biggest", "important", "urgent", "pressing", "critical",
// "deserves my attention") — those route to full_task fine on their own via
// "for <category>", but without a matching lead-in here, "what's my main
// focus for health?", "what's the top thing for work?", and "what deserves
// my attention for work?" never got a missing-category mismatch note
// (Codex review finding).
const FOCUS_FOR_CLAUSE_RE = /\b(?:focus on|priorit\w*|do|work on|start|tackle|handle|knock out|deal with|nail|dive into|jump into|be doing|be working on|be spending(?: my)? time on|spend(?: my)? time on|needs my attention|deserves my (?:attention|energy)|on (?:my |the )?(?:deck|radar|plate|agenda|horizon)|(?:the )?game plan|top|main|biggest|important|urgent|pressing|critical)\b[^.?!]{0,30}\bfor\s+(?:my\s+)?([a-z0-9\s&/,'’]{1,40})/i;
const CATEGORY_WORD_RE = /\b(?:career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b/gi;
// A possessive like "boss's" or "manager's" inside the captured clause means
// the "my" in "my boss's work priorities" scopes to the boss, not the user —
// these are someone else's priorities, not a category the user is asking
// about for themselves.
const THIRD_PARTY_POSSESSIVE_RE = /\w['’]s\b/;
// "for work, not personal" names Personal only to exclude it, not to ask
// about it — strip any category immediately preceded by "not" before
// treating the rest of the clause as requested categories.
const NEGATED_CATEGORY_RE = /\bnot\s+(career|work|health|personal|job|office|fitness|wellness|gym|home|family)\b/gi;

// Compound phrases where a bare category-word synonym inside them means a
// different category than it does on its own — "job search"/"job
// application(s)" is Career, not Work (the app's own category guidance puts
// job-hunting under Career; see MindBoxTab.jsx), "family doctor"/"doctor's
// office" is Health, not Personal/Work (medical admin), and "home" in "work
// from home" is part of a Work phrase, not a separate Personal category
// request. Rewritten to a single canonical category word before any
// category-detection pattern runs, so every detection path (not just the
// clause-scanning one) sees the phrase's true category and its component
// word isn't also separately counted (Codex review finding).
const COMPOUND_CATEGORY_PHRASES = [
  [/\bjob\s+search(?:ing)?\b/gi, "career"],
  [/\bjob\s+application(?:s)?\b/gi, "career"],
  [/\bjob\s+interview(?:s)?\b/gi, "career"],
  [/\bfamily\s+doctor\b/gi, "health"],
  [/\bdoctor[’']?s?\s+office\b/gi, "health"],
  [/\bdentist[’']?s?\s+office\b/gi, "health"],
  [/\bhome\s+workout(?:s)?\b/gi, "health"],
  [/\bpost\s+office\b/gi, "personal"],
  [/\bwork(?:ing)?\s+from\s+home\b/gi, "work"],
];

function rewriteCompoundCategoryPhrases(text) {
  return COMPOUND_CATEGORY_PHRASES.reduce((acc, [re, replacement]) => acc.replace(re, replacement), text);
}

// Scans a captured clause (e.g. "health and work", "boss's work") for every
// category word inside, in the order first mentioned, deduped, excluding
// any explicitly negated with "not <category>".
function extractCategoryLabels(clause) {
  const excluded = new Set();
  let negatedMatch;
  NEGATED_CATEGORY_RE.lastIndex = 0;
  while ((negatedMatch = NEGATED_CATEGORY_RE.exec(clause))) {
    excluded.add(negatedMatch[1].toLowerCase());
  }
  const words = (clause.match(CATEGORY_WORD_RE) || []).filter(w => !excluded.has(w.toLowerCase()));
  return [...new Set(words.map(w => CATEGORY_LABELS[w.toLowerCase()]))];
}

// Returns every category (Career/Work/Health/Personal) a message named, in
// the order first mentioned, deduped — or [] if none. Used to build a
// deterministic "no visible tasks in that category" context note (see
// buildLociCategoryFilterContext) — the system prompt's own PRIORITY
// QUESTIONS rule already tells the model to disclose a category mismatch,
// but relying on the model to notice via the {Category} tags alone isn't
// reliable enough on its own; see issue #338.
export function detectRequestedCategories(message) {
  // The compound-phrase rewrite happens inside normalizeForClassification
  // now, so it runs before every pattern below (not just the clause-scanning
  // ones) — SINGLE_CATEGORY_PATTERNS matches a raw category word directly
  // against the full text, so "what work from home task should I do
  // first?" needs "home" already rewritten to "work" before it ever reaches
  // this function's own pattern matching (Codex review finding).
  const text = normalizeForClassification(String(message || ""));
  // Checked before SINGLE_CATEGORY_PATTERNS: a compound "which work task and
  // health task should..." also matches the "<category> task should" shape
  // below for its second half alone, which would return early with only one
  // category instead of scanning the whole "which" clause for both.
  const whichTaskMatch = text.match(WHICH_TASK_CLAUSE_RE);
  if (whichTaskMatch) {
    const labels = extractCategoryLabels(whichTaskMatch[1]);
    if (labels.length > 0) return labels;
  }
  for (const re of SINGLE_CATEGORY_PATTERNS) {
    const match = text.match(re);
    if (match) return [CATEGORY_LABELS[match[1].toLowerCase()]];
  }
  const clauseMatch = text.match(CATEGORY_PRIORITY_CLAUSE_RE);
  if (clauseMatch && !THIRD_PARTY_POSSESSIVE_RE.test(clauseMatch[1])) {
    const labels = extractCategoryLabels(clauseMatch[1]);
    if (labels.length > 0) return labels;
  }
  const focusForMatch = text.match(FOCUS_FOR_CLAUSE_RE);
  if (focusForMatch) {
    const labels = extractCategoryLabels(focusForMatch[1]);
    if (labels.length > 0) return labels;
  }
  return [];
}

/**
 * Classifies a Coach chat message into the smallest context mode that
 * still serves it well: "light", "emotional", "full_task", "compact_task", or
 * "profile_reflection".
 */
export function classifyContextMode(message, { lastFullTaskTime = 0, hasLastPlan = false } = {}) {
  const text = normalizeForClassification(String(message || ""));

  if (CRISIS_RE.test(text) || PANIC_RE.test(text)) return "emotional";
  if (PROFILE_RE.test(text)) return "profile_reflection";

  // Check full-task pacing (10 minutes)
  const isPaced = lastFullTaskTime > 0 && (Date.now() - lastFullTaskTime < 10 * 60 * 1000);
  const isFreshScanRequested = FRESH_SCAN_RE.test(text);
  const isBroadQuery = BROAD_TASK_QUERY_RE.test(text) || PRIORITY_SYNONYM_RE.test(text) || NEGATION_PRIORITY_RE.test(text);
  const isCheckin = isCheckinRequest(text);
  const isLowEnergy = LOW_ENERGY_RE.test(text);
  const isPriorityFiltered = PRIORITY_FILTER_RE.test(text);

  // Define target reference keyword checker for explicit mutations
  const TARGET_REF_RE = /\b(this|that|it|this task|that task|current task|current focus|now focus|the plan|next step)\b/i;
  const isTargetedMutation = TARGET_REF_RE.test(text);

  // 1. Explicit task action mutations take priority over emotional support
  if (EXPLICIT_ACTION_RE.test(text)) {
    // Body-double/priority-filter/low-energy phrasing can co-occur with
    // explicit-mutation wording (e.g. "start a timer for this, which work
    // task should I do first") — don't compact those away from the prompt
    // blocks they specifically need.
    if (isPaced && hasLastPlan && !isFreshScanRequested && !isBroadQuery && !isCheckin && isTargetedMutation &&
        !isLowEnergy && !isPriorityFiltered && !BODY_DOUBLE_RE.test(text)) {
      return "compact_task";
    }
    return "full_task";
  }

  // 2. Emotional distress takes priority over general task planning, follow-ups,
  // and body-double requests — "I'm overwhelmed, stay with me" is distress
  // first, not a session to start.
  if (EMOTIONAL_RE.test(text)) {
    // isBroadQuery covers newer direct task/data asks ("what do I even do",
    // "what's on my plate") the same way TASK_ASK_RE already does for older
    // phrasings ("what should I do") — without it, "I'm overwhelmed, what do
    // I even do?" would drop to "emotional" while the equivalent
    // TASK_ASK_RE-covered phrasing already escapes to full_task, which is an
    // inconsistency rather than a deliberate distinction.
    if (TASK_ASK_RE.test(text) || isBroadQuery) {
      return "full_task";
    }
    return "emotional";
  }

  // Body-double sessions always need the full visible task list (to confirm
  // the task) and the BODY-DOUBLE SESSIONS prompt instructions, which only
  // exist in full_task mode — never compact this one. But fear/distress
  // phrasing ("I'm scared, stay with me") is emotional support, not a
  // session to start.
  if (BODY_DOUBLE_RE.test(text)) {
    if (FEAR_DISTRESS_RE.test(text)) return "emotional";
    return "full_task";
  }

  // Broad task/deadline queries, standalone fresh-scan requests, and
  // category/horizon-filtered priority questions route to full_task
  if (isBroadQuery || isFreshScanRequested || isPriorityFiltered) return "full_task";

  // 3. General task queries and check-in requests
  if (isCheckin || TASK_RE.test(text) || TASK_ASK_RE.test(text)) {
    if (isPaced && hasLastPlan && !isFreshScanRequested && !isBroadQuery && !isCheckin && !isLowEnergy) {
      return "compact_task";
    }
    return "full_task";
  }

  // 4. Compact follow-up requests
  if (isPaced && hasLastPlan && !isFreshScanRequested && !isCheckin && COMPACT_FOLLOWUP_RE.test(text)) {
    return "compact_task";
  }

  return "light";
}

const REFERENCE_RE = /\b(what did you mean|how do i do that|tell me more|which one|what was the first option|why\??|can you explain that|explain that|elaborate|clarify|key point|one sentence|10-minute version|make it smaller|shorter|how do i start|make this easier|concrete steps|what should i do next|set that|do next)\b/i;

export function needsConversationContext(message) {
  const text = String(message || "");
  return REFERENCE_RE.test(text);
}

export function trimHistoryForDb(history, userText, maxDbHistory = 20) {
  const withUser = [...(history || []), { text: userText, isUser: true }];
  return withUser.length > maxDbHistory ? withUser.slice(withUser.length - maxDbHistory) : withUser;
}

export function trimHistoryForLLM(withUser, contextMode, isReference) {
  const historyLimit = (contextMode === "light" && !isReference) ? 3 : 10;
  return (withUser || []).length > historyLimit ? withUser.slice(withUser.length - historyLimit) : withUser;
}
