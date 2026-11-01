// Bundle with esbuild before running: utility imports use Vite extension resolution.
import test from "node:test";
import assert from "node:assert/strict";
import { getFocusWindows, getLociDayStr, lociDaysBack, lociDayEndsAt } from "../src/utils/focusWindows.js";
import { mergeLocalIntoServer, mergeRemotePayloadWithMeta } from "../src/utils/normalizePayload.js";

test("Loci days remain consecutive across DST in three time zones", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Europe/Amsterdam", "America/New_York", "Asia/Kolkata"]) {
      process.env.TZ = zone;
      const windows = getFocusWindows({ focusWindows: [{ start: "07:00", end: "02:00" }] });
      for (const [year, month, day] of [[2026, 2, 29], [2026, 9, 25], [2026, 10, 1]]) {
        const now = new Date(year, month, day, 12);
        const dates = lociDaysBack(now, windows, 7);
        assert.equal(new Set(dates).size, 7, zone);
        for (let i = 0; i < 7; i++) {
          const expected = new Date(year, month, day - i, 12);
          assert.equal(dates[i], `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}`, zone);
        }
        const afterMidnight = new Date(year, month, day + 1, 0, 30);
        assert.equal(getLociDayStr(afterMidnight, windows), dates[0], zone);
        const end = new Date(lociDayEndsAt(dates[0], windows));
        assert.equal(end.getHours(), 2, zone);
        assert.ok(end > afterMidnight, zone);
      }
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("100 merge schedules preserve unrelated work and converge after the server echo", () => {
  for (let i = 0; i < 100; i++) {
    const stamp = 1000 + i * 10;
    const task = (id, title, updated) => ({ id, uuid: `task-${id}`, userId: "synthetic@example.test", title, lastUpdated: updated });
    const base = {
      userId: "synthetic@example.test", config: { userId: "synthetic@example.test", mentorName: "Original" },
      tasks: [task(1, "Original", stamp)], brainDump: [{ id: "thought-1", text: "Original thought" }], contributions: [], chatHistory: [], timestamp: stamp,
    };
    const local = { ...base, tasks: [task(1, "Local edit", stamp + 2)], config: { ...base.config, mentorName: "Local coach" }, timestamp: stamp + 2 };
    const server = { ...base, tasks: [...base.tasks, task(2, "Remote addition", stamp + 3)], config: { ...base.config, deadlineLabel: "Remote deadline" }, timestamp: stamp + 3 };
    const committed = mergeLocalIntoServer(server, local, base);
    assert.equal(committed.tasks.length, 2);
    assert.equal(committed.tasks.find(t => t.id === 1).title, "Local edit");
    assert.equal(committed.config.deadlineLabel, "Remote deadline");
    assert.equal(committed.config.mentorName, "Local coach");
    const echo = mergeRemotePayloadWithMeta(committed, committed, committed.config, committed.contributions, committed.brainDump, committed.chatHistory);
    assert.equal(echo.hasLocalContribution, false);
    assert.deepEqual(mergeLocalIntoServer(committed, committed, committed).tasks, committed.tasks);
  }
});
