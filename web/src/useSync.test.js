import { describe, it, expect } from "vitest";
import { gatePaylodToUid } from "./useSync";

// Tests for the uid-isolation gate that prevents a previous user's payload from
// being visible to App-level effects during the render cycle that follows a uid change.
describe("gatePaylodToUid", () => {
  const userAPayload = { tasks: [{ uuid: "t1", title: "Task A" }], config: { userName: "Alice" } };
  const userBPayload = { tasks: [{ uuid: "t2", title: "Task B" }], config: { userName: "Bob" } };

  it("returns payload when payloadUid matches currentUid (normal same-user case)", () => {
    expect(gatePaylodToUid(userAPayload, "uid-a", "uid-a")).toBe(userAPayload);
  });

  it("returns null when payloadUid differs from currentUid (uid-change gap)", () => {
    // uid changed to B but payloadUidRef still holds A's uid — must gate
    expect(gatePaylodToUid(userAPayload, "uid-a", "uid-b")).toBeNull();
  });

  it("returns null when currentUid is null (logged-out state)", () => {
    expect(gatePaylodToUid(userAPayload, "uid-a", null)).toBeNull();
    expect(gatePaylodToUid(userAPayload, "uid-a", undefined)).toBeNull();
  });

  it("returns null when payloadUid is null (payload not yet assigned to any uid)", () => {
    expect(gatePaylodToUid(userBPayload, null, "uid-b")).toBeNull();
  });

  it("returns null when both payload and payloadUid are null", () => {
    expect(gatePaylodToUid(null, null, "uid-b")).toBeNull();
  });

  it("returns null for the payload when payload itself is null but uid matches", () => {
    // payloadUid was cleared when uid changed; uid now set but no data yet
    expect(gatePaylodToUid(null, "uid-b", "uid-b")).toBeNull();
  });

  it("does not allow user A payload to be visible under user B uid", () => {
    // This is the exact cross-contamination scenario from the P0 bug report
    const result = gatePaylodToUid(userAPayload, "uid-a", "uid-b");
    expect(result).toBeNull();
    // Specifically: user B must not see user A's tasks or config
    expect(result?.config?.userName).toBeUndefined();
    expect(result?.tasks).toBeUndefined();
  });

  it("allows user B payload to be visible under user B uid after data loads", () => {
    const result = gatePaylodToUid(userBPayload, "uid-b", "uid-b");
    expect(result).toBe(userBPayload);
    expect(result.config.userName).toBe("Bob");
  });

  it("handles same-user cache reload correctly (uid unchanged, payload refreshed)", () => {
    const freshPayload = { tasks: [{ uuid: "t1" }, { uuid: "t2" }], config: {} };
    expect(gatePaylodToUid(freshPayload, "uid-a", "uid-a")).toBe(freshPayload);
  });
});
