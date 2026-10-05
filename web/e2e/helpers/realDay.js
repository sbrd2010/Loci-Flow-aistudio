// A real day's Today (Rohan's list on 5 Oct, as drawn in 75a–c): long titles,
// FROM YESTERDAY, GOAL and MUST tags, steps, an overdue reminder, a horizon-
// review tag, two parked tasks, and more than fits before the day ends at
// 02:00. Demo mode loads it in place of its sample day (utils/demoData.js).
export async function loadRealDay(page) {
  await page.addInitScript(() => {
    window.__LOCI_DEMO_FIXTURE__ = () => {
      const now = Date.now();
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
      return {
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
          t({ title: "Electricity connection: Renew it", timeEstimateMinutes: 25, priority: "P1", ...fromYesterday }),
          t({ title: "Clean Dishwasher", timeEstimateMinutes: 25, ...fromYesterday }),
          t({ title: "Prepare CV- Avery denison, Tesa", timeEstimateMinutes: 120, subSteps: steps(0, 4, "Pick the two strongest projects"),
            reviewFrom: { label: "FROM WEEK TO 4 OCT", day: today, horizon: "week" } }),
          t({ title: "Prof. Anupam: Reply him URGENT!!", timeEstimateMinutes: 25, priority: "P1" }),
          t({ title: "Call Ahilan", timeEstimateMinutes: 60 }),
          t({ title: "Dad: Check if money has been sent?", timeEstimateMinutes: 15 }),
          t({ title: "CleanHYPRO: Modification of PAP PLAN", timeEstimateMinutes: 180, subSteps: steps(1, 7, "Redo the PAP flow sheet") }),
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
    };
  });
}
