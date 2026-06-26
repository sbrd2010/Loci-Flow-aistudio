import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeCopyToClipboard } from "./clipboard";

// node environment has no DOM; the execCommand fallback only touches
// document.createElement/body.appendChild/removeChild and execCommand.
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete navigator.clipboard;
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const ok = await safeCopyToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(ok).toBe(true);
  });

  it("falls back to execCommand when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

    const ok = await safeCopyToClipboard("hello");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(ok).toBe(true);
  });

  it("falls back to execCommand when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const ok = await safeCopyToClipboard("hello");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(ok).toBe(true);
  });

  it("returns false when both paths fail", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);

    const ok = await safeCopyToClipboard("hello");

    expect(ok).toBe(false);
  });
});
