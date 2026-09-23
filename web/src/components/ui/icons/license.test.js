import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Lucide's ISC licence (and Feather's MIT notice) must travel with every copy
// of these paths. The copy here sits with the source (brief 3.4); the copy in
// public/ is the one Vite puts into dist, which Firebase and Capacitor ship.
describe("Lucide licence", () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("ships an identical copy in public/, so the build carries it", () => {
    expect(read("../../../../public/licenses/lucide.txt")).toBe(read("./LICENSE"));
  });
});
