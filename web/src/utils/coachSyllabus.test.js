import { describe, expect, it } from "vitest";
import { QUESTIONS, COMPETENCES, NEED_MARKERS, buildTurn, missingNeeds, makeFixture, NOW } from "./coachSyllabus.fixture";
import { buildLocalSafetyReply } from "./crisisSafety";
import { parseRememberRequest } from "./coachMemory";
import { buildLociPeriodContext, buildLociDeadlinesContext } from "./coachPeriodDigest";
import { buildLociBrainDumpContext } from "./lociAIContext";

// The Coach syllabus (#555): the questions any user should get a right answer to,
// however they word them. This is the free, offline layer: for each question it
// builds the real system prompt the way CoachTab does and checks that the data the
// answer needs is in front of the model. It cannot tell whether the model uses the
// data (that is the live layer), but a question that fails here cannot be answered
// at all. A question with `gaps.offline` is a known gap: it is pinned with it.fails,
// so fixing the gap flips the test and the entry has to be cleaned up.

describe("the question bank", () => {
  it("has unique ids, known competences and known data markers", () => {
    const ids = QUESTIONS.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUESTIONS) {
      expect(Object.keys(COMPETENCES), q.id).toContain(q.c);
      for (const key of q.needs || []) expect(Object.keys(NEED_MARKERS), `${q.id} needs ${key}`).toContain(key);
    }
  });

  it("has at least four phrasings for every competence", () => {
    for (const c of Object.keys(COMPETENCES)) {
      expect(QUESTIONS.filter(q => q.c === c).length, c).toBeGreaterThanOrEqual(4);
    }
  });

  it("grades every live question: a provider reply is checked against something", () => {
    for (const q of QUESTIONS.filter(x => x.live)) {
      expect(q.expect, q.id).toBeTruthy();
      expect(Object.keys(q.expect).length, q.id).toBeGreaterThan(0);
    }
  });
});

describe("the made-up user matches the facts the answers are graded against", () => {
  const fixture = makeFixture();

  it("week: 13 tasks on 6 days (5 the week before), 4h10m of focus in 6 sessions on 5 days", () => {
    const out = buildLociPeriodContext({ ...fixture, now: NOW, days: 7, offset: 0 });
    expect(out).toContain("Finished: 13 tasks on 6 days (the 7 days before: 5).");
    expect(out).toContain("'Pay the water bill'");
    const withFocus = buildLociPeriodContext({ ...fixture, now: NOW, days: 7, offset: 0 });
    expect(withFocus).toContain("Focus time: 4h10m on 5 days");
    const sessions = Object.values(fixture.focusRaw).reduce((n, day) => n + Object.keys(day).length, 0);
    expect(sessions).toBe(6);
  });

  it("deadlines: Tax paperwork 2 days overdue, Workshop in 12 days; key deadline in 20 days", () => {
    const out = buildLociDeadlinesContext({ tasks: fixture.tasks, config: fixture.config, now: NOW });
    expect(out).toContain("'Tax paperwork': due");
    expect(out).toContain("2 days overdue");
    expect(out).toContain("'Workshop': due 2 Nov, in 12 days");
    expect(out).toContain("'Conference talk': due 10 Nov, in 20 days");
  });

  it("Mind Box has 4 thoughts, backlog has one task untouched for 16 days and one parked task", () => {
    expect(fixture.brainDump.length).toBe(4);
    expect(buildLociBrainDumpContext(fixture.brainDump)).toContain("4 unprocessed thoughts");
    const bank = fixture.tasks.find(t => t.title === "Call the bank about the card");
    expect(Math.round((NOW.getTime() - bank.lastUpdated) / 86400000)).toBe(16);
    expect(fixture.tasks.find(t => t.title === "Learn the new design tool").isParked).toBe(true);
  });
});

describe("offline syllabus: the data each question needs reaches the model", () => {
  for (const [key, label] of Object.entries(COMPETENCES)) {
    describe(label, () => {
      for (const q of QUESTIONS.filter(x => x.c === key)) {
        if (q.local) {
          it(`${q.id}: "${q.text}" is answered on the device, without a provider`, () => {
            expect(buildLocalSafetyReply(q.text, "Sam")).toBeTruthy();
            expect(buildTurn(q).local).toBeTruthy();
          });
          continue;
        }
        const check = () => {
          const turn = buildTurn(q);
          expect(turn.local).toBeUndefined();
          if (turn.card !== undefined) {
            // Answered by the app: the card's own text is the answer, so grade it.
            expect(turn.card, `"${q.text}" was answered by a ${turn.cardKind} card`).toBeTruthy();
            for (const re of q.expect?.must || []) expect(turn.card, `"${q.text}" must match ${re}`).toMatch(re);
            for (const re of q.expect?.mustNot || []) expect(turn.card, `"${q.text}" must not match ${re}`).not.toMatch(re);
            return;
          }
          // An outright "remember that …" is kept by the app from the user's words.
          if (q.expect?.remembers) expect(parseRememberRequest(q.text), `"${q.text}" must be kept by the app`).toMatch(q.expect.remembers);
          expect(missingNeeds(q, turn.system), `"${q.text}" went to ${turn.mode}`).toEqual([]);
        };
        if (q.gaps?.offline) it.fails(`GAP ${q.id}: "${q.text}": ${q.gaps.offline}`, check);
        else it(`${q.id}: "${q.text}"`, check);
      }
    });
  }
});

describe("which prompt a reworded question gets", () => {
  const reworded = QUESTIONS.filter(x => ["perf-6", "hon-4"].includes(x.id));

  it("gets the full prompt with the user's own key (the alpha case)", () => {
    for (const q of reworded) expect(buildTurn(q).mode, q.text).toBe("full_task");
  });

  it("stays on the lean prompt with only the shared built-in keys", () => {
    for (const q of reworded) expect(buildTurn(q, { ownKey: false }).mode, q.text).toBe("light");
  });
});

describe("safety look-alikes stay with the provider", () => {
  it.each(["I'm dying to finish this report", "this deadline is killing me", "I could end this task list today"])("%s", (text) => {
    expect(buildLocalSafetyReply(text, "Sam")).toBeNull();
  });
});
