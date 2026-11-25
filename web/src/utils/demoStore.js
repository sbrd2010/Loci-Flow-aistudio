import { resolveFunctionalSave } from "./functionalSave";
import { endLeftReviewMarks } from "./normalizePayload";

// #680: demo mode's saves, with the same contract as useSync's. One
// authoritative live payload sits behind every demo write; each write reads
// and replaces it synchronously, then publishes it once (to React state), so
// a functional save resolves against the latest copy and reports its real
// outcome (applied / noop / refused:*). The session moves on every enter and
// exit, so a function from an earlier visit is refused. Object and key writes
// keep their old semantics (not session-gated). Demo saves skip
// normalizePayload; the review mark's rule still holds (Q48.1).
export function createDemoStore(publish) {
  const state = { live: null, session: 0 };
  const set = (next) => { state.live = next; publish(next); };
  const tell = (options, outcome) => {
    if (typeof options?.onLocalOutcome !== "function") return;
    try { options.onLocalOutcome(outcome); } catch (err) { console.error("[Loci demo] onLocalOutcome observer threw:", err); }
  };
  return {
    state,
    enter(payload) { state.session += 1; set(payload); },
    exit() { state.session += 1; set(null); },
    // `token`: the session the caller's save function was made in.
    save(update, options, token) {
      let updated = update;
      let outcome = "applied";
      if (typeof update === "function") {
        const resolved = resolveFunctionalSave({
          update,
          live: state.live,
          owner: { uid: "demo", currentUid: state.live ? "demo" : null, payloadUid: "demo", session: token, currentSession: state.session },
        });
        if (resolved.error) console.error("[Loci demo] functional save threw; nothing was saved:", resolved.error);
        outcome = resolved.outcome;
        updated = resolved.next;
      }
      if (outcome === "applied") {
        set({ ...updated, ...(Array.isArray(updated.tasks) ? { tasks: endLeftReviewMarks(updated.tasks) } : {}), timestamp: Date.now() });
      }
      tell(options, outcome);
      return outcome;
    },
    saveSubPath(subPath, value) {
      if (state.live) set({ ...state.live, [subPath]: value, timestamp: Date.now() });
    },
    saveSubPaths(patch) {
      if (state.live) set({ ...state.live, ...patch, timestamp: Date.now() });
    },
    saveConfigPatch(patch) {
      const prev = state.live;
      if (!prev) return;
      const resolvedPatch = typeof patch === "function" ? patch(prev.config || {}) : patch;
      set({ ...prev, config: { ...prev.config, ...resolvedPatch, lastUpdated: Date.now() }, timestamp: Date.now() });
    },
  };
}
