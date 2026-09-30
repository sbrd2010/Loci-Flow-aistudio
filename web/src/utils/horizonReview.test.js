import { describe, expect, it } from "vitest";
import { applyReview, applySort, detectReviews, leftoverTags, pendingReviews, undoReviewOrSort } from "./horizonReview";

const t = (uuid, horizonLevel, extra = {}) => ({ uuid, horizonLevel, title: uuid, ...extra });

describe("the horizon review (57f)", () => {
  const tasks = [t("w1", "week"), t("w2", "week", { isCompleted: true }), t("m1", "month"), t("h1", "halfyear")];

  it("the first time, each horizon is only noted — no review of what came before", () => {
    const rec = detectReviews({}, tasks, "2026-09-30");
    expect(rec).toMatchObject({ week: { through: "2026-09-27" }, month: { through: "2026-08-31" }, quarter: { through: "2026-06-30" } });
    expect(rec.halfyear).toBeUndefined(); // 6 months never ends
    expect(detectReviews({ horizonReviews: rec }, tasks, "2026-09-30")).toBe(null);
  });

  it("a period ending leaves its open tasks for review; the month's end reads 'September ended'", () => {
    const noted = detectReviews({}, tasks, "2026-09-30");
    const after = detectReviews({ horizonReviews: noted }, tasks, "2026-10-01");
    expect(after.month).toMatchObject({ through: "2026-09-30", pending: { end: "2026-09-30", periods: 1, uuids: ["m1"] } });
    expect(after.week.pending).toBeUndefined(); // the week hasn't ended (Mon 28 Sep – Sun 4 Oct)
    const reviews = pendingReviews({ horizonReviews: after }, tasks, "2026-10-01");
    expect(reviews.map(r => [r.id, r.title, r.from, r.tag])).toEqual([["month", "September ended", "SEPTEMBER", "SEP"]]);
    expect(leftoverTags(reviews).get("m1")).toBe("SEP");
  });

  it("a long absence merges the periods: '3 weeks ended'; order week → month → quarter", () => {
    const noted = detectReviews({}, tasks, "2026-09-30");
    const back = detectReviews({ horizonReviews: noted }, tasks, "2026-10-19");
    const reviews = pendingReviews({ horizonReviews: back }, tasks, "2026-10-19");
    expect(reviews.map(r => r.title)).toEqual(["3 weeks ended", "September ended"]);
    expect(reviews[0].from).toBe("WEEK TO 18 OCT");
  });

  it("a horizon with nothing open moves on without a review", () => {
    const noted = detectReviews({}, [], "2026-09-30");
    const after = detectReviews({ horizonReviews: noted }, [], "2026-10-01");
    expect(after.month).toMatchObject({ through: "2026-09-30", pending: null });
  });

  it("Done: keep, Today (top, tagged for the day) or Drop; Undo puts all back", () => {
    const all = [...tasks, t("m2", "month"), t("m3", "month"), t("td", "today", { orderIndex: 0 })];
    const noted = detectReviews({}, all, "2026-09-30");
    const config = { horizonReviews: detectReviews({ horizonReviews: noted }, all, "2026-10-01") };
    const [review] = pendingReviews(config, all, "2026-10-01");
    const before = { tasks: all, config };
    const after = applyReview(before, review, { m1: "keep", m2: "today", m3: "drop" }, "2026-10-01", 7);
    expect(after.tasks.find(x => x.uuid === "m1").horizonLevel).toBe("month");
    expect(after.tasks.find(x => x.uuid === "m2")).toMatchObject({ horizonLevel: "today", orderIndex: -1, reviewFrom: { label: "FROM SEPTEMBER", day: "2026-10-01" } });
    expect(after.tasks.find(x => x.uuid === "m3")).toMatchObject({ isDeleted: true, deletedAt: 7 });
    expect(after.config.horizonReviews.month).toMatchObject({ pending: null, last: { end: "2026-09-30", kept: 1, today: 1, dropped: 1, at: 7 } });
    expect(pendingReviews(after.config, after.tasks, "2026-10-01")).toEqual([]);
    const back = undoReviewOrSort(after, before, ["m1", "m2", "m3"], "month");
    expect(back.tasks.find(x => x.uuid === "m2").horizonLevel).toBe("month");
    expect(back.tasks.find(x => x.uuid === "m3").isDeleted).toBeUndefined();
    expect(pendingReviews(back.config, back.tasks, "2026-10-01")).toHaveLength(1);
  });
});

it("Work · older Sort: each to a horizon at the bottom of its list, or Drop", () => {
  const tasks = [t("o1", "office"), t("o2", "office"), t("w", "week")];
  const after = applySort({ tasks }, { o1: "week", o2: "drop" }, 3);
  expect(after.tasks.find(x => x.uuid === "o1")).toMatchObject({ horizonLevel: "week", orderIndex: 1 });
  expect(after.tasks.find(x => x.uuid === "o2")).toMatchObject({ isDeleted: true, deletedAt: 3 });
});
