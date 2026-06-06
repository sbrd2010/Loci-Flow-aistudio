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
      t({ uuid:"demo-t1", title:"Reply to the important message sitting in your inbox", concreteStep:"Open the thread, write 3 honest sentences, hit send", priority:"P1", isNowFocus:true, orderIndex:0,
          subSteps:[
            { id:"ss1", text:"Open email / LinkedIn / WhatsApp", done:true },
            { id:"ss2", text:"Read the message properly", done:true },
            { id:"ss3", text:"Write a short, honest reply (3 sentences is enough)", done:false },
            { id:"ss4", text:"Hit send — done", done:false },
          ]
      }),
      t({ uuid:"demo-t2", title:"25-minute deep work block — one task, no distractions", concreteStep:"Close other tabs, silence notifications, start the timer", priority:"P2", orderIndex:1,
          reminderAt: Date.now() + 2 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-t3", title:"10-minute walk between tasks to reset your focus", concreteStep:"Step outside, leave the phone, breathe", priority:"P4", orderIndex:2 }),
      t({ uuid:"demo-t4", title:"Drink water and take your vitamins", concreteStep:"Go to the kitchen, glass of water, done", priority:"P4", orderIndex:3,
          isCompleted:true, dateCompletedString:todayStr }),
      t({ uuid:"demo-t5", title:"Clear your desk so your environment supports your thinking", concreteStep:"Put 3 things away and wipe the surface", priority:"P3", orderIndex:4,
          isCompleted:true, dateCompletedString:todayStr }),

      // ── Week ─────────────────────────────────────────────────
      t({ uuid:"demo-w1", title:"Push the project or deliverable one step closer to done", concreteStep:"Open the file, write the next section or complete one task on the list", priority:"P1", horizonLevel:"week", orderIndex:0 }),
      t({ uuid:"demo-w2", title:"Reach out to 2 people — clients, collaborators, or connections", concreteStep:"Write one honest, short message and send it", priority:"P2", horizonLevel:"week", orderIndex:1 }),
      t({ uuid:"demo-w3", title:"Learn one thing relevant to where you want to go — 30 minutes", concreteStep:"Pick an article, video, or chapter and actually read it", priority:"P4", horizonLevel:"week", orderIndex:2 }),

      // ── Month ─────────────────────────────────────────────────
      t({ uuid:"demo-m1", title:"Complete the one thing you've been putting off all month", concreteStep:"Break it into 3 steps, do step 1 right now for 25 minutes", priority:"P2", horizonLevel:"month", orderIndex:0,
          reminderAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      }),
      t({ uuid:"demo-m2", title:"Review your finances — income, expenses, one thing to fix", concreteStep:"Open your banking app, scan last 30 days, note one change", priority:"P3", horizonLevel:"month", orderIndex:1 }),

      // ── Quarter ───────────────────────────────────────────────
      t({ uuid:"demo-q1", title:"Invest in one skill or relationship that moves you forward", concreteStep:"Identify it, block 2 hours a week, start this week", priority:"P2", horizonLevel:"quarter", orderIndex:0 }),

      // ── 6 months ──────────────────────────────────────────────
      t({ uuid:"demo-h1", title:"Make your main direction concrete enough to tell someone", concreteStep:"Write 2 sentences: what you're building toward and by when", priority:"P3", horizonLevel:"halfyear", orderIndex:0 }),
    ],

    config: {
      userId: "demo",
      userName: "Demo User",
      mentorName: "Mark",
      challengeType: "overplanner",
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
      deadlineLabel: "Visa & career deadline",
      deadlineDate: (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); })(),
      deadlineStartDate: new Date().toISOString().slice(0, 10),
      deadlineAction: "Apply to one job today",
      deadlineCardStyle: "compact",
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
      { id:"bd1", text:"Look into freelancing or consulting on the side — is the market there?", createdAt: Date.now() - 86400000 },
      { id:"bd2", text:"Reach out to that person from last year — it's been too long", createdAt: Date.now() - 3600000 },
      { id:"bd3", text:"Figure out if this current path is leading somewhere or just keeping me busy", createdAt: Date.now() - 7200000 },
    ],

    timestamp: Date.now(),
  };
}
