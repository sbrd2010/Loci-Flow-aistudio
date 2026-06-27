import { describe, expect, it } from "vitest";
import { splitTextWithLinks } from "./linkify";

describe("splitTextWithLinks", () => {
  it("returns a single text part when there is no URL", () => {
    expect(splitTextWithLinks("buy milk")).toEqual([{ type: "text", value: "buy milk" }]);
  });

  it("extracts a single http(s) URL into its own part", () => {
    expect(splitTextWithLinks("see https://example.com/doc for details")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://example.com/doc" },
      { type: "text", value: " for details" },
    ]);
  });

  it("never linkifies non-http(s) schemes", () => {
    expect(splitTextWithLinks("run javascript:alert(1) now")).toEqual([
      { type: "text", value: "run javascript:alert(1) now" },
    ]);
  });

  it("trims trailing sentence punctuation from a matched URL", () => {
    expect(splitTextWithLinks("check https://example.com/x.")).toEqual([
      { type: "text", value: "check " },
      { type: "link", value: "https://example.com/x" },
      { type: "text", value: "." },
    ]);
  });

  it("extracts multiple URLs in one string", () => {
    expect(splitTextWithLinks("https://a.com and https://b.com")).toEqual([
      { type: "link", value: "https://a.com" },
      { type: "text", value: " and " },
      { type: "link", value: "https://b.com" },
    ]);
  });

  it("does not linkify an XSS payload that isn't a URL", () => {
    expect(splitTextWithLinks('<script>alert(1)</script>')).toEqual([
      { type: "text", value: '<script>alert(1)</script>' },
    ]);
  });

  it("handles empty or missing input", () => {
    expect(splitTextWithLinks("")).toEqual([{ type: "text", value: "" }]);
    expect(splitTextWithLinks(undefined)).toEqual([{ type: "text", value: "" }]);
  });
});
