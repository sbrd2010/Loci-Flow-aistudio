import { describe, expect, it, vi } from "vitest";
import { retryUnreadable } from "./aiRetry";

const read = (raw) => JSON.parse(raw).ok ? "read" : null;

describe("retryUnreadable", () => {
  it("asks once more when the reply can't be read, and uses the second", async () => {
    const call = vi.fn().mockResolvedValueOnce('[{"text":"x"}},{"').mockResolvedValueOnce('{"ok":true}');
    await expect(retryUnreadable(call, read)).resolves.toBe("read");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("doesn't ask again when the first reply is read", async () => {
    const call = vi.fn().mockResolvedValue('{"ok":true}');
    await expect(retryUnreadable(call, read)).resolves.toBe("read");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("gives up after two unreadable replies, empty ones included", async () => {
    const call = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce('{"ok":false}');
    await expect(retryUnreadable(call, read)).resolves.toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry a provider error", async () => {
    const call = vi.fn().mockRejectedValue(new Error("all providers failed"));
    await expect(retryUnreadable(call, read)).rejects.toThrow("all providers failed");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
