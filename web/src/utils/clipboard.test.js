import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeCopyToClipboard } from "./clipboard";

// node environment has no DOM; the execCommand fallback only touches
// document.createElement/body.appendChild/removeChild and execCommand.
// `navigator` also isn't a guaranteed global across Node versions (CI runs
// Node 20, which has none), so it's stubbed here too rather than mutated.
function stubDocument() {
  const ta = { value: "", style: {}, select: vi.fn() };
  globalThis.document = {
    createElement: vi.fn().mockReturnValue(ta),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand: vi.fn().mockReturnValue(true),
  };
  return globalThis.document;
}

describe("safeCopyToClipboard", () => {
  beforeEach(() => {
    stubDocument();
    // Node's own `navigator` global (added in recent versions) is a
    // read-only accessor, so it must be redefined rather than assigned.
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.navigator;
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    globalThis.navigator.clipboard = { writeText };

    const ok = await safeCopyToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(ok).toBe(true);
  });

  it("falls back to execCommand when navigator.clipboard is unavailable", async () => {
    const ok = await safeCopyToClipboard("hello");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(ok).toBe(true);
  });

  it("falls back to execCommand when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    globalThis.navigator.clipboard = { writeText };

    const ok = await safeCopyToClipboard("hello");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(ok).toBe(true);
  });

  it("returns false when both paths fail", async () => {
    document.execCommand = vi.fn().mockReturnValue(false);

    const ok = await safeCopyToClipboard("hello");

    expect(ok).toBe(false);
  });
});
