import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScene } from "@hai/protocol";
import { describe, expect, it } from "vitest";

describe("sample scene", () => {
  it("loads and contains every element type", () => {
    const raw = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "samples", "mixed-use-block.hai.json"), "utf8"),
    );
    const result = parseScene(raw);
    if (!result.ok) throw new Error(result.error);
    const types = new Set(Object.values(result.doc.elements).map((e) => e.type));
    expect([...types].sort()).toEqual(["column", "massing", "slab", "wall"]);
    expect(Object.keys(result.doc.elements).length).toBeGreaterThan(10);
  });
});
