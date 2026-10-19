import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GESTURES } from "./config.ts";

const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "docs", "gestures.md"), "utf8");

/** Every leaf of the config as "section.key" -> value. */
function leaves(obj: object, prefix = ""): Array<[string, unknown]> {
  return Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === "object"
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

describe("docs/gestures.md", () => {
  const documented = new Map(
    [...doc.matchAll(/^\| `([a-zA-Z.]+)` \| ([0-9.]+) \|/gm)].map((m) => [m[1] ?? "", Number(m[2])]),
  );

  it.each(leaves(DEFAULT_GESTURES))("documents %s with its current value", (path, value) => {
    expect(documented.get(path)).toBe(value);
  });

  it("documents nothing that is not in the config", () => {
    const known = new Set(leaves(DEFAULT_GESTURES).map(([path]) => path));
    expect([...documented.keys()].filter((path) => !known.has(path))).toEqual([]);
  });
});
