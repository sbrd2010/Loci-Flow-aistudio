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
      t({ uuid:"demo-t1", title:"Review and send Q3 project proposal", concreteStep:"Open the doc, read summary section, add your sign-off", priority:"P1", isNowFocus:true, orderIndex:0,
          subSteps:[
            { id:"ss1", text:"Open the Google Doc", done:true },
            { id:"ss2", text:"Read through the executive summary", done:true },
            { id:"ss3", text:"Add your comments in the margin", done:false },
            { id:"ss4", text:"Click 'Share' and send to team", done:false },
          ]
      }),
      t({ uuid:"demo-t2", title:"Reply to 3 important emails", concreteStep:"Open inbox, filter unread, reply to top 3", priority:"P2", orderIndex:1,
          reminderAt: Date.now() + 2 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-t3", title:"10-minute walk outside to reset focus", concreteStep:"Put on sneakers, step outside, walk around the block", priority:"P4", orderIndex:2 }),
      t({ uuid:"demo-t4", title:"Take morning vitamins", concreteStep:"Get glass of water", priority:"P4", orderIndex:3,
          isCompleted:true, dateCompletedString:todayStr }),
      t({ uuid:"demo-t5", title:"Call back Dr. Sharma re: appointment", concreteStep:"Find his number in contacts", priority:"P3", orderIndex:4,
          isCompleted:true, dateCompletedString:todayStr }),

      // ── Week ─────────────────────────────────────────────────
      t({ uuid:"demo-w1", title:"Prepare slides for Monday team presentation", concreteStep:"Outline 5 key points first, then open PowerPoint", priority:"P1", horizonLevel:"week", orderIndex:0 }),
      t({ uuid:"demo-w2", title:"Schedule dentist appointment", concreteStep:"Find their number, pick a Tuesday slot", priority:"P3", horizonLevel:"week", orderIndex:1 }),
      t({ uuid:"demo-w3", title:"Read 30 pages of Deep Work", concreteStep:"Put phone in another room, open book to bookmark", priority:"P4", horizonLevel:"week", orderIndex:2 }),

      // ── Month ─────────────────────────────────────────────────
      t({ uuid:"demo-m1", title:"Complete React certification course (Module 4–6)", concreteStep:"Log in to platform, resume from where you left off", priority:"P2", horizonLevel:"month", orderIndex:0,
          reminderAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-m2", title:"Submit annual performance self-review", concreteStep:"Open HR portal and fill in the first 3 questions", priority:"P1", horizonLevel:"month", orderIndex:1 }),

      // ── Quarter ───────────────────────────────────────────────
      t({ uuid:"demo-q1", title:"Launch personal portfolio website", concreteStep:"Pick a template on Vercel, spend 25 min customising", priority:"P2", horizonLevel:"quarter", orderIndex:0 }),

      // ── 6 months ──────────────────────────────────────────────
      t({ uuid:"demo-h1", title:"Plan and book family holiday trip", concreteStep:"Research 3 destination options, share shortlist with family", priority:"P3", horizonLevel:"halfyear", orderIndex:0 }),
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
      { id:"bd1", text:"Look into Obsidian for notes", createdAt: Date.now() - 86400000 },
      { id:"bd2", text:"Buy a standing desk mat", createdAt: Date.now() - 3600000 },
    ],

    timestamp: Date.now(),
  };
}
