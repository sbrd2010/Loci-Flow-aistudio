// #643: horizon-review commands. The review record (config.horizonReviews)
// changes only through these, each decided against what the server holds,
// inside the same root transaction full saves use (useSync runReviewCommand).
// Generic merges and overlays never write the record (normalizePayload), so a
// device holding a stale copy cannot recreate a finished review or undo a Done.
//
// Every input is fixed before the transaction (day, now, op, choices): the
// decision is pure, and runs again unchanged if the server re-runs it.
//
// cmd:
//   { kind: "detect", day, now }
//   { kind: "done", id, end, day, now, op, choices, shown }   shown: uuid → lastUpdated, as the dialog showed them
//   { kind: "undo", id, op, through, now, beforeRecord, beforeTasks, after }   after: uuid → task, as the Done left it
import { child, onValue, ref, runTransaction } from "firebase/database";
import { applyReview, detectReviews, pendingReviews } from "./horizonReview";
import { configValuesEqual, normalizePayload } from "./normalizePayload";

const num = (v) => (Number.isFinite(v) ? v : 0);
const reviewsOf = (config) => (config?.horizonReviews && typeof config.horizonReviews === "object" ? config.horizonReviews : {});

// Today's route takes a task in on its own (useDayRoute joinRoute/reflow:
// dayMap* fields and orderIndex), and the save that carries it moves the
// task's clock (mergeTasksForWrite). Neither is an edit, so Undo compares
// what's left; the copy Undo writes back leaves the route, as
// undoPullFromWeek does. Any other change, stamped or not, stops it.
const ignoredByUndo = (k) => k.startsWith("dayMap") || k === "orderIndex" || k === "lastUpdated";
const editedFields = (task) => Object.fromEntries(Object.entries(task || {}).filter(([k]) => !ignoredByUndo(k)));

// What `server` (a normalized payload) should become:
// { action: "write", next } | { action: "noop" } | { action: "conflict", reason }.
export function decideReviewCommand(server, cmd) {
  const config = server.config || {};
  const tasks = server.tasks || [];
  const stamp = (next) => ({
    ...next,
    timestamp: Math.max(num(server.timestamp), cmd.now),
    config: { ...next.config, lastUpdated: Math.max(num(config.lastUpdated), cmd.now) },
  });

  if (cmd.kind === "detect") {
    const next = detectReviews(config, tasks, cmd.day);
    return next ? { action: "write", next: stamp({ ...server, config: { ...config, horizonReviews: next } }) } : { action: "noop" };
  }

  const rec = reviewsOf(config)[cmd.id] || {};
  if (cmd.kind === "done") {
    if (!rec.pending) return { action: "conflict", reason: "already-reviewed" };
    if (rec.pending.end !== cmd.end) return { action: "conflict", reason: "stale-period" };
    // The tasks waiting now must be the ones shown, none edited since (by its
    // lastUpdated: an edit that didn't bump it goes unnoticed here, which is
    // harmless — the choices are applied to the server's own copy below, so
    // nothing stale is written; this only makes sure the list was current).
    const review = pendingReviews(config, tasks, cmd.day).find(r => r.id === cmd.id);
    const now = new Map((review?.tasks || []).map(t => [t.uuid, t.lastUpdated]));
    const shown = Object.entries(cmd.shown || {});
    if (!review || now.size !== shown.length || shown.some(([uuid, lu]) => !now.has(uuid) || now.get(uuid) !== lu)) {
      return { action: "conflict", reason: "tasks-changed" };
    }
    const applied = applyReview(server, review, cmd.choices || {}, cmd.day, cmd.now);
    // A moved or dropped task is stamped newer than the server's copy even if
    // this device's clock is behind, so no merge prefers an older copy.
    const prior = new Map(tasks.map(t => [t.uuid, num(t.lastUpdated)]));
    const changed = new Set(review.tasks.filter(t => (cmd.choices || {})[t.uuid] && cmd.choices[t.uuid] !== "keep").map(t => t.uuid));
    const out = { ...applied, tasks: applied.tasks.map(t => (changed.has(t.uuid) ? { ...t, lastUpdated: Math.max(cmd.now, prior.get(t.uuid) + 1) } : t)) };
    const reviews = out.config.horizonReviews;
    return { action: "write", next: stamp({ ...out, config: { ...out.config, horizonReviews: { ...reviews, [cmd.id]: { ...reviews[cmd.id], last: { ...reviews[cmd.id].last, op: cmd.op } } } } }) };
  }

  if (cmd.kind === "undo") {
    // All or nothing: the Done must still be the latest thing that happened to
    // this review, and every task it moved exactly as it left it (whole
    // contents, not just lastUpdated: Undo writes back older copies, so any
    // edit since, stamped or not, must stop it).
    const byUuid = new Map(tasks.map(t => [t.uuid, t]));
    const touched = Object.entries(cmd.after || {});
    const unchanged = rec.last?.op === cmd.op && rec.through === cmd.through && !rec.pending
      && touched.every(([uuid, task]) => byUuid.has(uuid) && configValuesEqual(editedFields(byUuid.get(uuid)), editedFields(task)));
    if (!unchanged) return { action: "conflict", reason: "changed-since" };
    const before = new Map((cmd.beforeTasks || []).map(t => [t.uuid, t]));
    return {
      action: "write",
      next: stamp({
        ...server,
        // undoneOp: how a device whose connection dropped mid-Undo can tell it landed.
        config: { ...config, horizonReviews: { ...reviewsOf(config), [cmd.id]: { ...cmd.beforeRecord, undoneOp: cmd.op } } },
        // Newer than the Done's copy, so every merge keeps the restored task.
        tasks: tasks.map(t => (before.has(t.uuid) ? { ...before.get(t.uuid), lastUpdated: Math.max(cmd.now, num(t.lastUpdated) + 1) } : t)),
      }),
    };
  }
  throw new Error(`unknown review command: ${cmd.kind}`);
}

// The outcome, from the transaction's real result: "accepted" only when it
// committed; otherwise the command is decided again on the value the server
// ended with, to say why nothing was written.
export function reviewOutcome(committed, serverValue, decide) {
  if (committed) return { outcome: "accepted" };
  if (!serverValue) return { outcome: "failed", reason: "no-data" };
  const d = decide(serverValue);
  if (d.action === "noop") return { outcome: "noop" };
  if (d.action === "conflict") return { outcome: "conflict", reason: d.reason };
  return { outcome: "failed", reason: "aborted" };
}

// Whether a Done or Undo is in the review record `rec` on the server (its
// op), for when the transaction couldn't say.
export function reviewLanded(rec, cmd) {
  if (cmd.kind === "done") return !!rec && rec.last?.op === cmd.op;
  if (cmd.kind === "undo") return !!rec && rec.undoneOp === cmd.op;
  return false;
}

// Resolves once `db` is connected (.info/connected), now or later.
export function whenConnected(db) {
  return new Promise(resolve => {
    let off = null;
    let settled = false;
    off = onValue(ref(db, ".info/connected"), snap => {
      if (snap.val() !== true || settled) return;
      settled = true;
      resolve();
      if (off) off();
    });
    if (settled) off();
  });
}

// The server rejected it every time, or the rules did: nothing was written.
const surelyNotWritten = (err) => /maxretry|permission_denied/i.test(String(err?.message || err));
// Another write under sync/{uid} (a child update()) aborts a transaction not
// yet sent, or one the server sent back as stale: nothing was written, and
// running it again is safe.
const abortedBySet = (err) => String(err?.message || err) === "set";

// Runs `cmd` in the root transaction on sync/{uid} (`dbRef`), as full saves
// do. Fails closed: from null it writes nothing, so it can never overwrite or
// create an account. On "accepted", `before` is the server state the command
// was decided on (the updater's last run is the one that committed) and
// `after` what the server now holds.
// A dropped connection fails the transaction with "disconnect" even when the
// write had already reached the server, so then the outcome isn't known: with
// `whenOnline`, it waits for the connection and asks the server. get() would
// answer from this device's cache while a listener is on, so the read is a
// transaction writing the review record back unchanged: it commits only on
// the server's own copy. Landed: "accepted" with no before/after (no Undo
// offered); not landed: "failed"; that read failing too: "unknown". Detect
// isn't checked (it runs again on its own). Rejects on an error that means
// nothing was written (maxretry, permission_denied, a second "set"), or on any
// error without `whenOnline`. A first "set" runs it once more.
export async function runReviewTransaction(dbRef, cmd, { whenOnline = null } = {}) {
  const decide = (value) => decideReviewCommand(normalizePayload(value), cmd);
  const settle = (committed, value) => {
    const result = reviewOutcome(committed, value, decide);
    return result.outcome === "accepted" ? { ...result, before: normalizePayload(decidedOn), after: normalizePayload(value) } : result;
  };
  let decidedOn = null;
  const attempt = () => runTransaction(dbRef, (current) => {
    decidedOn = current;
    if (current === null) return undefined;
    const d = decide(current);
    return d.action === "write" ? d.next : undefined;
  }, { applyLocally: false });
  let res;
  try {
    try {
      res = await attempt();
    } catch (err) {
      if (!abortedBySet(err)) throw err;
      res = await attempt();
    }
  } catch (err) {
    if (surelyNotWritten(err) || abortedBySet(err) || !whenOnline || cmd.kind === "detect") throw err;
    try {
      await whenOnline();
      const check = await runTransaction(child(dbRef, `config/horizonReviews/${cmd.id}`), rec => rec, { applyLocally: false });
      if (!check.committed) return { outcome: "unknown" };
      return reviewLanded(check.snapshot.val(), cmd)
        ? { outcome: "accepted", confirmedLate: true }
        : { outcome: "failed", reason: "not-landed" };
    } catch {
      return { outcome: "unknown" };
    }
  }
  return settle(res.committed, res.snapshot.val());
}

// The Done command for the review as the dialog showed it.
export function doneCommand(review, choices, day, now, op) {
  return {
    kind: "done", id: review.id, end: review.end, day, now, op,
    choices: Object.fromEntries(review.tasks.map(t => [t.uuid, choices[t.uuid] || "keep"])),
    shown: Object.fromEntries(review.tasks.map(t => [t.uuid, t.lastUpdated])),
  };
}

// The Undo for an accepted Done: `before` is the server state the Done was
// decided on, `after` the state it committed. Only the tasks it changed are
// restored (kept ones it never touched).
export function undoCommand(done, before, after) {
  const changed = Object.keys(done.choices).filter(uuid => done.choices[uuid] !== "keep");
  const afterTasks = new Map((after.tasks || []).map(t => [t.uuid, t]));
  return {
    kind: "undo", id: done.id, op: done.op,
    through: reviewsOf(after.config)[done.id]?.through,
    beforeRecord: reviewsOf(before.config)[done.id],
    beforeTasks: (before.tasks || []).filter(t => changed.includes(t.uuid)),
    after: Object.fromEntries(changed.filter(uuid => afterTasks.has(uuid)).map(uuid => [uuid, afterTasks.get(uuid)])),
  };
}
