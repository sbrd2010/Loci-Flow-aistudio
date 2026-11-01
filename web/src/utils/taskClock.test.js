import { describe, it, expect } from "vitest";
import { mergeLocalIntoServer, mergeRemotePayloadWithMeta, applyEditsSince } from "./normalizePayload";

const task = (title, lastUpdated, extra = {}) => ({ id: 1, uuid: "clock-task", userId: "synthetic@example.test", title, lastUpdated, ...extra });
const payload = t => ({ tasks: [t], config: {}, contributions: [], brainDump: [], chatHistory: [], timestamp: t.lastUpdated });
const incoming = (remote, local, base) => mergeRemotePayloadWithMeta(remote, local, {}, [], [], [], base.tasks);

describe("task clocks against the last observed server task", () => {
  it("saves an edit made after observing a future-clock task, and remains idempotent", () => {
    const base = payload(task("Already seen", 301000));
    const local = payload(task("Later edit", 2000));
    const committed = mergeLocalIntoServer(base, local, base);
    expect(committed.tasks[0].title).toBe("Later edit");
    expect(committed.tasks[0].lastUpdated).toBe(301001);
    expect(mergeLocalIntoServer(committed, local, base).tasks).toEqual(committed.tasks);
    const echo = incoming(committed, local, base);
    expect(echo.merged.tasks).toEqual(committed.tasks);
    expect(echo.hasLocalContribution).toBe(false);
  });

  it("keeps a genuine unsaved edit when the server repeats the known future version", () => {
    const base = payload(task("Already seen", 301000));
    const result = incoming(base, payload(task("Unsaved edit", 2000)), base);
    expect(result.merged.tasks[0].title).toBe("Unsaved edit");
    expect(result.hasLocalContribution).toBe(true);
  });

  it("does not freshen an unchanged cached task over another device's edit or delete", () => {
    const base = payload(task("Old cached title", 301000));
    for (const remote of [task("Remote edit", 2000), task("Old cached title", 2000, { isDeleted: true })]) {
      const server = payload(remote);
      expect(mergeLocalIntoServer(server, base, base).tasks[0]).toEqual(remote);
      expect(incoming(server, base, base).merged.tasks[0]).toEqual(remote);
      expect(incoming(server, base, base).hasLocalContribution).toBe(false);
    }
  });

  it("does not treat timestamp-only drift as a new edit", () => {
    const base = payload(task("Same content", 1000));
    const server = payload(task("Changed elsewhere", 2000));
    const local = payload(task("Same content", 999999));
    expect(mergeLocalIntoServer(server, local, base).tasks[0].title).toBe("Changed elsewhere");
  });

  it("retains the existing timestamp conflict policy for concurrent edits and legacy caches", () => {
    const base = payload(task("Base", 1000));
    const server = payload(task("Remote concurrent", 301000));
    const local = payload(task("Local concurrent", 2000));
    expect(mergeLocalIntoServer(server, local, base).tasks[0].title).toBe("Remote concurrent");
    expect(mergeLocalIntoServer(server, local, null).tasks[0].title).toBe("Remote concurrent");
    expect(incoming(server, local, base).merged.tasks[0].title).toBe("Remote concurrent");
  });

  it("keeps an edit made during a save even when the commit advanced the task clock", () => {
    const written = payload(task("Submitted", 2000));
    const committed = payload(task("Submitted", 301001));
    const local = payload(task("Edited during save", 2001));
    const overlaid = applyEditsSince(committed, local, written);
    expect(overlaid.tasks[0].title).toBe("Edited during save");
    expect(overlaid.tasks[0].lastUpdated).toBe(301002);
    expect(applyEditsSince(committed, written, written).tasks).toEqual(committed.tasks);
  });
});
