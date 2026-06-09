import { describe, it, expect } from "vitest";
import { buildPayloadBackupData } from "./exportTasks";

const TASK = { uuid: "abc", title: "Test task", isCompleted: false, lastUpdated: 1000 };

describe("buildPayloadBackupData", () => {
  it("sets app and exportType fields", () => {
    const result = buildPayloadBackupData({ tasks: [TASK] });
    expect(result.app).toBe("Loci");
    expect(result.exportType).toBe("full-payload-backup");
  });

  it("includes an exportedAt ISO string", () => {
    const result = buildPayloadBackupData({ tasks: [] });
    expect(typeof result.exportedAt).toBe("string");
    expect(() => new Date(result.exportedAt)).not.toThrow();
  });

  it("includes tasks array from payload", () => {
    const result = buildPayloadBackupData({ tasks: [TASK] });
    expect(result.tasks).toEqual([TASK]);
    expect(result.taskCount).toBe(1);
  });

  it("includes config from payload", () => {
    const config = { userName: "Alice", deadlineLabel: "Q3" };
    const result = buildPayloadBackupData({ tasks: [], config });
    expect(result.config).toEqual(config);
  });

  it("includes contributions from payload", () => {
    const contributions = [{ date: "2026-01-01", count: 3 }];
    const result = buildPayloadBackupData({ tasks: [], contributions });
    expect(result.contributions).toEqual(contributions);
  });

  it("includes brainDump and brainDumpUpdatedAt from payload", () => {
    const brainDump = ["idea 1", "idea 2"];
    const result = buildPayloadBackupData({ tasks: [], brainDump, brainDumpUpdatedAt: 9999 });
    expect(result.brainDump).toEqual(brainDump);
    expect(result.brainDumpUpdatedAt).toBe(9999);
  });

  it("normalizes missing fields to safe defaults", () => {
    const result = buildPayloadBackupData({});
    expect(result.tasks).toEqual([]);
    expect(result.config).toEqual({});
    expect(result.contributions).toEqual([]);
    expect(result.brainDump).toEqual([]);
  });

  it("handles null payload without throwing", () => {
    const result = buildPayloadBackupData(null);
    expect(result.tasks).toEqual([]);
    expect(result.app).toBe("Loci");
    expect(result.taskCount).toBe(0);
  });

  it("preserves unknown top-level fields", () => {
    const result = buildPayloadBackupData({ tasks: [], timestamp: 12345 });
    expect(result.timestamp).toBe(12345);
  });
});
