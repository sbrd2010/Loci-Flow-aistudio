const toDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

const today = new Date();
const todayStr = toDateStr(today);
const d1 = new Date(); d1.setDate(today.getDate()-1);
const d2 = new Date(); d2.setDate(today.getDate()-2);
const d4 = new Date(); d4.setDate(today.getDate()-4);
const d5 = new Date(); d5.setDate(today.getDate()-5);
const d6 = new Date(); d6.setDate(today.getDate()-6);

let _id = 1000;
const t = (overrides) => ({
  id: _id++,
  userId: "demo",
  uuid: `demo-${_id}`,
  title: "",
  concreteStep: "",
  horizonLevel: "today",
  priority: "P2",
  category: "Personal",
  timeEstimateMinutes: 25,
  deadlineTimestamp: null,
  reminderAt: null,
  isCompleted: false,
  isParked: false,
  isNowFocus: false,
  orderIndex: 0,
  dateCompletedString: null,
  isDeleted: false,
  lastUpdated: Date.now(),
  ...overrides,
});

export function createDemoPayload() {
  return {
    userId: "demo",
    tasks: [
      // ── Today ────────────────────────────────────────────────
      t({ uuid:"demo-t1", title:"Write down the 3 most important things for today", concreteStep:"Grab a notepad or open a note app, pick your top 3", priority:"P1", isNowFocus:true, orderIndex:0,
          subSteps:[
            { id:"ss1", text:"Think about what absolutely must happen today", done:true },
            { id:"ss2", text:"Write down your first priority", done:true },
            { id:"ss3", text:"Write down priorities 2 and 3", done:false },
            { id:"ss4", text:"Put the list somewhere visible", done:false },
          ]
      }),
      t({ uuid:"demo-t2", title:"Reply to that message you've been putting off", concreteStep:"Open the app or email, type a quick honest reply", priority:"P2", orderIndex:1,
          reminderAt: Date.now() + 2 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-t3", title:"10-minute walk outside to reset focus", concreteStep:"Put on shoes, step outside, walk around the block", priority:"P4", orderIndex:2 }),
      t({ uuid:"demo-t4", title:"Drink a full glass of water right now", concreteStep:"Go to the kitchen, fill a glass, drink it", priority:"P4", orderIndex:3,
          isCompleted:true, dateCompletedString:todayStr }),
      t({ uuid:"demo-t5", title:"Take morning medication / vitamins", concreteStep:"Open the cabinet, take with water", priority:"P3", orderIndex:4,
          isCompleted:true, dateCompletedString:todayStr }),

      // ── Week ─────────────────────────────────────────────────
      t({ uuid:"demo-w1", title:"Tidy one corner of your space that bothers you", concreteStep:"Pick the messiest spot, spend 20 minutes on just that area", priority:"P2", horizonLevel:"week", orderIndex:0 }),
      t({ uuid:"demo-w2", title:"Schedule that appointment you've been avoiding", concreteStep:"Find the number or website, pick a time slot, book it", priority:"P3", horizonLevel:"week", orderIndex:1 }),
      t({ uuid:"demo-w3", title:"Read 20 pages of a book you actually enjoy", concreteStep:"Find the book, set a timer for 30 min, start reading", priority:"P4", horizonLevel:"week", orderIndex:2 }),

      // ── Month ─────────────────────────────────────────────────
      t({ uuid:"demo-m1", title:"Start learning one thing you've wanted to for a while", concreteStep:"Search for a beginner tutorial or video, spend 25 min on it", priority:"P2", horizonLevel:"month", orderIndex:0,
          reminderAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-m2", title:"Call or message someone you haven't spoken to in a while", concreteStep:"Think of one person, send them a simple 'hey, how are you?'", priority:"P3", horizonLevel:"month", orderIndex:1 }),

      // ── Quarter ───────────────────────────────────────────────
      t({ uuid:"demo-q1", title:"Pick one habit to build this season", concreteStep:"Write down the habit and decide on a trigger that starts it daily", priority:"P2", horizonLevel:"quarter", orderIndex:0 }),

      // ── 6 months ──────────────────────────────────────────────
      t({ uuid:"demo-h1", title:"Plan a trip or experience to look forward to", concreteStep:"Brainstorm 3 ideas with someone you'd go with", priority:"P3", horizonLevel:"halfyear", orderIndex:0 }),
    ],

    config: {
      userId: "demo",
      userName: "Demo User",
      mentorName: "Mark",
      challengeType: "starting",
      pomodoroDurationMinutes: 25,
      reminderNagIntervalMinutes: 15,
      visitStreakCount: 5,
      lastVisitDate: todayStr,
      totalXp: 750,
      isLowEnergyMode: false,
      isOnboardingCompleted: true,
      eveningGuardWindowActive: true,
      roadmapStyle: "compact",
      headerStyle: "full",
      toolsStyle: "inline",
      lastUpdated: Date.now(),
    },

    contributions: [
      { compositeKey:`demo_${todayStr}`,       userId:"demo", dateString:todayStr,       count:2, lastUpdated:Date.now() },
      { compositeKey:`demo_${toDateStr(d1)}`,  userId:"demo", dateString:toDateStr(d1),  count:4, lastUpdated:Date.now() },
      { compositeKey:`demo_${toDateStr(d2)}`,  userId:"demo", dateString:toDateStr(d2),  count:1, lastUpdated:Date.now() },
      { compositeKey:`demo_${toDateStr(d4)}`,  userId:"demo", dateString:toDateStr(d4),  count:3, lastUpdated:Date.now() },
      { compositeKey:`demo_${toDateStr(d5)}`,  userId:"demo", dateString:toDateStr(d5),  count:2, lastUpdated:Date.now() },
    ],

    brainDump: [
      { id:"bd1", text:"Try journaling for a week and see if it helps", createdAt: Date.now() - 86400000 },
      { id:"bd2", text:"Look into a good task manager that works for my brain", createdAt: Date.now() - 3600000 },
    ],

    timestamp: Date.now(),
  };
}
