import { describe, it, expect } from "vitest";
import { normalizePayload, mergeRemotePayload } from "./normalizePayload";

describe("normalizePayload", () => {
  it("fills missing brainDump with []", () => {
    expect(normalizePayload({ tasks: [], config: {} }).brainDump).toEqual([]);
  });

  it("fills missing tasks with []", () => {
    expect(normalizePayload({ config: {}, brainDump: [] }).tasks).toEqual([]);
  });

  it("fills missing contributions with []", () => {
    expect(normalizePayload({ tasks: [], config: {} }).contributions).toEqual([]);
  });

  it("fills missing config with {}", () => {
    expect(normalizePayload({ tasks: [], brainDump: [] }).config).toEqual({});
  });

  it("preserves existing brainDump items", () => {
    const items = [{ id: "bd_1", text: "buy oat milk" }];
    expect(normalizePayload({ tasks: [], config: {}, brainDump: items }).brainDump).toEqual(items);
  });

  it("preserves unknown fields like chatHistory", () => {
    const history = [{ role: "user", content: "hi" }];
    const result = normalizePayload({ tasks: [], config: {}, chatHistory: history });
    expect(result.chatHistory).toEqual(history);
  });

  it("preserves timestamp", () => {
    expect(normalizePayload({ tasks: [], config: {}, timestamp: 99999 }).timestamp).toBe(99999);
  });

  it("returns the raw value unchanged for non-objects", () => {
    expect(normalizePayload(null)).toBeNull();
    expect(normalizePayload(undefined)).toBeUndefined();
  });
});

describe("mergeRemotePayload", () => {
  // P0 regression: the loss loop caused by Firebase omitting brainDump on read
  it("preserves local brainDump when remote lacks the key entirely", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    const local = {
      tasks: [],
      config: {},
      brainDump: [{ id: "bd_1", text: "critical note" }],
      timestamp: 90,
    };
    const result = mergeRemotePayload(remote, local);
    expect(result.brainDump).toEqual([{ id: "bd_1", text: "critical note" }]);
  });

  it("uses remote brainDump when remote explicitly provides items", () => {
    const remote = { tasks: [], config: {}, brainDump: [{ id: "r1", text: "from remote" }], timestamp: 100 };
    const local = { tasks: [], config: {}, brainDump: [{ id: "l1", text: "old local" }], timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([{ id: "r1", text: "from remote" }]);
  });

  it("uses remote empty brainDump when remote explicitly has the key set to []", () => {
    // Firebase omits empty arrays, so this case is rare in production, but if the key
    // is present and empty, trust the remote (don't inject phantom local items).
    const remote = { tasks: [], config: {}, brainDump: [], timestamp: 100 };
    const local = { tasks: [], config: {}, brainDump: [{ id: "l1", text: "local item" }], timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([]);
  });

  it("returns [] when both remote and local have no brainDump", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    const local = { tasks: [], config: {}, timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([]);
  });

  it("returns [] when remote lacks key and local brainDump is empty", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    const local = { tasks: [], config: {}, brainDump: [], timestamp: 90 };
    expect(mergeRemotePayload(remote, local).brainDump).toEqual([]);
  });

  it("returns [] when remote lacks key and local is null", () => {
    const remote = { tasks: [], config: {}, timestamp: 100 };
    expect(mergeRemotePayload(remote, null).brainDump).toEqual([]);
  });

  it("normalizes all standard fields from remote", () => {
    const remote = { config: {}, timestamp: 100 };
    const result = mergeRemotePayload(remote, null);
    expect(result.tasks).toEqual([]);
    expect(result.contributions).toEqual([]);
    expect(result.brainDump).toEqual([]);
  });

  it("preserves unknown fields from remote", () => {
    const remote = { tasks: [], config: {}, chatHistory: [{ role: "user", content: "hi" }], timestamp: 100 };
    expect(mergeRemotePayload(remote, null).chatHistory).toEqual([{ role: "user", content: "hi" }]);
  });
});
