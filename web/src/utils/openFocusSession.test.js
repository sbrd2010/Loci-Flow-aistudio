import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { OPEN_SESSION_KEY, OPEN_SESSION_SAVE_MS, clearOpenSession, dropSessionLock, holdSessionLock, claimSessionLock, loadOpenSession, ownedByOtherLiveTab, saveOpenSession, savedSessionAsEnded, thisTabId } from "./openFocusSession";
import { focusExpiryReason, PAUSE_EXPIRY_MS } from "./focusSession";

const store = {};
const tabStore = {};
globalThis.sessionStorage = {
  getItem: (k) => (k in tabStore ? tabStore[k] : null),
  setItem: (k, v) => { tabStore[k] = String(v); },
};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const snap = (over = {}) => ({
  v: 1, uid: "u1", savedAt: 1_000_000, focusSessionId: "s1", focusStartedAt: 900_000,
  initialPlannedSeconds: 1500, accumulatedElapsed: 600, accumulatedPlanned: 1500, blocks: 2, extensions: 1,
  startDay: "2024-06-15", dayEndsAt: 5_000_000, ledgerEntry: null, pausedAt: null,
  timerMaxSeconds: 1500, timerSecondsLeft: 1200, task: { uuid: "t1", title: "Write" }, ...over,
});

describe("openFocusSession", () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it("loads what was saved, for the same account only", () => {
    saveOpenSession(snap());
    expect(loadOpenSession("u1")).toEqual(snap());
    expect(loadOpenSession("u2")).toBeNull();
    expect(loadOpenSession(null)).toBeNull();
  });

  it("clears, and reads nothing from a missing, broken or oddly shaped value", () => {
    expect(loadOpenSession("u1")).toBeNull();
    saveOpenSession(snap());
    clearOpenSession();
    expect(loadOpenSession("u1")).toBeNull();
    store[OPEN_SESSION_KEY] = "{not json";
    expect(loadOpenSession("u1")).toBeNull();
    saveOpenSession(snap({ v: 2 }));
    expect(loadOpenSession("u1")).toBeNull();
    saveOpenSession(snap({ task: null }));
    expect(loadOpenSession("u1")).toBeNull();
    saveOpenSession(snap({ timerSecondsLeft: "20" }));
    expect(loadOpenSession("u1")).toBeNull();
    saveOpenSession(snap({ focusSessionId: "" }));
    expect(loadOpenSession("u1")).toBeNull();
  });

  it("credits the time worked as saved: earlier blocks plus the part of this one", () => {
    const ended = savedSessionAsEnded(snap(), "user_abandoned");
    // 600 s in earlier blocks + (1500 − 1200) s in this one.
    expect(ended.focusElapsedSeconds).toBe(900);
    expect(ended.focusFinalPlannedSeconds).toBe(3000);
    expect(ended.focusEndedAt).toBe(1_000_000);
    expect(ended.lociDateString).toBe("2024-06-15");
    expect(ended.task.uuid).toBe("t1");
  });

  it("ends at the pause it was already in, and amends the hold's entry when there is one", () => {
    const ended = savedSessionAsEnded(snap({ pausedAt: 990_000, ledgerEntry: { eventId: "e1", lociDateString: "2024-06-14" } }), "user_abandoned");
    expect(ended.focusEndedAt).toBe(990_000);
    expect(ended.eventId).toBe("e1");
    expect(ended.lociDateString).toBe("2024-06-14");
  });

  it("reads as expired when its pause ran out or its day ended, with the day's end as the cut", () => {
    // Saved running at 1_000_000 with its day ending 1_030_000: 30 s past the end is not credited.
    const day = savedSessionAsEnded(snap({ dayEndsAt: 970_000 }), "user_abandoned", 1_100_000);
    expect(day.focusEndReason).toBe("day_ended");
    expect(day.focusEndedAt).toBe(970_000);
    expect(day.focusElapsedSeconds).toBe(900 - 30);
    // Back an hour later, day not ended: the pause ran out, credited as saved.
    const paused = savedSessionAsEnded(snap(), "user_abandoned", 1_000_000 + PAUSE_EXPIRY_MS + 1);
    expect(paused.focusEndReason).toBe("paused_too_long");
    expect(paused.focusEndedAt).toBe(1_000_000);
    expect(paused.focusElapsedSeconds).toBe(900);
    // Back at once: not expired, the reason asked for stands.
    expect(savedSessionAsEnded(snap(), "user_abandoned", 1_010_000).focusEndReason).toBe("user_abandoned");
  });

  it("a session saved long ago is over by the 15-minute rule, counted from the save", () => {
    const s = snap();
    const back = (ms) => focusExpiryReason({ sessionOpen: true, pausedAt: s.pausedAt ?? s.savedAt, dayEndsAt: s.dayEndsAt, now: s.savedAt + ms });
    expect(back(30_000)).toBeNull();
    expect(back(PAUSE_EXPIRY_MS + 1)).toBe("paused_too_long");
    expect(focusExpiryReason({ sessionOpen: true, pausedAt: s.savedAt, dayEndsAt: s.savedAt + 60_000, now: s.savedAt + 120_000 })).toBe("day_ended");
  });
});

describe("another live tab", () => {
  it("owns a session it saved a moment ago, but not one saved long ago or by this tab", () => {
    const mine = thisTabId();
    expect(thisTabId()).toBe(mine);
    expect(ownedByOtherLiveTab({ tabId: mine, savedAt: 1_000_000 }, 1_005_000)).toBe(false);
    expect(ownedByOtherLiveTab({ tabId: "other", savedAt: 1_000_000 }, 1_005_000)).toBe(true);
    expect(ownedByOtherLiveTab({ tabId: "other", savedAt: 1_000_000 }, 1_000_000 + OPEN_SESSION_SAVE_MS * 3 + 1)).toBe(false);
    expect(ownedByOtherLiveTab({ savedAt: 1_000_000 }, 1_001_000)).toBe(false);
  });
});

// A minimal stand-in for navigator.locks: exclusive, one holder per name, and
// `ifAvailable` answers null when it is taken.
function fakeLocks() {
  const held = new Set();
  return {
    held,
    async request(name, opts, cb) {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      if (held.has(name)) {
        if (opts.ifAvailable) return cb(null);
        throw new Error("queued: not modelled");
      }
      held.add(name);
      try { return await cb({ name }); } finally { held.delete(name); }
    },
  };
}

describe("the lock a tab holds while it has the session", () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    dropSessionLock();
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    else delete globalThis.navigator;
  });

  it("takes the lock in the same step as asking, keeps one for the tab, and gives it up when dropped", async () => {
    const locks = fakeLocks();
    Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
    const asks = await Promise.all([claimSessionLock(), claimSessionLock()]); // this tab twice
    expect(asks).toEqual([true, true]);
    expect(locks.held.size).toBe(1);
    dropSessionLock();
    await new Promise((r) => setTimeout(r, 0));
    expect(locks.held.size).toBe(0);
    expect(await claimSessionLock()).toBe(true);
  });

  it("another tab's lock keeps a new claim out, and a session's hold is the same lock", async () => {
    const locks = fakeLocks();
    Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
    locks.held.add("loci-open-focus-session"); // another tab
    expect(await claimSessionLock()).toBe(false);
    locks.held.clear();
    holdSessionLock();
    await Promise.resolve();
    expect(locks.held.size).toBe(1);
    expect(await claimSessionLock()).toBe(true); // already this tab's
  });

  it("can't say in a browser without locks, so the saved-a-moment-ago guess applies", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    expect(await claimSessionLock()).toBeNull();
    holdSessionLock(); // nothing to hold, and no error
    dropSessionLock();
  });
});
