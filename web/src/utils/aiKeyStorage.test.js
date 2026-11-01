import { describe, it, expect } from "vitest";
import { clearPersonalAIKeys } from "./aiKeyStorage";

describe("clearPersonalAIKeys", () => {
  it("removes every personal provider key while retaining device preferences and unrelated storage", () => {
    const providers = ["groq", "gemini", "cerebras", "zai", "openrouter", "nvidia"];
    const values = new Map(providers.map(p => [`loci_${p}_key`, "synthetic-key"]));
    values.set("loci_theme", "dark");
    values.set("loci_provider_pref", "auto");
    values.set("other_app", "keep");
    clearPersonalAIKeys({ removeItem: k => values.delete(k) });
    expect(Object.fromEntries(values)).toEqual({ loci_theme: "dark", loci_provider_pref: "auto", other_app: "keep" });
  });

  it("tolerates unavailable storage", () => {
    expect(() => clearPersonalAIKeys(null)).not.toThrow();
    expect(() => clearPersonalAIKeys({ removeItem() { throw new Error("blocked"); } })).not.toThrow();
  });
});
