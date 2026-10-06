// A real day's Today (Rohan's list on 5 Oct, as drawn in 75a–c): long titles,
// FROM YESTERDAY, GOAL and MUST tags, steps, an overdue reminder, a horizon-
// review tag, two parked tasks, and more than fits before the day ends at
// 02:00. Demo mode loads it in place of its sample day (utils/demoData.js).
// { coach: true } adds a conversation (two 20-word messages from you, two
// 55-word replies: PART7's 2 + 2 check), a saved Coach's brief, and a clear
// best weekday (yesterday).
// { plan: true } adds 76a's horizons: Career (ends in 5 days) and Work (to
// the month's end) beside the built-ins, with 3 · 13 · 2 · 6 · 12 · 4 tasks.
export async function loadRealDay(page, { coach = false, plan = false } = {}) {
  await page.addInitScript(({ withCoach, withPlan }) => {
    window.__LOCI_DEMO_FIXTURE__ = () => {
      const now = Date.now();
      let payload;
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const today = ymd(new Date());
      const plus = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return ymd(d); };
      let n = 0;
      const t = (o) => ({
        id: 5000 + n, userId: "demo", uuid: `real-${n++}`, title: "", concreteStep: "", horizonLevel: "today",
        priority: "P2", category: "Personal", timeEstimateMinutes: 25, deadlineTimestamp: null, reminderAt: null,
        isCompleted: false, isParked: false, isNowFocus: false, orderIndex: n, dateCompletedString: null,
        isDeleted: false, lastUpdated: now, ...o,
      });
      const steps = (doneCount, total, first) => Array.from({ length: total }, (_, i) => ({
        id: `s${n}-${i}`, text: i === doneCount && first ? first : `Step ${i + 1}`, done: i < doneCount,
      }));
      const fromYesterday = { deferredUntil: today };
      payload = {
        userId: "demo",
        tasks: [
          t({ title: "Water Meter reading: SUBMIT urgently", isNowFocus: true, priority: "P1", timeEstimateMinutes: 15,
            subSteps: steps(1, 2, "Email the value to the water company") }),
          t({ title: "Sept/Oct Trip", timeEstimateMinutes: 60, subSteps: steps(0, 1, "Book the train") }),
          t({ title: "Iris: Visa extension- 18 months & Lead/Sr. Polymer Scientist", timeEstimateMinutes: 25, reminderAt: now - 3 * 3600_000 }),
          t({ title: "Dad: write letter and send", timeEstimateMinutes: 60, ...fromYesterday }),
          t({ title: "PRINCE2 Fundamentals URGENT: 1 hour/Day", timeEstimateMinutes: 90, ...fromYesterday }),
          t({ title: "Gmail: Check and sort out", timeEstimateMinutes: 15, ...fromYesterday }),
          t({ title: "PRINCE2: Check the latest Prince2 study material prepared by chatgpt", timeEstimateMinutes: 15, ...fromYesterday }),
          t({ title: "Dutch Course: Update the A1.1 and A1.2 files in project files", timeEstimateMinutes: 15, ...fromYesterday }),
          t({ title: "Electricity connection: Renew it", timeEstimateMinutes: 25, priority: "P1", isMVD: true, ...fromYesterday }),
          t({ title: "Clean Dishwasher", timeEstimateMinutes: 25, ...fromYesterday }),
          t({ title: "Prepare CV- Avery denison, Tesa", timeEstimateMinutes: 120, subSteps: steps(0, 4, "Pick the two strongest projects"),
            reviewFrom: { label: "FROM WEEK TO 4 OCT", day: today, horizon: "week" } }),
          t({ title: "Call Ahilan", timeEstimateMinutes: 60 }),
          t({ title: "Dad: Check if money has been sent?", timeEstimateMinutes: 15 }),
          t({ title: "CleanHYPRO: Modification of PAP PLAN", timeEstimateMinutes: 180, subSteps: steps(1, 7, "Redo the PAP flow sheet") }),
          // After 02:00, as on 5 Oct (03:25 there, after breaks): a must-do that
          // doesn't fit.
          t({ title: "Prof. Anupam: Reply him URGENT!!", timeEstimateMinutes: 25, priority: "P1", isMVD: true }),
          t({ title: "Renew the library books", isParked: true, parkedAt: now - 5 * 86400_000 }),
          t({ title: "Sort the photo backup", isParked: true, parkedAt: now - 5 * 86400_000 }),
          t({ title: "Apply: Polymer scientist, Nouryon", horizonLevel: "week", timeEstimateMinutes: 60 }),
          t({ title: "Book the dentist", horizonLevel: "week", timeEstimateMinutes: 15 }),
        ],
        config: {
          userId: "demo", userName: "Rohan", mentorName: "Yoda", isOnboardingCompleted: true,
          pomodoroDurationMinutes: 25, dayStartHour: 7, dayEndHour: 26, eveningGuardWindowActive: false,
          deadlineLabel: "05 Oct: 3 Jobs apply. Need interview in 2 weeks",
          deadlineDate: plus(10), deadlineStartDate: plus(-4),
          anchorsOnToday: "off", dailyAnchors: [], morningRitualShownDate: today, lastUpdated: now,
        },
        contributions: [1, 2, 3].map(back => {
          const d = new Date(); d.setDate(d.getDate() - back);
          return { compositeKey: `demo_${ymd(d)}`, userId: "demo", dateString: ymd(d), count: 2, lastUpdated: now };
        }),
        brainDump: [],
        timestamp: now,
      };
      if (withPlan) {
        const d = new Date();
        const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
        const monthDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        payload.config.horizons = {
          career: { id: "career", name: "Career", kind: "custom", startDate: plus(-4), lengthDays: 10 },
          work76: { id: "work76", name: "Work", kind: "custom", startDate: first, lengthDays: monthDays },
        };
        const add = (horizonLevel, titles) => titles.forEach(title => payload.tasks.push(t({ title, horizonLevel, timeEstimateMinutes: 60 })));
        add("career", ["Prepare CV- ENDURES, Everlam, Grief, UL", "Prep CV- Yaghma, Nouryon, NKT extrusion, Robert Walters, De LAVAL, ALPLA Group", "Prep CV - Amazon + Dupont + Tesla + IFF + Allnex + Galderma"]);
        add("week", Array.from({ length: 13 }, (_, i) => `This week task ${i + 1}`));
        add("month", ["Renew the passport photos", "Book the dentist"]);
        add("work76", Array.from({ length: 6 }, (_, i) => `Work task ${i + 1}`));
        add("quarter", Array.from({ length: 12 }, (_, i) => `Quarter task ${i + 1}`));
        add("halfyear", ["Learn Dutch A2", "Plan the summer trip", "Publish the PAP paper", "Run a half marathon"]);
      }
      if (withCoach) {
        const t0 = now - 40 * 60_000;
        payload.chatHistory = [
          { isUser: true, at: t0, text: "Submitted the water meter reading just now, it took longer than I thought because the portal kept logging me out." },
          { isUser: false, at: t0 + 60_000, text: "That one is off your list, and the portal fighting you is not on you. Next is your pinned task: open Gmail, find the first unread email and flag it to read later. Only one email, nothing more. Once it is flagged, come back here and tell me, and we will pick the next step." },
          { isUser: true, at: t0 + 30 * 60_000, text: "I keep jumping between things today and cannot settle down at all. What should I do with the next hour?" },
          { isUser: false, at: t0 + 31 * 60_000, text: "Close every tab except Gmail. Flag that one email, then start the PRINCE2 hour with the timer on and nothing else open. If your mind wanders, park the thought in Mind Box and go back. When the hour ends, tell me what you covered, and we will decide together whether the CV really comes next." },
        ];
        // 73a's week: 2h16m of focus, most of it on no front, so Review's
        // brief opens with its lead sentence.
        const done = (back, mins, i) => {
          const d = new Date(); d.setDate(d.getDate() - back);
          return [ymd(d), { [`e${back}-${i}`]: { type: "focus_completed", focusElapsedSeconds: mins * 60, lociDateString: ymd(d) } }];
        };
        const ledger = Object.fromEntries([done(1, 58, 0), done(2, 15, 0), done(3, 25, 0), done(4, 38, 0)]);
        window.__LOCI_DEMO_FOCUS__ = () => ledger;
        // Yesterday is the clear best weekday over 30 days (Review, 73a).
        payload.contributions[0].count = 4;
        const cv = payload.tasks.find(x => x.title.startsWith("Prepare CV"));
        const prince = payload.tasks.find(x => x.title.startsWith("PRINCE2 Fundamentals"));
        payload.config.coachBrief = {
          at: now - 2 * 3600_000,
          howItWent: ["0 done today. 5 done in the last 7 days, down from 9 the week before."],
          patterns: ["Health has had nothing done in 30 days."],
          estimates: [{ uuid: cv.uuid, title: cv.title, fact: "estimated at 2h, long for one sitting.", action: "split" }],
          next: { uuid: prince.uuid, title: prince.title, line: "Start the 1-hour block. The first step is opening the course." },
        };
      }
      return payload;
    };
  }, { withCoach: coach, withPlan: plan });
}
