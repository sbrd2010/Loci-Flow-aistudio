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
      t({ uuid:"demo-t1", title:"Reply to that recruiter / important email sitting in your inbox", concreteStep:"Open the thread, write 3 honest sentences, hit send", priority:"P1", isNowFocus:true, orderIndex:0,
          subSteps:[
            { id:"ss1", text:"Open email / LinkedIn / WhatsApp", done:true },
            { id:"ss2", text:"Read the message properly", done:true },
            { id:"ss3", text:"Write a short, honest reply (3 sentences is enough)", done:false },
            { id:"ss4", text:"Hit send — done", done:false },
          ]
      }),
      t({ uuid:"demo-t2", title:"Block 25 minutes on your most important task — no distractions", concreteStep:"Close other tabs, set a timer, start on just one thing", priority:"P2", orderIndex:1,
          reminderAt: Date.now() + 2 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-t3", title:"10-minute walk to clear your head between tasks", concreteStep:"Put on shoes, step outside, leave your phone behind", priority:"P4", orderIndex:2 }),
      t({ uuid:"demo-t4", title:"Drink water and take your vitamins", concreteStep:"Go to the kitchen, glass of water, done", priority:"P4", orderIndex:3,
          isCompleted:true, dateCompletedString:todayStr }),
      t({ uuid:"demo-t5", title:"Tidy your workspace so you can actually think", concreteStep:"Put 3 things away and wipe your desk surface", priority:"P3", orderIndex:4,
          isCompleted:true, dateCompletedString:todayStr }),

      // ── Week ─────────────────────────────────────────────────
      t({ uuid:"demo-w1", title:"Update your CV or portfolio — add your most recent work", concreteStep:"Open the file and add one new bullet point or project", priority:"P1", horizonLevel:"week", orderIndex:0 }),
      t({ uuid:"demo-w2", title:"Apply to 3 roles, clients, or gigs this week", concreteStep:"Search one platform, save 3 realistic listings, write one application", priority:"P2", horizonLevel:"week", orderIndex:1 }),
      t({ uuid:"demo-w3", title:"Read one article or watch one video that actually teaches you something", concreteStep:"Pick something relevant to where you want to go — 30 minutes", priority:"P4", horizonLevel:"week", orderIndex:2 }),

      // ── Month ─────────────────────────────────────────────────
      t({ uuid:"demo-m1", title:"Finish one meaningful work or study deliverable", concreteStep:"List the 3 remaining steps, then start step 1 for 25 minutes", priority:"P2", horizonLevel:"month", orderIndex:0,
          reminderAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-m2", title:"Check your finances — what came in, what went out", concreteStep:"Open banking app, scan last 30 days, note one thing to change", priority:"P3", horizonLevel:"month", orderIndex:1 }),

      // ── Quarter ───────────────────────────────────────────────
      t({ uuid:"demo-q1", title:"Invest in one skill that moves your career forward", concreteStep:"Pick a course, book, or mentor and block 2 hours a week for it", priority:"P2", horizonLevel:"quarter", orderIndex:0 }),

      // ── 6 months ──────────────────────────────────────────────
      t({ uuid:"demo-h1", title:"Decide your main direction and make it real by telling someone", concreteStep:"Write 2 sentences: what you're building toward and by when", priority:"P3", horizonLevel:"halfyear", orderIndex:0 }),
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
      { id:"bd1", text:"Look into freelancing — could it replace part-time income?", createdAt: Date.now() - 86400000 },
      { id:"bd2", text:"Reach out to that person from last year — it's been too long", createdAt: Date.now() - 3600000 },
    ],

    timestamp: Date.now(),
  };
}
